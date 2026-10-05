import { createRecordingEmailBinding } from "../test-support/recording-email";
import { describe, expect, it } from "vitest";

import { sendIssuanceEmailNotification } from "./send-issuance-email";

describe("sendIssuanceEmailNotification", () => {
  it("sends notification through Cloudflare Email Service when configured", async () => {
    const { emailBinding, messages } = createRecordingEmailBinding();

    await sendIssuanceEmailNotification({
      emailBinding,
      fromEmail: "no-reply@credtrail.org",
      fromName: "CredTrail",
      recipientEmail: "learner@example.edu",
      badgeTitle: "TypeScript Foundations",

      tenantDisplayName: "Example University",
      issuedAtIso: "2026-02-10T22:00:00.000Z",
      publicBadgeUrl: "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22",
      verificationUrl:
        "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/verification",
      credentialDownloadUrl:
        "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/download",
    });

    expect(messages[0]?.html).toContain("Example University");
    expect(messages[0]).toEqual(
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
          "X-CredTrail-Email-Kind": "issuance",
          "X-CredTrail-Email-Category": "Issuance Notification",
        },
      }),
    );
  });

  it("skips sending when the Cloudflare Email binding is missing", async () => {
    await expect(
      sendIssuanceEmailNotification({
        recipientEmail: "learner@example.edu",
        badgeTitle: "TypeScript Foundations",

        tenantDisplayName: "Example University",
        issuedAtIso: "2026-02-10T22:00:00.000Z",
        publicBadgeUrl: "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22",
        verificationUrl:
          "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/verification",
        credentialDownloadUrl:
          "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/download",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("issuance email expiry", () => {
  it("shows the expiry when the credential has one", async () => {
    const { emailBinding, messages } = createRecordingEmailBinding();

    await sendIssuanceEmailNotification({
      emailBinding,
      recipientEmail: "learner@example.edu",
      badgeTitle: "TypeScript Foundations",
      tenantDisplayName: "Example University",
      issuedAtIso: "2026-02-10T22:00:00.000Z",
      publicBadgeUrl: "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22",
      verificationUrl:
        "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/verification",
      credentialDownloadUrl:
        "https://credtrail.test/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22/download",
      validUntilIso: "2027-02-10T22:00:00.000Z",
    });

    expect(messages[0]?.html).toContain("Valid until");
    expect(messages[0]?.html).toContain("February 10, 2027");
    expect(messages[0]?.text).toContain("Valid until: February 10, 2027");
  });

  it("routes LinkedIn sharing through the public credential record", async () => {
    const { emailBinding, messages } = createRecordingEmailBinding();
    const publicBadgeUrl = "https://credtrail.org/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22";
    await sendIssuanceEmailNotification({
      emailBinding,
      recipientEmail: "learner@example.edu",
      badgeTitle: "TypeScript Foundations",
      tenantDisplayName: "Example University",
      issuedAtIso: "2026-02-10T22:00:00.000Z",
      validUntilIso: "2027-02-10T22:00:00.000Z",
      publicBadgeUrl,
      verificationUrl: `${publicBadgeUrl}/verification`,
      credentialDownloadUrl: `${publicBadgeUrl}/download`,
    });
    expect(messages[0]?.html).toContain(`href="${publicBadgeUrl}/share/linkedin-profile"`);
    expect(messages[0]?.text).toContain(
      `Add to LinkedIn: ${publicBadgeUrl}/share/linkedin-profile`,
    );
  });
});

describe("issuance email content (branded)", () => {
  const badgeUrl = "https://badges.example.edu/badges/40a6dc92-85ec-4cb0-8a50-afb2ae700e22";
  const baseInput = {
    fromEmail: "badges@example.edu",
    fromName: "Example Badges",
    recipientEmail: "learner@example.edu",
    badgeTitle: "Example Member",
    tenantDisplayName: "Example University",
    issuedAtIso: "2026-10-02T19:00:00.000Z",
    publicBadgeUrl: badgeUrl,
    verificationUrl: `${badgeUrl}/verification`,
    credentialDownloadUrl: `${badgeUrl}/download`,
  };

  it("shows the badge artwork, description, date, LinkedIn and download links", async () => {
    const { emailBinding, messages } = createRecordingEmailBinding();

    await sendIssuanceEmailNotification({
      ...baseInput,
      emailBinding,
      credentialPdfDownloadUrl: `${badgeUrl}/download.pdf`,
      badgeDescription: "Recognizes people who are part of Example University.",
      badgeImageUrl: "https://badges.example.edu/badges/assets/example/bt_1/img",
    });

    const message = messages[0];
    expect(message?.html).toContain("Example Badges");
    expect(message?.html).toContain("You have earned Example Member");
    expect(message?.html).toContain("Recognizes people who are part of Example University.");
    expect(message?.html).toContain(
      'src="https://badges.example.edu/badges/assets/example/bt_1/img"',
    );
    expect(message?.html).toContain("October 2, 2026");
    expect(message?.html).toContain(`href="${badgeUrl}/share/linkedin-profile"`);
    expect(message?.html).toContain("Download PDF");
    expect(message?.html).toContain(`${badgeUrl}/download.pdf`);
    expect(message?.text).toContain(`Add to LinkedIn: ${badgeUrl}/share/linkedin-profile`);
    expect(message?.text).toContain(`Download PDF: ${badgeUrl}/download.pdf`);
    expect(message?.text).toContain(`Download your credential: ${badgeUrl}/download`);
    // /verification answers JSON: the email sends people to the badge page instead
    expect(message?.html).not.toContain("/verification");
    expect(message?.text).not.toContain("/verification");
  });

  it("ignores artwork that is not an absolute http(s) URL", async () => {
    const { emailBinding, messages } = createRecordingEmailBinding();

    await sendIssuanceEmailNotification({
      ...baseInput,
      emailBinding,
      badgeImageUrl: "data:image/png;base64,AAAA",
    });

    expect(messages[0]?.html).not.toContain("<img");
    expect(messages[0]?.html).toContain("View your badge");
  });
});
