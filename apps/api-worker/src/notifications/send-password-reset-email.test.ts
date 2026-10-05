import { createRecordingEmailBinding } from "../test-support/recording-email";
import { describe, expect, it } from "vitest";

import { sendPasswordResetEmailNotification } from "./send-password-reset-email";

describe("sendPasswordResetEmailNotification", () => {
  it("sends notification through Cloudflare Email Service when configured", async () => {
    const { emailBinding, messages } = createRecordingEmailBinding();

    await sendPasswordResetEmailNotification({
      emailBinding,
      fromEmail: "no-reply@credtrail.org",
      fromName: "CredTrail",
      recipientEmail: "admin@example.edu",
      tenantId: "tenant_123",
      tenantDisplayName: "Example University",
      resetUrl: "https://credtrail.test/auth/reset-password?token=test-token",
    });

    expect(messages[0]?.html).toContain("Example University");
    expect(messages[0]).toEqual(
      expect.objectContaining({
        from: {
          email: "no-reply@credtrail.org",
          name: "CredTrail",
        },
        to: "admin@example.edu",
        subject: "Set up local access to Example University",
        text: expect.stringContaining(
          "https://credtrail.test/auth/reset-password?token=test-token",
        ),
        headers: {
          "X-CredTrail-Email-Kind": "password_reset",
          "X-CredTrail-Email-Category": "Auth Password Reset",
        },
      }),
    );
  });

  it("skips sending when the Cloudflare Email binding is missing", async () => {
    await expect(
      sendPasswordResetEmailNotification({
        recipientEmail: "admin@example.edu",
        tenantId: "tenant_123",
        tenantDisplayName: "Example University",
        resetUrl: "https://credtrail.test/auth/reset-password?token=test-token",
      }),
    ).resolves.toBeUndefined();
  });
});
