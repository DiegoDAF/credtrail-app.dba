import { linkedInAddToProfileUrl } from "../utils/display-format";
import {
  DEFAULT_EMAIL_THEME,
  emailButton,
  escapeHtml,
  formatEmailDate,
  linkedInEmailButton,
  renderEmailDocument,
  safeHttpUrl,
  type EmailTheme,
} from "./email-layout";
import { sendTransactionalEmail } from "./transactional-email";

export interface SendIssuanceEmailNotificationInput {
  emailBinding?: SendEmail | undefined;
  fromEmail?: string | undefined;
  fromName?: string | undefined;
  recipientEmail: string;
  badgeTitle: string;
  assertionId: string;
  tenantId: string;
  issuedAtIso: string;
  publicBadgeUrl: string;
  verificationUrl: string;
  credentialDownloadUrl: string;
  /** Human-friendly PDF copy. The verification URL is a JSON API, so the email links the badge page instead. */
  credentialPdfDownloadUrl?: string | undefined;
  /** Issuer display name shown as "Issued by". */
  issuerName?: string | undefined;
  badgeDescription?: string | null | undefined;
  /** Public artwork URL shown in the email header. */
  badgeImageUrl?: string | null | undefined;
  theme?: EmailTheme | undefined;
}

const credentialIdFromPublicUrl = (publicBadgeUrl: string, fallback: string): string => {
  try {
    const lastSegment = new URL(publicBadgeUrl).pathname.split("/").filter(Boolean).pop();
    return lastSegment ?? fallback;
  } catch {
    return fallback;
  }
};

const paragraph = (html: string, style: string): string => {
  return `<p style="margin:0;font-family:'Inter','Segoe UI',Helvetica,Arial,sans-serif;${style}">${html}</p>`;
};

export const buildIssuanceEmailContent = (
  input: SendIssuanceEmailNotificationInput,
): { subject: string; text: string; html: string } => {
  const theme = input.theme ?? DEFAULT_EMAIL_THEME;
  const issuerName = input.issuerName?.trim() ?? "";
  const description = input.badgeDescription?.trim() ?? "";
  const issuedOn = formatEmailDate(input.issuedAtIso);
  const brandName = input.fromName?.trim() || issuerName || "CredTrail";
  const linkedInUrl = linkedInAddToProfileUrl({
    badgeName: input.badgeTitle,
    credentialUrl: input.publicBadgeUrl,
    credentialId: credentialIdFromPublicUrl(input.publicBadgeUrl, input.assertionId),
    issuerName,
    issuedAtIso: input.issuedAtIso,
  });
  const issuedLine =
    issuerName.length > 0 ? `Issued by ${issuerName} on ${issuedOn}` : `Issued on ${issuedOn}`;
  const subject = `You've earned a new badge: ${input.badgeTitle}`;
  const text = [
    `Congratulations! You've earned a new badge: ${input.badgeTitle}`,
    `${issuedLine}.`,
    ...(description.length > 0 ? ["", description] : []),
    "",
    `View your badge: ${input.publicBadgeUrl}`,
    `Add it to LinkedIn: ${linkedInUrl}`,
    ...(input.credentialPdfDownloadUrl === undefined
      ? []
      : [`Download as PDF: ${input.credentialPdfDownloadUrl}`]),
    `Download the credential: ${input.credentialDownloadUrl}`,
    "",
    "This badge is an Open Badges 3.0 verifiable credential, cryptographically signed by the issuer.",
    "Anyone can verify it from the badge page, without an account.",
  ].join("\n");

  const accentLink = (href: string, label: string): string =>
    `<a href="${escapeHtml(href)}" style="color:${escapeHtml(theme.accentColor)};text-decoration:underline;">${escapeHtml(label)}</a>`;

  const bodyHtml = [
    paragraph(
      escapeHtml(input.badgeTitle),
      `font-size:22px;line-height:30px;font-weight:700;color:${escapeHtml(theme.headerColor)};text-align:center;`,
    ),
    paragraph(
      issuerName.length > 0
        ? `Issued by <strong style="color:#334155;">${escapeHtml(issuerName)}</strong> on ${escapeHtml(issuedOn)}`
        : `Issued on ${escapeHtml(issuedOn)}`,
      "padding-top:6px;font-size:14px;line-height:20px;color:#64748b;text-align:center;",
    ),
    ...(description.length > 0
      ? [
          paragraph(
            escapeHtml(description),
            "padding-top:20px;font-size:15px;line-height:24px;color:#334155;text-align:center;",
          ),
        ]
      : []),
    `<div style="height:28px;line-height:28px;font-size:0;">&nbsp;</div>`,
    emailButton({ href: input.publicBadgeUrl, label: "View your badge", color: theme.accentColor }),
    `<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>`,
    linkedInEmailButton(linkedInUrl),
    paragraph(
      [
        ...(input.credentialPdfDownloadUrl === undefined
          ? []
          : [accentLink(input.credentialPdfDownloadUrl, "Download PDF")]),
        accentLink(input.credentialDownloadUrl, "Download credential"),
      ].join(" &nbsp;·&nbsp; "),
      "padding-top:22px;font-size:13px;line-height:20px;color:#64748b;text-align:center;",
    ),
  ].join("\n");

  const footerHtml = [
    `This badge is an <strong>Open Badges 3.0</strong> verifiable credential, cryptographically signed by the issuer. Anyone can verify it from the badge page, without an account.`,
    `<br><br>Sent by ${escapeHtml(brandName)} to ${escapeHtml(input.recipientEmail)} because this badge was issued to that address.`,
  ].join("");

  const html = renderEmailDocument({
    theme,
    title: subject,
    preheader: `${issuedLine}. View it, verify it, or add it to LinkedIn.`,
    header: {
      imageUrl: safeHttpUrl(input.badgeImageUrl),
      imageAlt: `${input.badgeTitle} badge`,
      eyebrow: brandName,
      heading: "Congratulations!",
      subheading: "You've earned a new badge",
    },
    bodyHtml,
    footerHtml,
  });

  return { subject, text, html };
};

export const sendIssuanceEmailNotification = async (
  input: SendIssuanceEmailNotificationInput,
): Promise<void> => {
  const content = buildIssuanceEmailContent(input);

  await sendTransactionalEmail({
    emailBinding: input.emailBinding,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    recipientEmail: input.recipientEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
    category: "Issuance Notification",
  });
};
