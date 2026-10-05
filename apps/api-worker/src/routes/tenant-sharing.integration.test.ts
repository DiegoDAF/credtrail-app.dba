import { expect, it } from "vitest";
import { immutableCredentialObjectKey } from "@credtrail/core-domain";
import {
  findTenantLinkedInSettings,
  listAssertionEngagementEvents,
  updateTenantLinkedInSettings,
} from "@credtrail/db";
import { linkedinOrganizationIdSchema } from "@credtrail/validation";
import {
  cleanupTestResources,
  createBadgeRuleIntegrationFixture,
  describeDbIntegration,
  requireTestDatabaseUrl,
  seedAssertion,
} from "../../../../packages/db/src/postgres-test-support";
import { app } from "../app";
import type { AppBindings } from "../app/types";
import { createSmtpTestServer } from "../test-support/smtp-test-server";
import { createNodeEmail } from "../runtime/node-email";

const origin = "https://badges.example.edu";
const bindings = (): AppBindings => ({
  APP_ENV: "production",
  RUNTIME: "node",
  DATABASE_URL: requireTestDatabaseUrl(),
  BETTER_AUTH_SECRET: "disposable-integration-secret-at-least-32-characters",
  PLATFORM_DOMAIN: "badges.example.edu",
  PUBLIC_APP_ORIGIN: origin,
  BADGE_OBJECTS: {
    head: async () => null,
    get: async () => null,
    put: async () => null,
    delete: async () => undefined,
  },
  REQUEST_CLIENT_IP: `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::5`,
});

