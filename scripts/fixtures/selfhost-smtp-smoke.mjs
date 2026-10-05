import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startSmtpRelay } from "./selfhost-smtp-relay.mjs";

/** SMTP proof using the production driver's owned network, Postgres, and API/worker. */
export async function prepareSmtpSmoke({ directory, network, image, docker, poll }) {
  const mount = ["--add-host", "smtp:host-gateway", "-v", `${directory}:/certs:ro`];
  await writeFile(join(directory, "smtp-password"), " secret \n");
  const relay = await startSmtpRelay(directory);
  try {
    const env = {
      EMAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp",
      SMTP_PORT: String(relay.port),
      SMTP_SECURITY: "starttls",
      SMTP_USERNAME: "disposable",
      SMTP_PASSWORD_FILE: "/certs/smtp-password",
      SMTP_TLS_CA_FILE: "/certs/cert.pem",
      TRANSACTIONAL_EMAIL_FROM_ADDRESS: "badges@example.edu",
      TRANSACTIONAL_EMAIL_REPLY_TO: "support@example.edu",
      ISSUANCE_EMAIL_BCC: "records@example.edu",
      ISSUANCE_EMAIL_NOTIFICATIONS_ENABLED: "true",
    };
    const emailArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
    const captures = async () => relay.messages;
    const check = (...args) =>
      docker(
        "run",
        "--rm",
        "--network",
        network,
        ...mount,
        ...emailArgs,
        image,
        "node",
        "dist/node-runtime/node-email-check-runtime.js",
        ...args,
      );
    // Intentionally no DATABASE_URL or object storage credentials in these command containers.
    assert.match(await check(), /authentication succeeded/u);
    assert.equal((await captures()).length, 0);
    assert.match(await check("--to", "operator@example.edu"), /relay accepted/u);
    const test = (await captures())[0];
    assert.deepEqual(test.recipients, ["operator@example.edu"]);
    assert(test.secure && !test.bcc && !test.text.includes("token="));
    return {
      env,
      mount,
      close: () => relay.close(),
      async verifyAuth({ http, origin, sql, tenantId }) {
        // This is the driver's isolated database; earlier rate-limit checks used this peer.
        await sql("DELETE FROM auth_magic_link_rate_limit_attempts");
        const response = await http.post(`${origin}/v1/auth/magic-link/request`, {
          data: { email: "smoke-owner@example.edu", tenantId },
        });
        assert.equal(response.status(), 202);
        const mail = (await captures()).find((message) => message.kind === "magic_link");
        assert(mail?.secure);
        assert(mail.text.includes("Smoke institution"));
        assert(mail.html.includes("Smoke institution"));
        assert.deepEqual(mail.recipients, ["smoke-owner@example.edu"]);
        assert.deepEqual(mail.replyTo, ["support@example.edu"]);
        const url = mail.text.match(/https:\/\/localhost:[0-9]+[^\s]+/u)?.[0];
        assert(url);
        assert.equal((await http.get(url)).status(), 200);
        const token = new URL(url).searchParams.get("token");
        assert(token);
        const consumed = await http.post(`${origin}/auth/magic-link/verify`, {
          headers: { origin },
          form: { token, next: "/auth/resolve" },
          maxRedirects: 0,
        });
        assert.equal(consumed.status(), 302);
        assert.match(consumed.headers()["set-cookie"], /Secure/u);
      },
      async verifyIssuance({ http, origin, sql, apiKey, payload, assertionId }) {
        const accepted = (await captures()).find((message) => message.kind === "issuance");
        assert(accepted?.secure && !accepted.bcc);
        assert.deepEqual(accepted.recipients, ["learner@example.edu", "records@example.edu"]);
        assert(accepted.text.includes("Smoke institution"));
        assert(accepted.html.includes("Smoke institution"));
        const badgeUrl = accepted.text.match(/https:\/\/localhost:[0-9]+\/badges\/[^\s]+/u)?.[0];
        assert(badgeUrl && accepted.html.includes(badgeUrl));
        const state = (id) =>
          sql(
            `SELECT metadata_json::json->>'status' FROM audit_logs WHERE target_id='${id}' AND action='assertion.issuance_email' ORDER BY occurred_at DESC LIMIT 1`,
          );
        assert.equal(await state(assertionId), "accepted");
        const failed = await http.post(`${origin}/v1/programmatic/issue`, {
          headers: { "x-api-key": apiKey },
          data: {
            ...payload,
            recipientIdentity: "rejected@example.edu",
            idempotencyKey: "smtp-rejected",
          },
        });
        assert.equal(failed.status(), 202);
        const failedId = (await failed.json()).assertionId;
        await poll(async () => (await state(failedId)) === "failed", "failed SMTP issuance audit");
        assert.equal(await sql(`SELECT COUNT(*) FROM assertions WHERE id='${failedId}'`), "1");
        assert.equal((await captures()).filter((message) => message.kind === "issuance").length, 2);
        // The rejected primary never enters the envelope; the optional BCC may still be accepted.
        assert(
          (await captures()).every(
            (message) => !message.recipients.includes("rejected@example.edu"),
          ),
        );
      },
    };
  } catch (cause) {
    await relay.close();
    throw cause;
  }
}
