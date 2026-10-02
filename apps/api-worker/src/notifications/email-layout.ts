export interface EmailTheme {
  /** Header band and badge title color. */
  readonly headerColor: string;
  /** Primary button color. */
  readonly accentColor: string;
  /** Small monospace line above the header heading. */
  readonly highlightColor: string;
  /** Optional https logo shown in the header when there is no badge image. */
  readonly logoUrl?: string | undefined;
}

export interface EmailThemeBindings {
  readonly EMAIL_THEME_HEADER_COLOR?: string | undefined;
  readonly EMAIL_THEME_ACCENT_COLOR?: string | undefined;
  readonly EMAIL_THEME_HIGHLIGHT_COLOR?: string | undefined;
  readonly EMAIL_LOGO_URL?: string | undefined;
}

export const DEFAULT_EMAIL_THEME: EmailTheme = {
  headerColor: "#0f2742",
  accentColor: "#2f6fb0",
  highlightColor: "#a9bcd0",
};

const LINKEDIN_BLUE = "#0a66c2";
const FONT_STACK = "'Inter','Segoe UI',Helvetica,Arial,sans-serif";
const MONO_STACK = "'JetBrains Mono',Menlo,Consolas,'Courier New',monospace";

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (value: string): string => {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
};

const safeHexColor = (value: string | undefined, fallback: string): string => {
  const candidate = value?.trim() ?? "";
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(candidate) ? candidate : fallback;
};

/** Returns the URL only when it is an absolute http(s) URL, so it is safe inside href/src. */
export const safeHttpUrl = (value: string | null | undefined): string | undefined => {
  const candidate = value?.trim() ?? "";

  if (candidate.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

export const emailThemeFromBindings = (bindings: EmailThemeBindings): EmailTheme => {
  const logoUrl = safeHttpUrl(bindings.EMAIL_LOGO_URL);

  return {
    headerColor: safeHexColor(bindings.EMAIL_THEME_HEADER_COLOR, DEFAULT_EMAIL_THEME.headerColor),
    accentColor: safeHexColor(bindings.EMAIL_THEME_ACCENT_COLOR, DEFAULT_EMAIL_THEME.accentColor),
    highlightColor: safeHexColor(
      bindings.EMAIL_THEME_HIGHLIGHT_COLOR,
      DEFAULT_EMAIL_THEME.highlightColor,
    ),
    ...(logoUrl === undefined ? {} : { logoUrl }),
  };
};

export const emailButton = (input: {
  readonly href: string;
  readonly label: string;
  readonly color: string;
}): string => {
  const href = escapeHtml(input.href);
  const label = escapeHtml(input.label);
  const color = safeHexColor(input.color, DEFAULT_EMAIL_THEME.accentColor);

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
<tr><td align="center" bgcolor="${color}" style="background-color:${color};border-radius:8px;">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:240px;" arcsize="17%" fillcolor="${color}" stroke="f"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a href="${href}" style="display:inline-block;padding:13px 30px;font-family:${FONT_STACK};font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px;background-color:${color};">${label}</a><!--<![endif]-->
</td></tr>
</table>`;
};

export const linkedInEmailButton = (href: string): string => {
  return emailButton({ href, label: "Add to LinkedIn", color: LINKEDIN_BLUE });
};

export interface EmailDocumentInput {
  readonly theme: EmailTheme;
  /** Document title and accessible name. */
  readonly title: string;
  /** Hidden inbox preview text. */
  readonly preheader: string;
  readonly header: {
    readonly imageUrl?: string | undefined;
    readonly imageAlt?: string | undefined;
    readonly eyebrow?: string | undefined;
    readonly heading: string;
    readonly subheading?: string | undefined;
  };
  /** Trusted HTML built by the caller with escaped values. */
  readonly bodyHtml: string;
  /** Trusted HTML built by the caller with escaped values. */
  readonly footerHtml: string;
}

/** Table-based, inline-styled layout that renders in Gmail, Outlook and Apple Mail. */
export const renderEmailDocument = (input: EmailDocumentInput): string => {
  const header = safeHexColor(input.theme.headerColor, DEFAULT_EMAIL_THEME.headerColor);
  const highlight = safeHexColor(input.theme.highlightColor, DEFAULT_EMAIL_THEME.highlightColor);
  const imageUrl = safeHttpUrl(input.header.imageUrl);
  const logoUrl = imageUrl === undefined ? safeHttpUrl(input.theme.logoUrl) : undefined;
  const headerImage =
    imageUrl !== undefined
      ? `<img src="${escapeHtml(imageUrl)}" width="128" height="128" alt="${escapeHtml(input.header.imageAlt ?? "")}" style="display:block;margin:0 auto 18px;width:128px;height:128px;border:0;outline:none;">`
      : logoUrl !== undefined
        ? `<img src="${escapeHtml(logoUrl)}" width="180" height="180" alt="" style="display:block;margin:-12px auto 4px;width:180px;height:180px;border:0;outline:none;">`
        : "";
  const eyebrow =
    input.header.eyebrow === undefined
      ? ""
      : `<p style="margin:0 0 10px;font-family:${MONO_STACK};font-size:12px;line-height:16px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${highlight};">${escapeHtml(input.header.eyebrow)}</p>`;
  const subheading =
    input.header.subheading === undefined
      ? ""
      : `<p style="margin:8px 0 0;font-family:${FONT_STACK};font-size:16px;line-height:24px;color:#d6e0ea;">${escapeHtml(input.header.subheading)}</p>`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
body,table,td{font-family:${FONT_STACK};}
img{border:0;display:block;}
a{color:${escapeHtml(input.theme.accentColor)};}
@media only screen and (max-width:620px){.email-container{width:100% !important;}.email-pad{padding-left:20px !important;padding-right:20px !important;}}
</style>
</head>
<body style="margin:0;padding:0;background-color:#eef2f6;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#eef2f6;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f6;">
<tr><td align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="email-container" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #dde4ec;border-radius:14px;overflow:hidden;">
<tr><td align="center" bgcolor="${header}" class="email-pad" style="background-color:${header};padding:36px 32px 32px;">
${headerImage}${eyebrow}<h1 style="margin:0;font-family:${FONT_STACK};font-size:26px;line-height:32px;font-weight:700;color:#ffffff;">${escapeHtml(input.header.heading)}</h1>${subheading}
</td></tr>
<tr><td class="email-pad" style="padding:32px 36px 28px;">
${input.bodyHtml}
</td></tr>
<tr><td class="email-pad" style="padding:0 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #e6ebf1;font-size:0;line-height:0;">&nbsp;</td></tr></table></td></tr>
<tr><td class="email-pad" style="padding:20px 36px 28px;font-family:${FONT_STACK};font-size:12px;line-height:19px;color:#7a8898;">
${input.footerHtml}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
};

export const formatEmailDate = (iso: string): string => {
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
