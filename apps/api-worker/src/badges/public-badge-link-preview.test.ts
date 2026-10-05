import { describe, expect, it } from "vitest";
import { publicBadgeLinkPreview } from "./public-badge-link-preview";

describe("credential preview artwork selection", () => {
  it.each([
    {
      scenario: "badge artwork wins over the issuer logo",
      badgeImage: { id: "/badge.png" },
      issuerImage: "/logo.png",
      expectedImage: "https://badges.example.edu/badge.png",
      expectedAlt: "Research badge artwork",
    },
    {
      scenario: "a public external badge image keeps its origin",
      badgeImage: "https://cdn.example.edu/badge.png",
      issuerImage: "/logo.png",
      expectedImage: "https://cdn.example.edu/badge.png",
      expectedAlt: "Research badge artwork",
    },
    {
      scenario: "missing badge artwork uses the issuer logo",
      badgeImage: null,
      issuerImage: { id: "/logo.png" },
      expectedImage: "https://badges.example.edu/logo.png",
      expectedAlt: "Example University logo",
    },
    {
      scenario: "private badge artwork uses the public issuer logo",
      badgeImage: "http://10.0.0.1/badge.png",
      issuerImage: "/logo.png",
      expectedImage: "https://badges.example.edu/logo.png",
      expectedAlt: "Example University logo",
    },
    {
      scenario: "missing artwork yields a text preview",
      badgeImage: null,
      issuerImage: null,
      expectedImage: null,
      expectedAlt: null,
    },
    {
      scenario: "unusable badge and issuer artwork yields a text preview",
      badgeImage: "javascript:alert(1)",
      issuerImage: "https://user:password@example.edu/logo.png",
      expectedImage: null,
      expectedAlt: null,
    },
  ])("$scenario", ({ badgeImage, issuerImage, expectedImage, expectedAlt }) => {
    const preview = publicBadgeLinkPreview(
      {
        issuer: { name: "Example University", image: issuerImage },
        credentialSubject: {
          achievement: { name: "Research", description: "Course completed.", image: badgeImage },
        },
      },
      "https://badges.example.edu/badges/public-badge",
    );
    expect(preview.imageUrl).toBe(expectedImage);
    expect(preview.imageAlt).toBe(expectedAlt);
    expect(preview.title).toContain("Research");
    expect(preview.title).toContain("Example University");
    expect(preview.siteName).toBe("Example University");
    expect(preview.description).toContain("Research");
    expect(preview.description).toContain("Example University");
    expect(preview.description).toContain("Course completed.");
  });

  it.each([
    { id: "did:web:example.edu:tenant_123", name: " " },
    "did:web:example.edu:raw-tenant-id",
    { id: "https://example.edu/issuer" },
    null,
  ])("does not present issuer identifiers as branding (%j)", (issuer) => {
    const preview = publicBadgeLinkPreview(
      { issuer, credentialSubject: { achievement: { name: "Research" } } },
      "https://badges.example.edu/badges/public-badge",
    );
    expect(preview.siteName).toBe("CredTrail");
    expect(preview.title).toBe("Research | CredTrail");
    expect(preview.description).not.toContain("issued by CredTrail");
    expect(preview.description).not.toContain("example.edu");
    expect(preview.imageUrl).toBeNull();
    expect(preview.imageAlt).toBeNull();
  });
});
