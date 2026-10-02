import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMAIL_THEME,
  emailButton,
  emailThemeFromBindings,
  escapeHtml,
  formatEmailDate,
  renderEmailDocument,
  safeHttpUrl,
} from "./email-layout";

describe("email layout helpers", () => {
  it("escapes HTML special characters", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
  });

  it("accepts only absolute http(s) URLs", () => {
    expect(safeHttpUrl("https://badges.example.edu/a.png")).toBe(
      "https://badges.example.edu/a.png",
    );
    expect(safeHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpUrl("/relative.png")).toBeUndefined();
    expect(safeHttpUrl("  ")).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
  });

  it("builds the theme from bindings and rejects invalid values", () => {
    expect(emailThemeFromBindings({})).toEqual(DEFAULT_EMAIL_THEME);
    expect(
      emailThemeFromBindings({
        EMAIL_THEME_HEADER_COLOR: "#000000",
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
    expect(
      emailThemeFromBindings({
        EMAIL_THEME_HEADER_COLOR: "red;background:url(x)",
        EMAIL_LOGO_URL: "javascript:alert(1)",
      }),
    ).toEqual(DEFAULT_EMAIL_THEME);
  });

  it("escapes button links and labels", () => {
    const html = emailButton({
      href: 'https://example.edu/?a=1&b="2"',
      label: "<Go>",
      color: "#123456",
    });

    expect(html).toContain('href="https://example.edu/?a=1&amp;b=&quot;2&quot;"');
    expect(html).toContain("&lt;Go&gt;");
    expect(html).not.toContain("<Go>");
  });

  it("renders a document with escaped header text and a safe image only", () => {
    const html = renderEmailDocument({
      theme: DEFAULT_EMAIL_THEME,
      title: "Title <x>",
      preheader: "Preview",
      header: {
        imageUrl: "javascript:alert(1)",
        eyebrow: "Brand",
        heading: "Hello <b>",
        subheading: "Sub",
      },
      bodyHtml: "<p>body</p>",
      footerHtml: "<p>footer</p>",
    });

    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("Hello &lt;b&gt;");
    expect(html).toContain("<title>Title &lt;x&gt;</title>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<p>body</p>");
  });

  it("formats dates in UTC and passes through invalid input", () => {
    expect(formatEmailDate("2026-10-02T23:30:00.000Z")).toBe("October 2, 2026");
    expect(formatEmailDate("not a date")).toBe("not a date");
  });
});
