import type { TenantMembershipRole, TenantRecord } from "@credtrail/db";
import type { LinkedInOrganizationId } from "@credtrail/validation";
import type { AppPage } from "../ui/render-page";
import { CtFieldError, CtFieldHint } from "../ui/forms";
import { AdminButton, AdminField, AdminForm, AdminPanel, AdminStatus } from "./components";
import { buildInstitutionAdminSidebarPaths } from "./institution-admin-sidebar";
import {
  renderInstitutionAdminPageHeader,
  renderInstitutionAdminShellPage,
} from "./institution-admin-shell";

/** A single institution-level setting for existing and future credentials. */
export const institutionAdminSharingPage = (input: {
  readonly tenant: TenantRecord;
  readonly userId: string;
  readonly membershipRole: TenantMembershipRole;
  readonly organizationId: LinkedInOrganizationId | null;
  readonly submittedValue?: string;
  readonly error?: string;
  readonly flash: { readonly tone: "success" | "error"; readonly message: string } | null;
}): AppPage => {
  return renderInstitutionAdminShellPage({
    tenant: input.tenant,
    userId: input.userId,
    membershipRole: input.membershipRole,
    view: "credentialSharing",
    title: `Credential sharing · ${input.tenant.displayName}`,
    assets: ["institutionAdminCss", "institutionAdminShellJs"],
    contextJson: {},
    children: (
      <>
        {renderInstitutionAdminPageHeader(
          "Credential sharing",
          "Choose how your institution appears when learners add a badge to their LinkedIn profile.",
        )}
        {input.flash === null ? null : (
          <AdminStatus tone={input.flash.tone}>{input.flash.message}</AdminStatus>
        )}
        <AdminPanel stack>
          <h2>LinkedIn profile</h2>
          <p>
            {input.organizationId === null
              ? "Currently using the issuer name from each credential."
              : `Currently using LinkedIn organization ID ${input.organizationId}.`}
          </p>
          <AdminForm
            method="post"
            action={buildInstitutionAdminSidebarPaths(input.tenant.id).credentialSharingPath}
          >
            <AdminField label="LinkedIn organization ID">
              <input
                id="linkedin-organization-id"
                name="organizationId"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                maxlength={20}
                value={input.submittedValue ?? input.organizationId ?? ""}
                class="ct-input ct-field__control"
                aria-invalid={input.error === undefined ? undefined : "true"}
                aria-describedby={
                  input.error === undefined
                    ? "linkedin-organization-help"
                    : "linkedin-organization-help linkedin-organization-error"
                }
              />
              <CtFieldHint id="linkedin-organization-help">
                Use the numeric ID of your institution’s LinkedIn Page. Leave blank to use the
                issuer name.
              </CtFieldHint>
              {input.error === undefined ? null : (
                <CtFieldError id="linkedin-organization-error">{input.error}</CtFieldError>
              )}
            </AdminField>
            <AdminButton type="submit">Save LinkedIn setting</AdminButton>
          </AdminForm>
          <p>
            This applies to all badges issued by your institution, including existing badges.
            LinkedIn may ask learners to enter certification details.
          </p>
        </AdminPanel>
      </>
    ),
  });
};
