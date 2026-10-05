import { describe, expect, it } from "vitest";
import { publicBadgeLinkPreview } from "./public-badge-link-preview";

describe("credential preview artwork selection", () => {
  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,aGVsbG8=",
    "ftp://example.edu/image.png",
    "https://user:password@example.edu/image.png",
    "http://localhost/image.png",
    "http://10.0.0.1/image.png",
    "http://[::1]/image.png",
    "https://storage.internal/image.png",
    "http://storage/image.png",
    "https://[invalid/image.png",
    " ",
  ])("uses the public issuer logo when badge artwork is unusable (%s)", (image) => {
    const preview = publicBadgeLinkPreview(
      {
        issuer: { name: "Example University", image: "/logo.png" },
        credentialSubject: { achievement: { name: "Research", image } },
      },
      "https://badges.example.edu/badges/public-badge",
    );
    expect(preview.imageUrl).toBe("https://badges.example.edu/logo.png");
    expect(preview.imageAlt).toContain("Example University");
    expect(preview.description).toContain("Research");
    expect(preview.description).toContain("Example University");
  });

  it("does not present an internal issuer identifier as branding when a name is absent", () => {
    const preview = publicBadgeLinkPreview(
      { issuer: { id: "did:web:example.edu:tenant_123", name: " " } },
      "https://badges.example.edu/badges/public-badge",
    );
    expect(preview.siteName).toBe("CredTrail");
    expect(preview.title).not.toContain("tenant_123");
    expect(preview.description).not.toContain("issued by CredTrail");
    expect(preview.imageUrl).toBeNull();
    expect(preview.imageAlt).toBeNull();
  });
});
