import { describe, expect, it, vi } from "vitest";

import {
  buildMagicLinkEmailContent,
  formatMagicLinkExpiry,
  sendMagicLinkEmailNotification,
} from "./send-magic-link-email";

const createEmailBinding = (): { emailBinding: SendEmail; send: ReturnType<typeof vi.fn> } => {
  const send = vi.fn(async () => {
    return { messageId: "email_msg_123" };
  });

  return {
    emailBinding: { send } as unknown as SendEmail,
    send,
  };
};

describe("sendMagicLinkEmailNotification", () => {
  it("sends notification through Cloudflare Email Service when configured", async () => {
    const { emailBinding, send } = createEmailBinding();

    await sendMagicLinkEmailNotification({
      emailBinding,
      fromEmail: "no-reply@credtrail.org",
      fromName: "CredTrail",
      recipientEmail: "learner@example.edu",
      tenantId: "tenant_123",
      magicLinkUrl: "https://credtrail.test/auth/magic-link/verify?token=test-token",
      expiresAtIso: "2026-02-18T01:00:00.000Z",
      preferredLocale: "en-US",
      preferredTimeZone: "America/New_York",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: {
          email: "no-reply@credtrail.org",
          name: "CredTrail",
        },
        to: "learner@example.edu",
        subject: "Sign in to CredTrail (tenant_123)",
        text: expect.stringContaining(
          "https://credtrail.test/auth/magic-link/verify?token=test-token",
        ),
        headers: {
          "X-CredTrail-Email-Category": "Auth Magic Link",
        },
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Organization: tenant_123"),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Expires: Feb 17, 2026, 8:00 PM EST"),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining("Expires at: 2026-02-18T01:00:00.000Z"),
      }),
    );
  });

  it("formats expiry timestamps with a UTC fallback when preferences are invalid", () => {
    expect(
      formatMagicLinkExpiry({
        expiresAtIso: "2026-02-18T01:00:00.000Z",
        preferredLocale: "not a locale",
        preferredTimeZone: "not/a-zone",
      }),
    ).toBe("Feb 18, 2026, 1:00 AM UTC");
  });

  it("keeps tenant details out of an unscoped sign-in email", async () => {
    const { emailBinding, send } = createEmailBinding();

    await sendMagicLinkEmailNotification({
      emailBinding,
      fromEmail: "no-reply@credtrail.org",
      recipientEmail: "learner@example.edu",
      magicLinkUrl: "https://credtrail.test/auth/magic-link/verify?token=test-token",
      expiresAtIso: "2026-02-18T01:00:00.000Z",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Sign in to CredTrail",
        text: expect.not.stringContaining("Organization:"),
      }),
    );
  });

  it("skips sending when the Cloudflare Email binding is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await sendMagicLinkEmailNotification({
      recipientEmail: "learner@example.edu",
      tenantId: "tenant_123",
      magicLinkUrl: "https://credtrail.test/auth/magic-link/verify?token=test-token",
      expiresAtIso: "2026-02-18T01:00:00.000Z",
    });

    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("builds a branded HTML sign-in email with the link as a button and as text", () => {
    const content = buildMagicLinkEmailContent({
      fromName: "DBAses Badges",
      recipientEmail: "owner@example.edu",
      tenantId: "dbases",
      magicLinkUrl: "https://badges.example.edu/auth/magic-link/verify?token=abc&next=%2F",
      expiresAtIso: "2026-10-02T18:10:00.000Z",
      theme: {
        headerColor: "#000000",
        accentColor: "#2e7d32",
        highlightColor: "#55ff55",
        logoUrl: "https://example.edu/logo.png",
      },
    });

    expect(content.subject).toBe("Sign in to DBAses Badges (dbases)");
    expect(content.html).toContain("Sign in to DBAses Badges");
    expect(content.html).toContain(
      'href="https://badges.example.edu/auth/magic-link/verify?token=abc&amp;next=%2F"',
    );
    expect(content.html).toContain('src="https://example.edu/logo.png"');
    expect(content.html).toContain("#55ff55");
    expect(content.text).toContain(
      "https://badges.example.edu/auth/magic-link/verify?token=abc&next=%2F",
    );
    expect(content.text).toContain("you can ignore this email");
  });
});
