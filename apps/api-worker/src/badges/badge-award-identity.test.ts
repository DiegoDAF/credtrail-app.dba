import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { badgeAwardIdempotencyKey } from "./badge-award-identity";

const key = (tenantId: string, badgeTemplateId: string, recipientEmail: string): Promise<string> =>
  badgeAwardIdempotencyKey({
    tenantId,
    badgeTemplateId,
    recipientEmail,
    sha256Hex: async (value) => createHash("sha256").update(value).digest("hex"),
  });

describe("institutional badge award identity", () => {
  it("uses the same identity for differently cased email addresses without exposing the email", async () => {
    const keys = await Promise.all([
      key("tenant", "badge", " Learner@Example.edu "),
      key("tenant", "badge", "learner@example.edu"),
    ]);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^badge-award:[0-9a-f]{64}$/);
  });
  it("keeps different institutions, badges, learners, and delimiter-containing IDs separate", async () => {
    const keys = await Promise.all([
      key("tenant", "badge", "one@example.edu"),
      key("tenant2", "badge", "one@example.edu"),
      key("tenant", "badge2", "one@example.edu"),
      key("tenant", "badge", "two@example.edu"),
      key("tenant|badge", "x", "one@example.edu"),
      key("tenant", "badge|x", "one@example.edu"),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
