import { describe, expect, it } from "vitest";
import { linkedinOrganizationIdSchema } from "@credtrail/validation";
import { renderAppPageToString } from "../ui/render-page";
import { institutionAdminSharingPage } from "./institution-admin-sharing-page";
const tenant = {
  id: "tenant_123",
  slug: "example",
  displayName: "Example University",
  planTier: "free" as const,
  issuerDomain: "example.edu",
  didWeb: "did:web:example.edu",
  isActive: true,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
describe("credential sharing settings page", () => {
  it("renders the existing shell and a single optional text field with a clear action", () => {
    const html = renderAppPageToString(
      institutionAdminSharingPage({
        tenant,
        userId: "user",
        membershipRole: "owner",
        organizationId: linkedinOrganizationIdSchema.parse("123"),
        flash: { tone: "success", message: "LinkedIn setting saved." },
      }),
    );
    expect(html).toContain('action="/tenants/tenant_123/admin/sharing"');
    expect(html).toContain('method="post"');
    expect(html).toContain('inputmode="numeric"');
    expect(html).toContain('value="123"');
    expect(html).toContain("Save LinkedIn setting");
    expect(html).toContain("LinkedIn may ask learners to enter certification details.");
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('type="number"');
  });
  it("associates the error and escapes the submitted value", () => {
    const html = renderAppPageToString(
      institutionAdminSharingPage({
        tenant,
        userId: "user",
        membershipRole: "admin",
        organizationId: null,
        submittedValue: '"><script>alert(1)</script>',
        error: "Enter the numeric LinkedIn organization ID, or leave it blank.",
        flash: null,
      }),
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(
      'aria-describedby="linkedin-organization-help linkedin-organization-error"',
    );
    expect(html).toContain('id="linkedin-organization-error"');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Currently using the issuer name");
  });
});
