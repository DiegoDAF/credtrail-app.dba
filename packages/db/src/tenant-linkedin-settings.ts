import { linkedinOrganizationIdSchema, type LinkedInOrganizationId } from "@credtrail/validation";
import { z } from "zod";
import { createAuditLog } from "./audit-logs";
import { runSqlTransaction, type SqlDatabase } from "./tenant-scope";

const settingsSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: linkedinOrganizationIdSchema.nullable(),
});
export type TenantLinkedInSettings = z.infer<typeof settingsSchema>;

/** Distinguishes a missing institution from an existing, unconfigured institution. */
export const findTenantLinkedInSettings = async (
  db: SqlDatabase,
  tenantId: string,
): Promise<TenantLinkedInSettings | null> => {
  const row = await db
    .prepare(
      `SELECT id AS tenantId, linkedin_organization_id AS organizationId FROM tenants WHERE id = ?`,
    )
    .bind(tenantId)
    .first<unknown>();
  return row === null ? null : settingsSchema.parse(row);
};

/** Saves the institution setting and its audit record in one transaction. */
export const updateTenantLinkedInSettings = async (
  db: SqlDatabase,
  input: {
    readonly tenantId: string;
    readonly organizationId: LinkedInOrganizationId | null;
    readonly actorUserId: string;
  },
): Promise<
  | { readonly status: "updated"; readonly settings: TenantLinkedInSettings }
  | { readonly status: "not_found" }
> => {
  return runSqlTransaction(db, async (tx) => {
    const row = await tx
      .prepare(
        `SELECT id AS tenantId, linkedin_organization_id AS organizationId FROM tenants WHERE id = ? FOR UPDATE`,
      )
      .bind(input.tenantId)
      .first<unknown>();
    if (row === null) return { status: "not_found" };
    const previous = settingsSchema.parse(row);
    await tx
      .prepare(`UPDATE tenants SET linkedin_organization_id = ?, updated_at = ? WHERE id = ?`)
      .bind(input.organizationId, new Date().toISOString(), input.tenantId)
      .run();
    await createAuditLog(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tenant.linkedin_organization.updated",
      targetType: "tenant",
      targetId: input.tenantId,
      metadata: {
        previousOrganizationId: previous.organizationId,
        organizationId: input.organizationId,
      },
    });
    return {
      status: "updated",
      settings: { tenantId: input.tenantId, organizationId: input.organizationId },
    };
  });
};
