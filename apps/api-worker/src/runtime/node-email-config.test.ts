import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { parseNodeEmailConfig } from "./node-email-config";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const env = {
  EMAIL_PROVIDER: "smtp",
  SMTP_HOST: "smtp.example.edu",
  SMTP_USERNAME: "mailer",
  SMTP_PASSWORD: " secret ",
  TRANSACTIONAL_EMAIL_FROM_ADDRESS: "badges@example.edu",
};
describe("Node email configuration", () => {
  it("parses only the selected provider, with TLS and a redacted password", () => {
    expect(parseNodeEmailConfig({ SMTP_PASSWORD_FILE: "/nonexistent" })).toEqual({
      provider: "none",
    });
    const config = parseNodeEmailConfig(env);
    if (config.provider !== "smtp" || config.smtp.auth.kind !== "login")
      throw new Error("SMTP config missing");
    expect(config.smtp.port).toBe(587);
    expect(config.smtp.auth.password.reveal()).toBe(" secret ");
    expect(JSON.stringify(config)).not.toContain(" secret ");
    expect(inspect(config)).not.toContain(" secret ");
    const tls = parseNodeEmailConfig({ ...env, SMTP_SECURITY: "tls" });
    if (tls.provider !== "smtp") throw new Error("SMTP config missing");
    expect(tls.smtp.port).toBe(465);
  });
  it("loads mounted secrets, preserves spaces, and rejects conflicting or oversized sources", () => {
    const directory = mkdtempSync(join(tmpdir(), "credtrail-email-config-"));
    directories.push(directory);
    const path = join(directory, "password");
    writeFileSync(path, " secret \r\n");
    const config = parseNodeEmailConfig({
      ...env,
      SMTP_PASSWORD: undefined,
      SMTP_PASSWORD_FILE: path,
    });
    if (config.provider !== "smtp" || config.smtp.auth.kind !== "login")
      throw new Error("SMTP config missing");
    expect(config.smtp.auth.password.reveal()).toBe(" secret ");
    expect(() => parseNodeEmailConfig({ ...env, SMTP_PASSWORD_FILE: path })).toThrow(
      "Set exactly one",
    );
    writeFileSync(path, "x".repeat(65_537));
    expect(() =>
      parseNodeEmailConfig({ ...env, SMTP_PASSWORD: undefined, SMTP_PASSWORD_FILE: path }),
    ).toThrow("64 KiB");
  });
  it.each([
    { EMAIL_PROVIDER: "other" },
    { SMTP_HOST: "smtp://user:secret@example.edu" },
    { SMTP_PORT: "25oops" },
    { SMTP_SECURITY: "plaintext" },
    { SMTP_USERNAME: "user\r\nBCC: victim@example.edu" },
    { TRANSACTIONAL_EMAIL_REPLY_TO: "support@example.edu\r\nBCC: victim@example.edu" },
    { ISSUANCE_EMAIL_BCC: "not-an-email" },
    { SMTP_AUTH: "none" },
    { SMTP_PASSWORD: undefined },
    { SMTP_TLS_CA_FILE: "/nonexistent" },
  ])("rejects malformed or contradictory configuration without secret values: %j", (override) => {
    expect(() => parseNodeEmailConfig({ ...env, ...override })).toThrow(
      /configuration|requires|exactly|Cannot read/u,
    );
    let error: unknown;
    try {
      parseNodeEmailConfig({ ...env, ...override });
    } catch (cause: unknown) {
      error = cause;
    }
    expect(String(error)).not.toContain(" secret ");
    expect(String(error)).not.toContain("victim@example.edu");
  });
  it("supports an explicit authenticated-free TLS relay and SES without SMTP fields", () => {
    const relay = parseNodeEmailConfig({
      ...env,
      SMTP_AUTH: "none",
      SMTP_USERNAME: undefined,
      SMTP_PASSWORD: undefined,
    });
    if (relay.provider !== "smtp") throw new Error("SMTP config missing");
    expect(relay.smtp.auth).toEqual({ kind: "none" });
    expect(
      parseNodeEmailConfig({
        EMAIL_PROVIDER: "ses",
        AWS_SES_REGION: "us-east-1",
        TRANSACTIONAL_EMAIL_FROM_ADDRESS: "badges@example.edu",
        SMTP_PASSWORD_FILE: "/nonexistent",
      }).provider,
    ).toBe("ses");
  });
});
