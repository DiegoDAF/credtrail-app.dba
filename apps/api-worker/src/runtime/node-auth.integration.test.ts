import { afterEach, expect, it } from "vitest";
import { app } from "../app";
import type { AppBindings } from "../app/types";
import {
  createTestPostgresDatabase,
  createBadgeRuleIntegrationFixture,
  cleanupTestResources,
  describeDbIntegration,
  requireTestDatabaseUrl,
} from "../../../../packages/db/src/postgres-test-support";
import { createNodeRequestAdapter } from "./node-request-adapter";
import { sha256Hex } from "../utils/crypto";
import { createSmtpTestServer, type SmtpTestServer } from "../test-support/smtp-test-server";
import { createNodeEmail } from "./node-email";
const relays: SmtpTestServer[] = [];
const buckets: string[] = [];
const tenantIds: string[] = [];
const userIds: string[] = [];
const betterAuthUserIds: string[] = [];
afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.close();
  if (tenantIds.length)
    await cleanupTestResources(createTestPostgresDatabase(), {
      tenantIds,
      userIds,
      betterAuthUserIds,
    });
  tenantIds.length = 0;
  userIds.length = 0;
  betterAuthUserIds.length = 0;
  for (const hash of buckets.splice(0))
    await createTestPostgresDatabase()
      .prepare("DELETE FROM auth_magic_link_rate_limit_attempts WHERE dimension_hash = ?")
      .bind(hash)
      .run();
});
describeDbIntegration("Node trusted auth identity", () => {
  it("uses durable socket IP buckets despite changing forged headers and keeps separate real peers", async () => {
    const fixture = await createBadgeRuleIntegrationFixture();
    tenantIds.push(fixture.tenantId);
    userIds.push(fixture.userId);
    buckets.push(await sha256Hex(`magic-link:tenant:${fixture.tenantId}`));
    const peerPrefix = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}`;
    const peers = [`${peerPrefix}::1`, `${peerPrefix}::2`];
    for (const peer of peers) buckets.push(await sha256Hex(`magic-link:ip:${peer}`));
    const env: AppBindings = {
      APP_ENV: "production",
      RUNTIME: "node",
      DATABASE_URL: requireTestDatabaseUrl(),
      BETTER_AUTH_SECRET: "disposable-integration-secret-at-least-32-characters",
      PLATFORM_DOMAIN: "badges.example.edu",
      PUBLIC_APP_ORIGIN: "https://badges.example.edu",
      BADGE_OBJECTS: {
        head: async () => null,
        get: async () => null,
        put: async () => null,
        delete: async () => undefined,
      },
      EMAIL: {
        send: async () => {
          throw new Error("No recipient exists; mail must not be sent");
        },
      },
    };
    const adapt = createNodeRequestAdapter(undefined);
    const request = async (peer: string, attempt: number): Promise<Response> => {
      const email = `missing-${crypto.randomUUID()}@example.edu`;
      buckets.push(
        await sha256Hex(`magic-link:email:${email}`),
        await sha256Hex(`magic-link:tenant-email:${fixture.tenantId}:${email}`),
      );
      const adapted = adapt(
        new Request("https://badges.example.edu/v1/auth/magic-link/request", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `203.0.113.${attempt}`,
            "cf-connecting-ip": `203.0.113.${attempt}`,
          },
          body: JSON.stringify({ email, tenantId: fixture.tenantId }),
        }),
        peer,
        env,
      );
      if (adapted.status !== "ok") throw new Error("Direct traffic adaptation failed");
      return app.fetch(adapted.request, adapted.bindings);
    };
    for (let attempt = 1; attempt <= 3; attempt++)
      expect((await request(peers[0] ?? "", attempt)).status).toBe(202);
    expect((await request(peers[0] ?? "", 4)).status).toBe(428);
    expect((await request(peers[1] ?? "", 5)).status).toBe(202);
  });
  it("delivers a real production magic link through TLS SMTP without BCC and preserves secure cookies", async () => {
    const fixture = await createBadgeRuleIntegrationFixture();
    tenantIds.push(fixture.tenantId);
    userIds.push(fixture.userId);
    const user = await fixture.db
      .prepare("SELECT email FROM users WHERE id = ?")
      .bind(fixture.userId)
      .first<{ email: string }>();
    if (user === null) throw new Error("Fixture user missing");
    const peer = `2001:db8:${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}::3`;
    for (const dimension of [
      `ip:${peer}`,
      `tenant:${fixture.tenantId}`,
      `email:${user.email}`,
      `tenant-email:${fixture.tenantId}:${user.email}`,
    ])
      buckets.push(await sha256Hex(`magic-link:${dimension}`));
    const relay = await createSmtpTestServer();
    relays.push(relay);
    const binding = createNodeEmail(relay.env).binding;
    if (binding === undefined) throw new Error("SMTP fixture binding missing");
    const env: AppBindings = {
      APP_ENV: "production",
      RUNTIME: "node",
      DATABASE_URL: requireTestDatabaseUrl(),
      BETTER_AUTH_SECRET: "disposable-integration-secret-at-least-32-characters",
      PLATFORM_DOMAIN: "badges.example.edu",
      PUBLIC_APP_ORIGIN: "https://badges.example.edu",
      BADGE_OBJECTS: {
        head: async () => null,
        get: async () => null,
        put: async () => null,
        delete: async () => undefined,
      },
      EMAIL: binding,
      TRANSACTIONAL_EMAIL_FROM_ADDRESS: "badges@example.edu",
      TRANSACTIONAL_EMAIL_FROM_NAME: "University Credentials",
    };
    const result = createNodeRequestAdapter("10.0.0.0/8")(
      new Request("http://internal:8787/v1/auth/magic-link/request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-proto": "https",
          "x-forwarded-host": "badges.example.edu",
          "x-forwarded-for": peer,
          origin: "https://badges.example.edu",
          cookie: "better-auth.session_token=unrecognized-test-cookie",
        },
        body: JSON.stringify({ email: user.email, tenantId: fixture.tenantId }),
      }),
      "10.0.0.1",
      env,
    );
    if (result.status !== "ok") throw new Error("Trusted proxy failed");
    const response = await app.fetch(result.request, result.bindings);
    expect(response.status).toBe(202);
    expect(relay.messages).toHaveLength(1);
    expect(relay.messages[0]?.recipients).toEqual([user.email]);
    expect(relay.messages[0]?.secure).toBe(true);
    const authUser = await fixture.db
      .prepare("SELECT id FROM auth.user WHERE email = ?")
      .bind(user.email)
      .first<{ id: string }>();
    if (authUser !== null) betterAuthUserIds.push(authUser.id);
    const url = relay.messages[0]?.mail.text?.match(/https:\/\/badges\.example\.edu[^\s]+/u)?.[0];
    expect(url).toBeDefined();
    if (url === undefined) throw new Error("Recorded link missing");
    const confirmation = await app.request(url, {}, { ...env, REQUEST_CLIENT_IP: peer });
    expect(confirmation.status).toBe(200);
    const token = new URL(url).searchParams.get("token");
    if (token === null) throw new Error("Recorded token missing");
    const consumed = await app.request(
      "https://badges.example.edu/auth/magic-link/verify",
      {
        method: "POST",
        headers: {
          origin: "https://badges.example.edu",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token, next: "/auth/resolve" }),
      },
      { ...env, REQUEST_CLIENT_IP: peer },
    );
    expect(consumed.status).toBe(302);
    expect(consumed.headers.get("set-cookie")).toContain("Secure");
  });
});
