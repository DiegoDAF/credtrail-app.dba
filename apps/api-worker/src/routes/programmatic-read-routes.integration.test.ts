import { createTenantApiKey, findProgrammaticOperation, type SqlDatabase } from "@credtrail/db";
import {
  programmaticAcceptedSchema,
  programmaticOperationSchema,
  programmaticAssertionSchema,
  programmaticTemplatePageSchema,
  programmaticAssertionPageSchema,
} from "@credtrail/validation";
import type { ImmutableCredentialStore } from "@credtrail/core-domain";
import { Hono } from "hono";
import { afterEach, expect, it } from "vitest";
import {
  cleanupTestResources,
  createBadgeRuleIntegrationFixture,
  createTestPostgresDatabase,
  describeDbIntegration,
  seedAssertion,
  seedBadgeTemplate,
  type BadgeRuleIntegrationFixture,
} from "../../../../packages/db/src/postgres-test-support";
import type { AppBindings, AppEnv } from "../app/types";
import { createPostgresQueueIngressStore } from "../queue/ingress-store";
import { processQueueInputWithDefaults, readJsonBodyOrEmptyObject } from "../queue/processing";
import { sha256Hex } from "../utils/crypto";
import { registerQueueRoutes } from "./queue-routes";
import { registerProgrammaticReadRoutes } from "./programmatic-read-routes";

