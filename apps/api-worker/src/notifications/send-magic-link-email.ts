import {
  DEFAULT_EMAIL_THEME,
  emailButton,
  escapeHtml,
  renderEmailDocument,
  type EmailTheme,
} from "./email-layout";
import { sendTransactionalEmail } from "./transactional-email";

export interface SendMagicLinkEmailNotificationInput {
  emailBinding?: SendEmail | undefined;
  fromEmail?: string | undefined;
  fromName?: string | undefined;
  recipientEmail: string;
  tenantId?: string | undefined;
  magicLinkUrl: string;
  expiresAtIso: string;
  preferredLocale?: string | undefined;
  preferredTimeZone?: string | undefined;
  theme?: EmailTheme | undefined;
}

const DEFAULT_EXPIRY_LOCALE = "en-US";
const DEFAULT_EXPIRY_TIME_ZONE = "UTC";

export const formatMagicLinkExpiry = (input: {
  expiresAtIso: string;
  preferredLocale?: string | undefined;
  preferredTimeZone?: string | undefined;
}): string => {
  const expiresAt = new Date(input.expiresAtIso);

  if (!Number.isFinite(expiresAt.getTime())) {
    return input.expiresAtIso;
  }

  const locale =
    input.preferredLocale === undefined || input.preferredLocale.trim().length === 0
      ? DEFAULT_EXPIRY_LOCALE
      : input.preferredLocale.trim();
  const timeZone =
    input.preferredTimeZone === undefined || input.preferredTimeZone.trim().length === 0
      ? DEFAULT_EXPIRY_TIME_ZONE
      : input.preferredTimeZone.trim();
  const formatterOptions: Intl.DateTimeFormatOptions = {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };

  try {
    return new Intl.DateTimeFormat(locale, formatterOptions).format(expiresAt);
  } catch {
    return new Intl.DateTimeFormat(DEFAULT_EXPIRY_LOCALE, {
      ...formatterOptions,
      timeZone: DEFAULT_EXPIRY_TIME_ZONE,
    }).format(expiresAt);
  }
};

export const buildMagicLinkEmailContent = (
  input: SendMagicLinkEmailNotificationInput,
): { subject: string; text: string; html: string } => {
  const theme = input.theme ?? DEFAULT_EMAIL_THEME;
  const brandName = input.fromName?.trim() || "CredTrail";
  const subject =
    input.tenantId === undefined
      ? `Sign in to ${brandName}`
      : `Sign in to ${brandName} (${input.tenantId})`;
  const formattedExpiresAt = formatMagicLinkExpiry({
    expiresAtIso: input.expiresAtIso,
    preferredLocale: input.preferredLocale,
    preferredTimeZone: input.preferredTimeZone,
  });
  const text = [
    `Use the link below to sign in to ${brandName}:`,
    "",
    input.magicLinkUrl,
    "",
    ...(input.tenantId === undefined ? [] : [`Organization: ${input.tenantId}`]),
    `Expires: ${formattedExpiresAt}`,
    "",
    "If you did not ask to sign in, you can ignore this email. Nobody can sign in without this link.",
  ].join("\n");
  const font = "font-family:'Inter','Segoe UI',Helvetica,Arial,sans-serif;";
  const bodyHtml = [
    `<p style="margin:0;${font}font-size:16px;line-height:25px;color:#334155;text-align:center;">Use the button below to sign in${input.tenantId === undefined ? "" : ` to <strong>${escapeHtml(input.tenantId)}</strong>`}. The link works once and expires <strong>${escapeHtml(formattedExpiresAt)}</strong>.</p>`,
    `<div style="height:26px;line-height:26px;font-size:0;">&nbsp;</div>`,
    emailButton({
      href: input.magicLinkUrl,
      label: `Sign in to ${brandName}`,
      color: theme.accentColor,
    }),
    `<p style="margin:0;padding-top:26px;${font}font-size:13px;line-height:20px;color:#64748b;text-align:center;">If the button does not work, copy this link into your browser:</p>`,
    `<p style="margin:0;padding-top:6px;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:12px;line-height:18px;color:#475569;text-align:center;word-break:break-all;">${escapeHtml(input.magicLinkUrl)}</p>`,
  ].join("\n");
  const html = renderEmailDocument({
    theme,
    title: subject,
    preheader: `Your sign-in link for ${brandName}. It expires ${formattedExpiresAt}.`,
    header: {
      eyebrow: brandName,
      heading: "Sign in",
      subheading: "Your secure sign-in link is ready",
    },
    bodyHtml,
    footerHtml: `If you did not ask to sign in, you can ignore this email. Nobody can sign in without this link.<br><br>Sent by ${escapeHtml(brandName)} to ${escapeHtml(input.recipientEmail)}.`,
  });

  return { subject, text, html };
};

export const sendMagicLinkEmailNotification = async (
  input: SendMagicLinkEmailNotificationInput,
): Promise<void> => {
  const content = buildMagicLinkEmailContent(input);

  await sendTransactionalEmail({
    emailBinding: input.emailBinding,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    recipientEmail: input.recipientEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
    category: "Auth Magic Link",
  });
};
