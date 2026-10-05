/** Issuer look for transactional emails: colors and an optional logo, read from optional bindings. */
export interface EmailTheme {
  /** Top border of the message card. */
  readonly headerColor: string;
  /** Buttons and links. */
  readonly accentColor: string;
  /** Brand label above the heading. */
  readonly highlightColor: string;
  /** Absolute http(s) logo shown at the top of every email that has no hero image. */
  readonly logoUrl?: string | undefined;
}

export interface EmailThemeBindings {
  readonly EMAIL_THEME_HEADER_COLOR?: string | undefined;
  readonly EMAIL_THEME_ACCENT_COLOR?: string | undefined;
  readonly EMAIL_THEME_HIGHLIGHT_COLOR?: string | undefined;
  readonly EMAIL_LOGO_URL?: string | undefined;
}

/** The built-in CredTrail palette: without bindings the emails render exactly as before. */
export const DEFAULT_EMAIL_THEME: EmailTheme = {
  headerColor: "#0f5fa6",
  accentColor: "#0f5fa6",
  highlightColor: "#0f5fa6",
};

const safeHexColor = (value: string | undefined, fallback: string): string => {
  const candidate = value?.trim() ?? "";
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(candidate) ? candidate : fallback;
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

/** Invalid colors and URLs fall back to the defaults instead of failing a notification. */
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
