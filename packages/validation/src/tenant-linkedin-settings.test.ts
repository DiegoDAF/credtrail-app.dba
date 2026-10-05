import { describe, expect, it } from "vitest";
import {
  linkedinOrganizationIdSchema,
  updateTenantLinkedInSettingsRequestSchema,
} from "./tenant-linkedin-settings";

describe("LinkedIn organization IDs", () => {
  it.each(["1", "12345", "90071992547409931234"])("preserves %s exactly", (id) => {
    expect(linkedinOrganizationIdSchema.parse(id)).toBe(id);
    expect(updateTenantLinkedInSettingsRequestSchema.parse({ organizationId: ` ${id} ` })).toEqual({
      organizationId: id,
    });
  });
  it.each([
    "0",

    "0123",
    "-1",
    "+1",
    "1.2",
    "1e3",
    "12 34",
    "１２",
    "123456789012345678901",
    "https://linkedin.com/company/123",
    "urn:li:organization:123",
    123,
    null,
    undefined,
  ])("rejects invalid ID %s", (id) => {
    expect(linkedinOrganizationIdSchema.safeParse(id).success).toBe(false);
    expect(
      updateTenantLinkedInSettingsRequestSchema.safeParse({ organizationId: id }).success,
    ).toBe(false);
  });
  it("rejects trailing newlines in canonical IDs", () => {
    expect(linkedinOrganizationIdSchema.safeParse("123\n").success).toBe(false);
    expect(linkedinOrganizationIdSchema.safeParse("123\r\n").success).toBe(false);
  });
  it("requires an explicit blank to clear", () => {
    expect(updateTenantLinkedInSettingsRequestSchema.parse({ organizationId: "  " })).toEqual({
      organizationId: null,
    });
    expect(updateTenantLinkedInSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateTenantLinkedInSettingsRequestSchema.safeParse({
        organizationId: "123",
        tenantId: "other",
      }).success,
    ).toBe(false);
  });
});
