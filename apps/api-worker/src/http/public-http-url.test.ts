import { describe, expect, it } from "vitest";
import { publicHttpUrl } from "./public-http-url";

describe("static public HTTP URL parsing", () => {
  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,aGVsbG8=",
    "ftp://example.edu/image.png",
    "https://user:password@example.edu/image.png",
    "http://localhost/image.png",
    "http://storage.internal/image.png",
    "http://storage.local/image.png",
    "http://127.0.0.1/image.png",
    "http://2130706433/image.png",
    "http://10.0.0.1/image.png",
    "http://169.254.169.254/image.png",
    "http://[::1]/image.png",
    "http://[::ffff:7f00:1]/image.png",
    "http://[fc00::1]/image.png",
    "https://[invalid/image.png",
    " ",
  ])("rejects an unusable URL even with a public base (%s)", (value) => {
    expect(publicHttpUrl(value, "https://badges.example.edu/badges/public-badge")).toBeNull();
  });

  it.each([
    "https://cdn.example.edu/image.png",
    "http://93.184.216.34/image.png",
    "http://storage/image.png",
  ])("accepts a candidate before the fetch path validates DNS (%s)", (value) => {
    expect(publicHttpUrl(value)?.toString()).toBe(value);
  });

  it.each([
    "https://badges.example.edu/badges/public-badge",
    new URL("https://badges.example.edu/badges/public-badge"),
  ])("resolves relative artwork against a public string or URL base", (base) => {
    expect(publicHttpUrl("/badge.png", base)?.toString()).toBe(
      "https://badges.example.edu/badge.png",
    );
    expect(publicHttpUrl("/badge.png")).toBeNull();
  });
});