describeDbIntegration("institution sharing through the application", () => {
  it("authenticates an administrator, saves and clears, rejects malformed forms, enforces roles, tenant access and CSRF", async () => {
    const f = await createBadgeRuleIntegrationFixture();
    const other = await createBadgeRuleIntegrationFixture();
    const relay = await createSmtpTestServer();
    const authIds: string[] = [];
    const env = { ...bindings(), EMAIL: createNodeEmail(relay.env).binding };
    const path = `/tenants/${f.tenantId}/admin/sharing`;
    const post = async (
      body: BodyInit,
      cookie = "",
      requestOrigin: string | null = origin,
      target = path,
    ): Promise<Response> =>
      app.request(
        origin + target,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/x-www-form-urlencoded",
            ...(requestOrigin === null ? {} : { origin: requestOrigin }),
          },
          body,
        },
        env,
      );
    try {
      expect((await app.request(origin + path, {}, env)).status).toBe(302);
      expect((await post(new URLSearchParams({ organizationId: "123" }))).status).toBe(302);
      const user = await f.db
        .prepare("SELECT email FROM users WHERE id = ?")
        .bind(f.userId)
        .first<{ email: string }>();
      if (user === null) throw new Error("Fixture user missing");
      const requested = await app.request(
        origin + "/v1/auth/magic-link/request",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: user.email, tenantId: f.tenantId }),
        },
        env,
      );
      expect(requested.status).toBe(202);
      const authUser = await f.db
        .prepare("SELECT id FROM auth.user WHERE email = ?")
        .bind(user.email)
        .first<{ id: string }>();
      if (authUser !== null) authIds.push(authUser.id);
      const url = relay.messages[0]?.mail.text?.match(/https:\/\/badges\.example\.edu[^\s]+/u)?.[0];
      if (url === undefined) throw new Error("Magic link missing");
      const token = new URL(url).searchParams.get("token");
      if (token === null) throw new Error("Magic link token missing");
      const verified = await app.request(
        origin + "/auth/magic-link/verify",
        {
          method: "POST",
          headers: { origin, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token, next: path }),
        },
        env,
      );
      expect(verified.status).toBe(302);
      const cookie = verified.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      expect(cookie).toContain("better-auth.session_token=");
      const page = await app.request(origin + path, { headers: { cookie } }, env);
      expect(page.status).toBe(200);
      expect(page.headers.get("cache-control")).toBe("no-store");
      expect(await page.text()).toContain("Credential sharing");
      for (const id of [" 90071992547409931234 ", "456", ""]) {
        const response = await post(new URLSearchParams({ organizationId: id }), cookie);
        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe(path);
        const flashCookie = response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        const reload = await app.request(
          origin + path,
          { headers: { cookie: cookie + "; " + flashCookie } },
          env,
        );
        expect(reload.status).toBe(200);
        expect(await reload.text()).toContain(
          id === "" ? "LinkedIn setting cleared." : "LinkedIn setting saved.",
        );
        expect((await findTenantLinkedInSettings(f.db, f.tenantId))?.organizationId).toBe(
          id.trim() || null,
        );
      }
      await post(new URLSearchParams({ organizationId: "123" }), cookie);
      for (const body of [
        new URLSearchParams(),
        new URLSearchParams({ organizationId: "https://linkedin.com/company/123" }),
        new URLSearchParams({ organizationId: "0" }),
        new URLSearchParams({ organizationId: "123", tenantId: other.tenantId }),
      ]) {
        const invalid = await post(body, cookie);
        expect(invalid.status).toBe(400);
        const html = await invalid.text();
        expect(html).toContain("Enter the numeric LinkedIn organization ID, or leave it blank.");
        expect(html).toContain('aria-invalid="true"');
        expect(html).toContain(`value="${body.get("organizationId") ?? ""}"`);
        expect((await findTenantLinkedInSettings(f.db, f.tenantId))?.organizationId).toBe("123");
      }
      const multipart = new FormData();
      multipart.set("organizationId", new Blob(["456"]), "id.txt");
      const fileResponse = await app.request(
        origin + path,
        { method: "POST", headers: { cookie, origin }, body: multipart },
        env,
      );
      expect(fileResponse.status).toBe(400);
      for (const badOrigin of ["https://attacker.example", null])
        expect(
          (await post(new URLSearchParams({ organizationId: "456" }), cookie, badOrigin)).status,
        ).toBe(403);
      const otherPath = `/tenants/${other.tenantId}/admin/sharing`;
      expect((await app.request(origin + otherPath, { headers: { cookie } }, env)).status).toBe(
        403,
      );
      expect(
        (await post(new URLSearchParams({ organizationId: "456" }), cookie, origin, otherPath))
          .status,
      ).toBe(403);
      expect((await findTenantLinkedInSettings(f.db, other.tenantId))?.organizationId).toBeNull();
      await f.db
        .prepare("UPDATE memberships SET role = 'viewer' WHERE tenant_id = ? AND user_id = ?")
        .bind(f.tenantId, f.userId)
        .run();
      expect((await app.request(origin + path, { headers: { cookie } }, env)).status).toBe(403);
      expect((await post(new URLSearchParams({ organizationId: "456" }), cookie)).status).toBe(403);
      expect((await findTenantLinkedInSettings(f.db, f.tenantId))?.organizationId).toBe("123");
      await f.db
        .prepare("UPDATE memberships SET role = 'owner' WHERE tenant_id = ? AND user_id = ?")
        .bind(f.tenantId, f.userId)
        .run();
      expect((await post(new URLSearchParams({ organizationId: "789" }), cookie)).status).toBe(303);
    } finally {
      await relay.close();
      await cleanupTestResources(f.db, {
        tenantIds: [f.tenantId, other.tenantId],
        userIds: [f.userId, other.userId],
        betterAuthUserIds: authIds,
      });
    }
  });

  it("uses the issuing institution's current setting for old badges without changing feed links or credentials", async () => {
    const a = await createBadgeRuleIntegrationFixture();
    const b = await createBadgeRuleIntegrationFixture();
    const objects = new Map<string, string>();
    const publicIds = new Map<string, string>();
    const assertionIds = new Map<string, string>();
    const env = bindings();
    env.BADGE_OBJECTS = {
      ...env.BADGE_OBJECTS,
      get: async (key) => {
        const text = objects.get(key);
        return text === undefined ? null : { size: text.length, text: async () => text };
      },
    };
    try {
      for (const f of [a, b]) {
        const publicId = crypto.randomUUID();
        publicIds.set(f.tenantId, publicId);
        const assertionId = await seedAssertion(f.db, {
          tenantId: f.tenantId,
          badgeTemplateId: f.badgeTemplateId,
          publicId,
          recipientIdentity: "learner@example.edu",
          issuedAt: "2026-02-01T00:00:00Z",
        });
        assertionIds.set(f.tenantId, assertionId);
        objects.set(
          immutableCredentialObjectKey({ tenantId: f.tenantId, assertionId }),
          JSON.stringify({
            id: `urn:credential:${assertionId}`,
            issuer: { name: `Institution ${f.tenantId}` },
            credentialSubject: { achievement: { name: "Research & Practice" } },
          }),
        );
      }
      const profile = async (tenantId: string, query = ""): Promise<URL> => {
        const response = await app.request(
          `${origin}/badges/${publicIds.get(tenantId)}/share/linkedin-profile${query}`,
          {},
          env,
        );
        expect(response.status).toBe(302);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const url = new URL(response.headers.get("location") ?? "");
        expect(url.searchParams.get("name")).toBe("Research & Practice");
        expect(url.searchParams.get("certUrl")).toBe(`${origin}/badges/${publicIds.get(tenantId)}`);
        expect(url.searchParams.get("certId")).toBe(`urn:credential:${assertionIds.get(tenantId)}`);
        expect(url.searchParams.get("issueYear")).toBe("2026");
        expect(url.searchParams.get("issueMonth")).toBe("2");
        return url;
      };
      await updateTenantLinkedInSettings(a.db, {
        tenantId: a.tenantId,
        actorUserId: a.userId,
        organizationId: linkedinOrganizationIdSchema.parse("90071992547409931234"),
      });
      const configured = await profile(a.tenantId, `?organizationId=999&tenantId=${b.tenantId}`);
      expect(configured.searchParams.get("organizationId")).toBe("90071992547409931234");
      expect(configured.searchParams.has("organizationName")).toBe(false);
      const unconfigured = await profile(b.tenantId);
      expect(unconfigured.searchParams.get("organizationName")).toBe(`Institution ${b.tenantId}`);
      expect(unconfigured.searchParams.has("organizationId")).toBe(false);
      await updateTenantLinkedInSettings(a.db, {
        tenantId: a.tenantId,
        actorUserId: a.userId,
        organizationId: linkedinOrganizationIdSchema.parse("456"),
      });
      expect((await profile(a.tenantId)).searchParams.get("organizationId")).toBe("456");
      await updateTenantLinkedInSettings(a.db, {
        tenantId: a.tenantId,
        actorUserId: a.userId,
        organizationId: null,
      });
      expect((await profile(a.tenantId)).searchParams.get("organizationName")).toBe(
        `Institution ${a.tenantId}`,
      );
      const feed = await app.request(
        `${origin}/badges/${publicIds.get(a.tenantId)}/share/linkedin-feed`,
        {},
        env,
      );
      expect(feed.status).toBe(302);
      expect(feed.headers.get("cache-control")).toBe("no-store");
      expect(feed.headers.get("location")).toBe(
        `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${origin}/badges/${publicIds.get(a.tenantId)}`)}`,
      );
      expect(
        (
          await app.request(
            `${origin}/badges/${publicIds.get(a.tenantId)}/share/unsupported`,
            {},
            env,
          )
        ).status,
      ).toBe(404);
      expect(
        (await app.request(`${origin}/badges/missing/share/linkedin-profile`, {}, env)).status,
      ).toBe(404);
      const events = await listAssertionEngagementEvents(a.db, {
        tenantId: a.tenantId,
        assertionId: assertionIds.get(a.tenantId) ?? "",
      });
      expect(
        events.filter((event) => event.eventType === "share_click").map((event) => event.channel),
      ).toEqual(expect.arrayContaining(["linkedin_profile", "linkedin_feed"]));
    } finally {
      await cleanupTestResources(a.db, {
        tenantIds: [a.tenantId, b.tenantId],
        userIds: [a.userId, b.userId],
      });
    }
  });
});
