import type { LinkedInOrganizationId } from "@credtrail/validation";
import { linkedInAddToProfileUrl } from "../utils/display-format";
import { safeHttpUrl, type EmailTheme } from "./email-theme";
import { sendTransactionalEmail } from "./transactional-email";

export interface SendIssuanceEmailNotificationInput {
  emailBinding?: SendEmail | undefined;
  fromEmail?: string | undefined;
  fromName?: string | undefined;
  theme?: EmailTheme | undefined;
  recipientEmail: string;
  tenantDisplayName: string;
  badgeTitle: string;
  issuedAtIso: string;
  publicBadgeUrl: string;
  /** JSON API. Kept for callers; the email sends people to the badge page, which shows the verified status. */
  verificationUrl: string;
  credentialDownloadUrl: string;
  /** Human-friendly PDF copy, offered next to the credential download. */
  credentialPdfDownloadUrl?: string | undefined;
  badgeDescription?: string | null | undefined;
  /** Public artwork URL shown as the email's hero image. */
  badgeImageUrl?: string | null | undefined;
  /** Issuer's LinkedIn company page ID, so "Add to LinkedIn" links the certification to the page. */
  linkedInOrganizationId?: LinkedInOrganizationId | null | undefined;
  /** Expiry of the credential, when it has one. */
  validUntilIso?: string | null | undefined;
}

/** The public id, as in the badge URL and on the badge page's own LinkedIn link. */
const credentialIdFromPublicUrl = (publicBadgeUrl: string): string => {
  try {
    return new URL(publicBadgeUrl).pathname.split("/").filter(Boolean).pop() ?? publicBadgeUrl;
  } catch {
    return publicBadgeUrl;
  }
};

const formatIssuedDate = (iso: string): string => {
  const date = new Date(iso);

  if (!Number.isFinite(date.getTime())) {
    return iso;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
};

export const sendIssuanceEmailNotification = async (
  input: SendIssuanceEmailNotificationInput,
): Promise<void> => {
  const institution = input.tenantDisplayName.trim();
  const description = input.badgeDescription?.trim() ?? "";
  const badgeImageUrl = safeHttpUrl(input.badgeImageUrl);
  const subject = `You've earned a new badge: ${input.badgeTitle}`;
  const linkedInUrl = linkedInAddToProfileUrl({
    organizationId: input.linkedInOrganizationId ?? null,
    badgeName: input.badgeTitle,
    issuerName: institution,
    issuedAtIso: input.issuedAtIso,
    credentialUrl: input.publicBadgeUrl,
    credentialId: credentialIdFromPublicUrl(input.publicBadgeUrl),
  });
  await sendTransactionalEmail({
    kind: "issuance",
    emailBinding: input.emailBinding,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    theme: input.theme,
    recipientEmail: input.recipientEmail,
    subject,
    content: {
      institution,
      ...(badgeImageUrl === undefined
        ? {}
        : { image: { url: badgeImageUrl, alt: `${input.badgeTitle} badge` } }),
      title: `You have earned ${input.badgeTitle}`,
      paragraphs: [
        ...(description.length > 0 ? [description] : []),
        "View your badge to see your achievement and share it with others.",
      ],
      details: [
        { label: "Issued", value: formatIssuedDate(input.issuedAtIso) },
        ...(input.validUntilIso === undefined || input.validUntilIso === null
          ? []
          : [{ label: "Valid until", value: formatIssuedDate(input.validUntilIso) }]),
      ],
      action: { label: "View your badge", url: input.publicBadgeUrl },
      secondaryActions: [
        { label: "Add to LinkedIn", url: linkedInUrl },
        ...(input.credentialPdfDownloadUrl === undefined
          ? []
          : [{ label: "Download PDF", url: input.credentialPdfDownloadUrl }]),
        { label: "Download your credential", url: input.credentialDownloadUrl },
      ],
      footer:
        "This badge is an Open Badges 3.0 verifiable credential, cryptographically signed by the issuer. Anyone can verify it from the badge page, without an account.",
    },
    category: "Issuance Notification",
  });
};
