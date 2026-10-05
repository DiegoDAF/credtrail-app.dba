import {
  findTenantById,
  findTenantLinkedInSettings,
  updateTenantLinkedInSettings,
  type TenantMembershipRole,
} from "@credtrail/db";
import {
  parseTenantPathParams,
  updateTenantLinkedInSettingsRequestSchema,
} from "@credtrail/validation";
import type { Hono } from "hono";
import type { AppContext, AppEnv } from "../app/types";
import type { ResolveDatabase } from "../app/route-deps";
import type { AuthenticatedPrincipal } from "../auth/auth-context";
import {
  consumeAdminListMessageFlash,
  setAdminListMessageFlash,
} from "../admin/admin-list-message-flash";
import { buildInstitutionAdminSidebarPaths } from "../admin/institution-admin-sidebar";
import { institutionAdminSharingPage } from "../admin/institution-admin-sharing-page";
import { renderAppPage } from "../ui/render-page";

/** Registers the institution-level setting behind the existing administrator guard. */
export const registerTenantSharingAdminRoutes = (input: {
  readonly app: Hono<AppEnv>;
  readonly resolveDatabase: ResolveDatabase;
  readonly resolveInstitutionAdminAdminRole: (
    c: AppContext,
    tenantId: string,
    nextPath: string,
  ) => Promise<
    Response | { principal: AuthenticatedPrincipal; membershipRole: TenantMembershipRole }
  >;
}): void => {
  input.app.on(["GET", "POST"], "/tenants/:tenantId/admin/sharing", async (c) => {
    c.header("Cache-Control", "no-store");
    const { tenantId } = parseTenantPathParams(c.req.param());
    const nextPath = buildInstitutionAdminSidebarPaths(tenantId).credentialSharingPath;
    const actor = await input.resolveInstitutionAdminAdminRole(c, tenantId, nextPath);
    if (actor instanceof Response) return actor;
    const db = input.resolveDatabase(c.env);
    const tenant = await findTenantById(db, tenantId);
    if (tenant === null) return c.text("Institution not found.", 404);
    if (c.req.method === "POST") {
      const raw = Object.fromEntries(await c.req.formData());
      const parsed = updateTenantLinkedInSettingsRequestSchema.safeParse(raw);
      if (parsed.success) {
        const result = await updateTenantLinkedInSettings(db, {
          tenantId,
          organizationId: parsed.data.organizationId,
          actorUserId: actor.principal.userId,
        });
        if (result.status === "not_found") return c.text("Institution not found.", 404);
        await setAdminListMessageFlash(c, {
          tenantId,
          userId: actor.principal.userId,
          workspace: "credential_sharing",
          tone: "success",
          message:
            parsed.data.organizationId === null
              ? "LinkedIn setting cleared. Profile links will use the issuer name."
              : "LinkedIn setting saved.",
        });
        return c.redirect(nextPath, 303);
      }
      const settings = await findTenantLinkedInSettings(db, tenantId);
      if (settings === null) return c.text("Institution not found.", 404);
      return renderAppPage(
        c,
        institutionAdminSharingPage({
          tenant,
          membershipRole: actor.membershipRole,
          userId: actor.principal.userId,
          organizationId: settings.organizationId,
          submittedValue: typeof raw.organizationId === "string" ? raw.organizationId : "",
          error: "Enter the numeric LinkedIn organization ID, or leave it blank.",
          flash: null,
        }),
        400,
      );
    }
    const settings = await findTenantLinkedInSettings(db, tenantId);
    if (settings === null) return c.text("Institution not found.", 404);
    const flash = await consumeAdminListMessageFlash(c, {
      tenantId,
      userId: actor.principal.userId,
      workspace: "credential_sharing",
    });
    return renderAppPage(
      c,
      institutionAdminSharingPage({
        tenant,
        userId: actor.principal.userId,
        membershipRole: actor.membershipRole,
        organizationId: settings.organizationId,
        flash,
      }),
    );
  });
};
