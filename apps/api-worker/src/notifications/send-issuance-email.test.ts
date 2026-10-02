import { describe, expect, it, vi } from "vitest";

import { buildIssuanceEmailContent, sendIssuanceEmailNotification } from "./send-issuance-email";

const createEmailBinding = (): { emailBinding: SendEmail; send: ReturnType<typeof vi.fn> } => {
  const send = vi.fn(async () => {
    return { messageId: "email_msg_123" };
  });

  return {
    emailBinding: { send } as unknown as SendEmail,
    send,
  };
};

describe("sendIssuanceEmailNotification", () => {
  it("sends notification through Cloudflare Email Service when configured", async () => {
    const { emailBinding, send } = createEmailBinding();

    await sendIssuanceEmailNotification({
      emailBinding,
      fromEmail: "no-reply@credtrail.org",
      fromName: "CredTrail",
      recipientEmail: "learner@example.edu",
      badgeTitle: "TypeScript Foundations",
      assertionId: "tenant_123:assertion_456",
      tenantId: "tenant_123",
      issuedAtIso: "2026-02-10T22:00:00.000Z",
      publicBadgeUrl: "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22",
      verificationUrl:
        "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/verification",
      credentialDownloadUrl:
        "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/download",
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: {
          email: "no-reply@credtrail.org",
          name: "CredTrail",
        },
        to: "learner@example.edu",
        subject: "You've earned a new badge: TypeScript Foundations",
        text: expect.stringContaining(
          "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22",
        ),
        headers: {
          "X-CredTrail-Email-Category": "Issuance Notification",
        },
      }),
    );
  });

  it("skips sending when the Cloudflare Email binding is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await sendIssuanceEmailNotification({
      recipientEmail: "learner@example.edu",
      badgeTitle: "TypeScript Foundations",
      assertionId: "tenant_123:assertion_456",
      tenantId: "tenant_123",
      issuedAtIso: "2026-02-10T22:00:00.000Z",
      publicBadgeUrl: "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22",
      verificationUrl:
        "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/verification",
      credentialDownloadUrl:
        "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/download",
    });

    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("builds a branded HTML email with the badge, issuer, LinkedIn and download links", () => {
    const content = buildIssuanceEmailContent({
      fromName: "DBAses Badges",
      recipientEmail: "learner@example.edu",
      badgeTitle: "DBAses Member",
      assertionId: "tenant_123:assertion_456",
      tenantId: "tenant_123",
      issuedAtIso: "2026-10-02T19:00:00.000Z",
      publicBadgeUrl: "https://badges.example.edu/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22",
      verificationUrl:
        "https://badges.example.edu/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/verification",
      credentialDownloadUrl:
        "https://badges.example.edu/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/download",
      credentialPdfDownloadUrl:
        "https://badges.example.edu/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/download.pdf",
      issuerName: "DBAses",
      badgeDescription: "Recognizes people who are part of DBAses.",
      badgeImageUrl: "https://badges.example.edu/badges/assets/dbases/bt_1/img",
    });

    expect(content.subject).toBe("You've earned a new badge: DBAses Member");
    expect(content.html).toContain("Congratulations!");
    expect(content.html).toContain("DBAses Member");
    expect(content.html).toContain("Recognizes people who are part of DBAses.");
    expect(content.html).toContain(
      'src="https://badges.example.edu/badges/assets/dbases/bt_1/img"',
    );
    expect(content.html).toContain("View your badge");
    expect(content.html).toContain("Add to LinkedIn");
    expect(content.html).toContain("https://www.linkedin.com/profile/add?");
    expect(content.html).toContain("certId=40a6dc92-85ec-4cb0-8a50-afb2ae700e22");
    expect(content.html).toContain("October 2, 2026");
    expect(content.text).toContain("Issued by DBAses on October 2, 2026.");
    expect(content.text).toContain("Add it to LinkedIn: https://www.linkedin.com/profile/add?");
    expect(content.text).not.toContain("Tenant ID");
    expect(content.text).not.toContain("Assertion ID");
    expect(content.html).toContain("Download PDF");
    expect(content.text).toContain(
      "Download as PDF: https://badges.example.edu/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/download.pdf",
    );
    // /verification answers JSON: the email sends people to the badge page instead
    expect(content.html).not.toContain("/verification");
    expect(content.text).not.toContain("/verification");
  });

  it("links Add to LinkedIn to the issuer's company page when its ID is configured", () => {
    const content = buildIssuanceEmailContent({
      recipientEmail: "learner@example.edu",
      badgeTitle: "DBAses Member",
      assertionId: "tenant_123:assertion_456",
      tenantId: "tenant_123",
      issuedAtIso: "2026-10-02T19:00:00.000Z",
      publicBadgeUrl: "https://badges.example.edu/badges/x",
      verificationUrl: "https://badges.example.edu/badges/x/verification",
      credentialDownloadUrl: "https://badges.example.edu/badges/x/download",
      issuerName: "DBAses",
      linkedInOrganizationId: "110806030",
    });

    expect(content.html).toContain("organizationId=110806030");
    expect(content.html).not.toContain("organizationName=");
    expect(content.text).toContain("organizationId=110806030");
  });

  it("escapes badge text in the HTML part", () => {
    const content = buildIssuanceEmailContent({
      recipientEmail: "learner@example.edu",
      badgeTitle: "<script>alert(1)</script>",
      assertionId: "a",
      tenantId: "t",
      issuedAtIso: "2026-10-02T19:00:00.000Z",
      publicBadgeUrl: "https://badges.example.edu/badges/x",
      verificationUrl: "https://badges.example.edu/badges/x/verification",
      credentialDownloadUrl: "https://badges.example.edu/badges/x/download",
      badgeDescription: "<img src=x onerror=alert(1)>",
      badgeImageUrl: "javascript:alert(1)",
    });

    expect(content.html).not.toContain("<script>");
    expect(content.html).not.toContain("<img src=x");
    expect(content.html).not.toContain("javascript:");
    expect(content.html).toContain("&lt;script&gt;");
  });

  it("sends both text and HTML parts", async () => {
    const { emailBinding, send } = createEmailBinding();

    await sendIssuanceEmailNotification({
      emailBinding,
      recipientEmail: "learner@example.edu",
      badgeTitle: "DBAses Member",
      assertionId: "a",
      tenantId: "t",
      issuedAtIso: "2026-10-02T19:00:00.000Z",
      publicBadgeUrl: "https://badges.example.edu/badges/x",
      verificationUrl: "https://badges.example.edu/badges/x/verification",
      credentialDownloadUrl: "https://badges.example.edu/badges/x/download",
    });

    const message = send.mock.calls[0]?.[0] as { text?: string; html?: string };
    expect(message.text).toContain("https://badges.example.edu/badges/x");
    expect(message.html).toContain("<!DOCTYPE html>");
  });
});
