import { describe, expect, it } from "vitest";
import { linkedInAddToProfileUrl, linkedInOrganizationIdForTenant } from "./display-format";

const baseInput = {
  badgeName: "DBAses Member",
  issuerName: "DBAses",
  issuedAtIso: "2026-10-02T20:03:25.821Z",
  credentialUrl: "https://badges.example.edu/badges/c102f574",
  credentialId: "c102f574",
};

describe("linkedInAddToProfileUrl", () => {
  it("sends the organization name when there is no company page ID", () => {
    const url = new URL(linkedInAddToProfileUrl(baseInput));

    expect(url.searchParams.get("organizationName")).toBe("DBAses");
    expect(url.searchParams.has("organizationId")).toBe(false);
    expect(url.searchParams.get("issueYear")).toBe("2026");
    expect(url.searchParams.get("issueMonth")).toBe("10");
  });

  it("sends only the company page ID when one is configured", () => {
    const url = new URL(linkedInAddToProfileUrl({ ...baseInput, organizationId: "110806030" }));

    expect(url.searchParams.get("organizationId")).toBe("110806030");
    expect(url.searchParams.has("organizationName")).toBe(false);
  });

  it("falls back to the name when the page ID is not numeric", () => {
    const url = new URL(linkedInAddToProfileUrl({ ...baseInput, organizationId: "dbases" }));

    expect(url.searchParams.has("organizationId")).toBe(false);
    expect(url.searchParams.get("organizationName")).toBe("DBAses");
  });
});

describe("linkedInOrganizationIdForTenant", () => {
  it("finds the page ID for the tenant", () => {
    expect(linkedInOrganizationIdForTenant("dbases:110806030,acme:123", "dbases")).toBe(
      "110806030",
    );
    expect(linkedInOrganizationIdForTenant(" dbases : 110806030 , acme:123 ", "acme")).toBe("123");
  });

  it("returns undefined for unknown tenants, empty config and malformed entries", () => {
    expect(linkedInOrganizationIdForTenant("dbases:110806030", "acme")).toBeUndefined();
    expect(linkedInOrganizationIdForTenant(undefined, "dbases")).toBeUndefined();
    expect(linkedInOrganizationIdForTenant("", "dbases")).toBeUndefined();
    expect(linkedInOrganizationIdForTenant("dbases", "dbases")).toBeUndefined();
    expect(linkedInOrganizationIdForTenant(":110806030", "")).toBeUndefined();
    expect(linkedInOrganizationIdForTenant("dbases:abc", "dbases")).toBeUndefined();
  });
});