const tenants: string[] = [];
const users: string[] = [];
afterEach(async () => {
  if (tenants.length)
    await cleanupTestResources(createTestPostgresDatabase(), {
      tenantIds: tenants,
      userIds: users,
    });
  tenants.length = 0;
  users.length = 0;
});
const fixture = async (): Promise<BadgeRuleIntegrationFixture> => {
  const f = await createBadgeRuleIntegrationFixture();
  tenants.push(f.tenantId);
  users.push(f.userId);
  return f;
};
const key = async (
  f: BadgeRuleIntegrationFixture,
  scopes: string[],
  options: { owner?: string | null; expiresAt?: string } = {},
): Promise<string> => {
  const token = `ctak_${crypto.randomUUID()}`;
  await createTenantApiKey(f.db, {
    tenantId: f.tenantId,
    label: "Test integration",
    keyPrefix: token.slice(0, 12),
    keyHash: await sha256Hex(token),
    scopesJson: JSON.stringify(scopes),
    createdByUserId: options.owner === undefined ? f.userId : (options.owner ?? undefined),
    expiresAt: options.expiresAt,
  });
  return token;
};
const harness = (db: SqlDatabase, f: BadgeRuleIntegrationFixture) => {
  const app = new Hono<AppEnv>();
  const artwork: ImmutableCredentialStore = {
    head: async () => null,
    put: async () => null,
    delete: async () => undefined,
    get: async (name) =>
      name === `tenants/${f.tenantId}/badge-template-images/${f.badgeTemplateId}/asset_test.json`
        ? {
            size: 200,
            text: async () =>
              JSON.stringify({
                version: 1,
                mimeType: "image/png",
                byteSize: 8,
                base64Data: "iVBORw0KGgo=",
                uploadedAt: "2026-10-05T00:00:00Z",
                originalFilename: "test.png",
              }),
          }
        : null,
  };
  const env: AppBindings = {
    APP_ENV: "production",
    RUNTIME: "node",
    PUBLIC_APP_ORIGIN: "https://badges.example.edu",
    PLATFORM_DOMAIN: "badges.example.edu",
    BADGE_OBJECTS: artwork,
  };
  const deps = {
    app,
    resolveDatabase: () => db,
    resolveQueueIngressStore: () => createPostgresQueueIngressStore(db),
    sha256Hex,
  };
  registerQueueRoutes({
    ...deps,
    readJsonBodyOrEmptyObject,
    processQueueInputWithDefaults,
    processQueuedJobs: async () => ({
      leased: 0,
      processed: 0,
      succeeded: 0,
      retried: 0,
      deadLettered: 0,
      failedToFinalize: 0,
    }),
  });
  registerProgrammaticReadRoutes(deps);
  const get = (path: string, token?: string) =>
    app.request(
      `https://badges.example.edu${path}`,
      { headers: token ? { "x-api-key": token } : {} },
      env,
    );
  const post = (path: string, token: string, payload: unknown) =>
    app.request(
      `https://badges.example.edu${path}`,
      {
        method: "POST",
        headers: { "x-api-key": token, "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      env,
    );
  return { app, env, get, post };
};

describeDbIntegration("programmatic completion and institution reads", () => {
  it("retains operation links across replay and exposes pending, processing, completed and safe failure outcomes", async () => {
    const f = await fixture();
    const token = await key(f, ["queue.issue", "queue.revoke", "operations.read"]);
    const { get, post } = harness(f.db, f);
    const payload = {
      tenantId: f.tenantId,
      badgeTemplateId: f.badgeTemplateId,
      recipientIdentity: "learner@example.edu",
      recipientIdentityType: "email",
      idempotencyKey: "tracked-issue",
    };
    const accepted = await post("/v1/programmatic/issue", token, payload);
    expect(accepted.status).toBe(202);
    const envelope = programmaticAcceptedSchema.parse(await accepted.json());
    expect(accepted.headers.get("location")).toBe(envelope.statusUrl);
    expect(envelope.statusUrl).toBe(
      `https://badges.example.edu/v1/programmatic/operations/${envelope.operationId}?tenantId=${f.tenantId}`,
    );
    expect(await (await post("/v1/programmatic/issue", token, payload)).json()).toEqual(envelope);
    const path = new URL(envelope.statusUrl).pathname + new URL(envelope.statusUrl).search;
    const pending = await get(path, token);
    expect(pending.headers.get("cache-control")).toBe("no-store");
    expect(pending.headers.get("retry-after")).toBe("5");
    const storedPending = await findProgrammaticOperation(f.db, f.tenantId, envelope.operationId);
    expect(storedPending).toMatchObject({ status: "pending", assertionId: envelope.assertionId });
    for (const field of [
      "payloadJson",
      "lastError",
      "leaseToken",
      "completedAt",
      "failedAt",
      "publicId",
    ])
      expect(storedPending).not.toHaveProperty(field);
    expect(programmaticOperationSchema.parse(await pending.json())).toMatchObject({
      status: "pending",
      assertionId: envelope.assertionId,
    });
    await f.db
      .prepare(
        "UPDATE job_queue_messages SET status = 'processing', attempt_count = 1 WHERE id = ?",
      )
      .bind(envelope.operationId)
      .run();
    expect(programmaticOperationSchema.parse(await (await get(path, token)).json()).status).toBe(
      "processing",
    );
    await seedAssertion(f.db, {
      tenantId: f.tenantId,
      badgeTemplateId: f.badgeTemplateId,
      id: envelope.assertionId,
      publicId: "published-badge",
      recipientIdentity: payload.recipientIdentity,
      issuedAt: "2026-10-05T12:00:00Z",
    });
    await f.db
      .prepare("UPDATE job_queue_messages SET status = 'completed', completed_at = ? WHERE id = ?")
      .bind("2026-10-05T12:01:00Z", envelope.operationId)
      .run();
    expect(programmaticOperationSchema.parse(await (await get(path, token)).json())).toMatchObject({
      status: "completed",
      result: {
        badgeUrl: "https://badges.example.edu/badges/published-badge",
        credentialUrl: "https://badges.example.edu/badges/published-badge/jsonld",
      },
    });
    await f.db
      .prepare("DELETE FROM assertions WHERE tenant_id = ? AND id = ?")
      .bind(f.tenantId, envelope.assertionId)
      .run();
    expect(programmaticOperationSchema.parse(await (await get(path, token)).json())).toMatchObject({
      status: "completed",
      result: { badgeUrl: null, credentialUrl: null },
    });
    const revoke = programmaticAcceptedSchema.parse(
      await (
        await post("/v1/programmatic/revoke", token, {
          tenantId: f.tenantId,
          assertionId: envelope.assertionId,
          reason: "Withdrawn",
          idempotencyKey: "tracked-revoke",
        })
      ).json(),
    );
    await f.db
      .prepare(
        "UPDATE job_queue_messages SET status = 'failed', failed_at = ?, last_error = ? WHERE id = ?",
      )
      .bind("2026-10-05T12:02:00Z", "database password=do-not-expose", revoke.operationId)
      .run();
    const failed = await get(
      new URL(revoke.statusUrl).pathname + new URL(revoke.statusUrl).search,
      token,
    );
    const body = await failed.text();
    expect(body).not.toContain("do-not-expose");
    expect(programmaticOperationSchema.parse(JSON.parse(body))).toMatchObject({
      status: "failed",
      failure: { code: "operation_failed" },
    });
    await f.db
      .prepare(
        "UPDATE job_queue_messages SET job_type = 'process_badge_rule_lifecycle' WHERE id = ?",
      )
      .bind(revoke.operationId)
      .run();
    expect(
      (await get(new URL(revoke.statusUrl).pathname + new URL(revoke.statusUrl).search, token))
        .status,
    ).toBe(404);
  });

  it("paginates templates without duplication and keeps archived templates opt-in", async () => {
    const f = await fixture();
    const token = await key(f, ["templates.read"]);
    const { get } = harness(f.db, f);
    const a = await seedBadgeTemplate(f.db, {
      tenantId: f.tenantId,
      id: "a-template",
      title: "First",
    });
    const b = await seedBadgeTemplate(f.db, {
      tenantId: f.tenantId,
      id: "b-template",
      title: "Second",
    });
    await f.db.prepare("UPDATE badge_templates SET is_archived = 1 WHERE id = ?").bind(b).run();
    const first = programmaticTemplatePageSchema.parse(
      await (await get(`/v1/programmatic/templates?tenantId=${f.tenantId}&limit=1`, token)).json(),
    );
    expect(first.templates.map((t) => t.badgeTemplateId)).toEqual([a]);
    expect(first.nextCursor).toBe(a);
    const second = programmaticTemplatePageSchema.parse(
      await (
        await get(`/v1/programmatic/templates?tenantId=${f.tenantId}&limit=1&cursor=${a}`, token)
      ).json(),
    );
    expect(second.templates.map((t) => t.badgeTemplateId)).toEqual([f.badgeTemplateId]);
    expect(second.nextCursor).toBeNull();
    expect(second.templates[0]?.imageUrl).toBe(
      `https://badges.example.edu/badges/assets/${f.tenantId}/${f.badgeTemplateId}/asset_test`,
    );
    const archived = programmaticTemplatePageSchema.parse(
      await (
        await get(`/v1/programmatic/templates?tenantId=${f.tenantId}&includeArchived=true`, token)
      ).json(),
    );
    expect(archived.templates.find((t) => t.badgeTemplateId === b)?.archived).toBe(true);
    expect(
      await (await get(`/v1/programmatic/templates/${b}?tenantId=${f.tenantId}`, token)).json(),
    ).toMatchObject({ archived: true });
  });

  it("reconciles exact recipients, badge templates and UTC dates with stable pages and current expiry/revocation", async () => {
    const f = await fixture();
    const token = await key(f, ["assertions.read"]);
    const { get } = harness(f.db, f);
    for (const [id, email, issuedAt] of [
      ["a-assertion", "Learner@Example.edu", "2020-10-05T00:00:00Z"],
      ["b-assertion", "learner@example.edu", "2020-10-05T23:59:59.999Z"],
      ["c-assertion", "learner@example.edu", "2020-10-06T00:00:00Z"],
      ["d-assertion", "another@example.edu", "2020-10-05T12:00:00Z"],
    ] as const)
      await seedAssertion(f.db, {
        tenantId: f.tenantId,
        badgeTemplateId: f.badgeTemplateId,
        id,
        recipientIdentity: email,
        issuedAt,
        publicId: `public-${id}`,
      });
    await f.db
      .prepare("UPDATE assertions SET valid_until = ? WHERE id = 'a-assertion'")
      .bind("2020-10-05T00:01:00Z")
      .run();
    await f.db
      .prepare("UPDATE assertions SET revoked_at = ? WHERE id = 'b-assertion'")
      .bind("2020-10-06T00:00:00Z")
      .run();
    const base = `/v1/programmatic/assertions?tenantId=${f.tenantId}&badgeTemplateId=${f.badgeTemplateId}&recipientIdentity=learner%40example.edu&issuedFrom=2020-10-05&issuedTo=2020-10-05&limit=1`;
    const first = programmaticAssertionPageSchema.parse(await (await get(base, token)).json());
    expect(first.assertions.map((a) => [a.assertionId, a.state])).toEqual([
      ["a-assertion", "expired"],
    ]);
    expect(first.nextCursor).toBe("a-assertion");
    const second = programmaticAssertionPageSchema.parse(
      await (await get(`${base}&cursor=${first.nextCursor}`, token)).json(),
    );
    expect(second.assertions.map((a) => [a.assertionId, a.state])).toEqual([
      ["b-assertion", "revoked"],
    ]);
    expect(second.nextCursor).toBeNull();
    const detail = await get(
      `/v1/programmatic/assertions/a-assertion?tenantId=${f.tenantId}`,
      token,
    );
    const text = await detail.text();
    expect(text).not.toContain("vcR2Key");
    expect(programmaticAssertionSchema.parse(JSON.parse(text))).toMatchObject({
      state: "expired",
      badgeUrl: "https://badges.example.edu/badges/public-a-assertion",
    });
  });

  it("requires explicit read permissions, rejects foreign tenant/resource access, and rejects revoked or expired keys", async () => {
    const f = await fixture();
    const other = await fixture();
    const { get } = harness(f.db, f);
    const writeOnly = await key(f, ["queue.issue"]);
    const readOnly = await key(f, ["templates.read", "assertions.read", "operations.read"], {
      owner: null,
    });
    const expired = await key(f, ["templates.read"], { expiresAt: "2020-01-01T00:00:00Z" });
    const revoked = await key(f, ["templates.read"]);
    await f.db
      .prepare("UPDATE tenant_api_keys SET revoked_at = ? WHERE key_hash = ?")
      .bind("2026-01-01T00:00:00Z", await sha256Hex(revoked))
      .run();
    const list = `/v1/programmatic/templates?tenantId=${f.tenantId}`;
    expect((await get(list)).status).toBe(401);
    expect((await get(list, expired)).status).toBe(401);
    expect((await get(list, revoked)).status).toBe(401);
    expect((await get(list, writeOnly)).status).toBe(403);
    expect((await get(list, readOnly)).status).toBe(200);
    expect(
      (await get(`/v1/programmatic/templates?tenantId=${other.tenantId}`, readOnly)).status,
    ).toBe(403);
    expect(
      (
        await get(
          `/v1/programmatic/templates/${other.badgeTemplateId}?tenantId=${f.tenantId}`,
          readOnly,
        )
      ).status,
    ).toBe(404);
    await seedAssertion(other.db, {
      tenantId: other.tenantId,
      badgeTemplateId: other.badgeTemplateId,
      id: "foreign-assertion",
      recipientIdentity: "other@example.edu",
      issuedAt: "2026-10-05T00:00:00Z",
    });
    expect(
      (await get(`/v1/programmatic/assertions/foreign-assertion?tenantId=${f.tenantId}`, readOnly))
        .status,
    ).toBe(404);
    const foreignKey = await key(other, ["queue.issue"]);
    const foreignHarness = harness(other.db, other);
    const foreignOperation = programmaticAcceptedSchema.parse(
      await (
        await foreignHarness.post("/v1/programmatic/issue", foreignKey, {
          tenantId: other.tenantId,
          badgeTemplateId: other.badgeTemplateId,
          recipientIdentity: "other@example.edu",
          recipientIdentityType: "email",
          idempotencyKey: "foreign-operation",
        })
      ).json(),
    );
    expect(
      (
        await get(
          `/v1/programmatic/operations/${foreignOperation.operationId}?tenantId=${f.tenantId}`,
          readOnly,
        )
      ).status,
    ).toBe(404);
    expect(
      (await get(`/v1/programmatic/operations/unknown?tenantId=${f.tenantId}`, readOnly)).status,
    ).toBe(404);
  });

  it("returns stable validation errors for malformed JSON and invalid filters and exposes a public canonical OpenAPI document", async () => {
    const f = await fixture();
    const { app, env, get } = harness(f.db, f);
    const token = await key(f, ["templates.read", "assertions.read"]);
    for (const suffix of [
      "&limit=101",
      "&limit=0",
      "&limit=1.5",
      "&limit=0x10",
      "&extra=unknown",
    ]) {
      const response = await get(
        `/v1/programmatic/templates?tenantId=${f.tenantId}${suffix}`,
        token,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_request" });
    }
    for (const suffix of ["&issuedFrom=2026-10-06&issuedTo=2026-10-05", "&issuedFrom=not-a-date"]) {
      expect(
        (await get(`/v1/programmatic/assertions?tenantId=${f.tenantId}${suffix}`, token)).status,
      ).toBe(400);
    }
    const invalid = await app.request(
      "https://badges.example.edu/v1/programmatic/issue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
      env,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toBe("no-store");
    expect(await invalid.json()).toMatchObject({ code: "invalid_request" });
    const document = await get("/v1/programmatic/openapi.json");
    expect(document.status).toBe(200);
    expect(await document.json()).toMatchObject({
      openapi: "3.1.0",
      servers: [{ url: "https://badges.example.edu" }],
      paths: {
        "/v1/programmatic/issue": { post: { "x-required-scope": "queue.issue" } },
        "/v1/programmatic/assertions": { get: { "x-required-scope": "assertions.read" } },
      },
    });
  });
});
