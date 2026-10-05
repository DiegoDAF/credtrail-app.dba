import { describe, expect, it } from "vitest";

import { DEFAULT_EMAIL_THEME, emailThemeFromBindings, safeHttpUrl } from "./email-theme";

describe("emailThemeFromBindings", () => {
  it("uses the built-in palette without bindings", () => {
    expect(emailThemeFromBindings({})).toEqual(DEFAULT_EMAIL_THEME);
    expect(emailThemeFromBindings({}).logoUrl).toBeUndefined();
  });

  it("reads hex colors and an absolute logo URL", () => {
    expect(
      emailThemeFromBindings({
        EMAIL_THEME_HEADER_COLOR: " #000000 ",
        EMAIL_THEME_ACCENT_COLOR: "#2E7D32",
        EMAIL_THEME_HIGHLIGHT_COLOR: "#5f5",
        EMAIL_LOGO_URL: "https://example.edu/logo.png",
      }),
    ).toEqual({
      headerColor: "#000000",
      accentColor: "#2E7D32",
      highlightColor: "#5f5",
      logoUrl: "https://example.edu/logo.png",
    });
  });

  it("falls back to the defaults for values that are not a hex color or an http(s) URL", () => {
    expect(
      emailThemeFromBindings({
        EMAIL_THEME_HEADER_COLOR: "red;background:url(x)",
        EMAIL_THEME_ACCENT_COLOR: "#12345",
        EMAIL_THEME_HIGHLIGHT_COLOR: "",
        EMAIL_LOGO_URL: "javascript:alert(1)",
      }),
    ).toEqual(DEFAULT_EMAIL_THEME);
  });
});

describe("safeHttpUrl", () => {
  it("accepts absolute http(s) URLs only", () => {
    expect(safeHttpUrl("https://example.edu/logo.png")).toBe("https://example.edu/logo.png");
    expect(safeHttpUrl("http://example.edu/logo.png")).toBe("http://example.edu/logo.png");
    for (const value of [undefined, null, "", "  ", "/logo.png", "data:image/png;base64,AAAA"]) {
      expect(safeHttpUrl(value)).toBeUndefined();
    }
  });
});
