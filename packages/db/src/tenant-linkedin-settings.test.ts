import { expect, it } from "vitest";
import { linkedinOrganizationIdSchema } from "@credtrail/validation";
import {
  findTenantLinkedInSettings,
  updateTenantLinkedInSettings,
} from "./tenant-linkedin-settings";
import { findTenantById, upsertTenant } from "./tenants";
import { listAuditLogs } from "./audit-logs";
import {
  cleanupTestResources,
  createBadgeRuleIntegrationFixture,
  createTestTenantFixture,
  describeDbIntegration,
} from "./postgres-test-support";

describeDbIntegration("institution LinkedIn settings", () => {
  it("saves, changes and clears with isolated, accurate audit history and preserves settings on tenant upsert", async () => {
    const a = await createBadgeRuleIntegrationFixture();
    const b = await createTestTenantFixture();
    try {
      expect(await findTenantLinkedInSettings(a.db, a.tenantId)).toEqual({
        tenantId: a.tenantId,
        organizationId: null,
      });
      const ids = [
        linkedinOrganizationIdSchema.parse("90071992547409931234"),
        linkedinOrganizationIdSchema.parse("123"),
        null,
      ];
      for (const organizationId of ids) {
        expect(
          await updateTenantLinkedInSettings(a.db, {
            tenantId: a.tenantId,
            organizationId,
            actorUserId: a.userId,
          }),
        ).toEqual({ status: "updated", settings: { tenantId: a.tenantId, organizationId } });
        expect((await findTenantLinkedInSettings(a.db, a.tenantId))?.organizationId).toBe(
          organizationId,
        );
        expect((await findTenantLinkedInSettings(a.db, b.tenantId))?.organizationId).toBeNull();
      }
      const logs = await listAuditLogs(a.db, {
        tenantId: a.tenantId,
        action: "tenant.linkedin_organization.updated",
      });
      expect(logs).toHaveLength(3);
      expect(logs.map((log) => JSON.parse(log.metadataJson ?? "null"))).toEqual(
        expect.arrayContaining([
          { previousOrganizationId: null, organizationId: ids[0] },
          { previousOrganizationId: ids[0], organizationId: ids[1] },
          { previousOrganizationId: ids[1], organizationId: null },
        ]),
      );
      expect(logs.every((log) => log.actorUserId === a.userId && log.targetId === a.tenantId)).toBe(
        true,
      );
      await updateTenantLinkedInSettings(a.db, {
        tenantId: a.tenantId,
        organizationId: ids[0] ?? null,
        actorUserId: a.userId,
      });
      const tenant = await findTenantById(a.db, a.tenantId);
      if (tenant === null) throw new Error("Fixture tenant missing");
      await upsertTenant(a.db, {
        id: tenant.id,
        slug: tenant.slug,
        displayName: "Renamed institution",
        planTier: tenant.planTier,
        issuerDomain: tenant.issuerDomain,
        didWeb: tenant.didWeb,
      });
      expect((await findTenantLinkedInSettings(a.db, a.tenantId))?.organizationId).toBe(ids[0]);
      expect(await findTenantLinkedInSettings(a.db, "missing-institution")).toBeNull();
      expect(
        await updateTenantLinkedInSettings(a.db, {
          tenantId: "missing-institution",
          organizationId: null,
          actorUserId: a.userId,
        }),
      ).toEqual({ status: "not_found" });
    } finally {
      await cleanupTestResources(a.db, {
        tenantIds: [a.tenantId, b.tenantId],
        userIds: [a.userId],
      });
    }
  });
  it("rolls back the setting if its audit record fails", async () => {
    const f = await createBadgeRuleIntegrationFixture();
    try {
      await expect(
        updateTenantLinkedInSettings(f.db, {
          tenantId: f.tenantId,
          organizationId: linkedinOrganizationIdSchema.parse("321"),
          actorUserId: "missing-user",
        }),
      ).rejects.toThrow(/foreign key constraint/u);
      expect((await findTenantLinkedInSettings(f.db, f.tenantId))?.organizationId).toBeNull();
      expect(
        await listAuditLogs(f.db, {
          tenantId: f.tenantId,
          action: "tenant.linkedin_organization.updated",
        }),
      ).toHaveLength(0);
    } finally {
      await cleanupTestResources(f.db, { tenantIds: [f.tenantId], userIds: [f.userId] });
    }
  });
  it.each(["0", "001", "-1", "1.5", "1e3", "x", "123\n", "123456789012345678901"])(
    "rejects invalid persisted ID %s",
    async (id) => {
      const f = await createTestTenantFixture();
      try {
        await expect(
          f.db
            .prepare("UPDATE tenants SET linkedin_organization_id = ? WHERE id = ?")
            .bind(id, f.tenantId)
            .run(),
        ).rejects.toThrow(/check constraint/u);
      } finally {
        await cleanupTestResources(f.db, { tenantIds: [f.tenantId] });
      }
    },
  );
});
