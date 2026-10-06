import { z } from "zod";
import type { ProgrammaticAssertionQuery, ProgrammaticTemplateQuery } from "@credtrail/validation";
import {
  effectiveAssertionLifecycleStateSql,
  latestAssertionLifecycleJoinSql,
} from "./assertion-lifecycle-sql.js";
import type { SqlDatabase } from "./tenant-scope.js";

const templateRowSchema = z.object({
  badgeTemplateId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  criteriaUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  archived: z.boolean(),
});
/** Storage projection used for programmatic template reads. */
export type ProgrammaticTemplateRecord = z.infer<typeof templateRowSchema>;
const assertionRowSchema = z.object({
  assertionId: z.string(),
  publicId: z.string().nullable(),
  badgeTemplateId: z.string(),
  recipientIdentity: z.string(),
  recipientIdentityType: z.enum(["email", "email_sha256", "did", "url"]),
  issuedAt: z.string(),
  validUntil: z.string().nullable(),
  state: z.enum(["active", "suspended", "revoked", "expired"]),
});
/** Storage projection without credential blobs, keys, or administrative metadata. */
export type ProgrammaticAssertionRecord = z.infer<typeof assertionRowSchema>;
const templateSelect = `id AS badgeTemplateId, title, description,
  criteria_uri AS criteriaUrl, image_uri AS imageUrl, (is_archived = 1) AS archived`;
const assertionSelect = `assertions.id AS assertionId, assertions.public_id AS publicId,
  assertions.badge_template_id AS badgeTemplateId, assertions.recipient_identity AS recipientIdentity,
  assertions.recipient_identity_type AS recipientIdentityType, assertions.issued_at AS issuedAt,
  assertions.valid_until AS validUntil, ${effectiveAssertionLifecycleStateSql} AS state`;

/** A tenant-scoped page sorted by immutable ID, including one lookahead row. */
export const listProgrammaticTemplates = async (
  db: SqlDatabase,
  input: ProgrammaticTemplateQuery,
): Promise<ProgrammaticTemplateRecord[]> => {
  const conditions = ["tenant_id = ?"];
  const params: unknown[] = [input.tenantId];
  if (!input.includeArchived) conditions.push("is_archived = 0");
  if (input.cursor !== undefined) {
    conditions.push("id > ?");
    params.push(input.cursor);
  }
  const rows = await db
    .prepare(`SELECT ${templateSelect} FROM badge_templates
    WHERE ${conditions.join(" AND ")} ORDER BY id ASC LIMIT ?`)
    .bind(...params, input.limit + 1)
    .all<unknown>();
  return rows.results.map((row) => templateRowSchema.parse(row));
};
/** Individual lookup remains tenant-scoped even when a foreign ID is supplied. */
export const findProgrammaticTemplate = async (
  db: SqlDatabase,
  tenantId: string,
  badgeTemplateId: string,
): Promise<ProgrammaticTemplateRecord | null> => {
  const row = await db
    .prepare(`SELECT ${templateSelect} FROM badge_templates WHERE tenant_id = ? AND id = ?`)
    .bind(tenantId, badgeTemplateId)
    .first<unknown>();
  return row === null ? null : templateRowSchema.parse(row);
};
/** Bounded reconciliation using exact identities, inclusive UTC dates, and immutable-ID pagination. */
export const listProgrammaticAssertions = async (
  db: SqlDatabase,
  input: ProgrammaticAssertionQuery,
): Promise<ProgrammaticAssertionRecord[]> => {
  const conditions = ["assertions.tenant_id = ?"];
  const params: unknown[] = [input.tenantId];
  if (input.cursor !== undefined) {
    conditions.push("assertions.id > ?");
    params.push(input.cursor);
  }
  if (input.badgeTemplateId !== undefined) {
    conditions.push("assertions.badge_template_id = ?");
    params.push(input.badgeTemplateId);
  }
  if (input.recipientIdentity !== undefined) {
    conditions.push(
      "CASE WHEN assertions.recipient_identity_type = 'email' THEN LOWER(assertions.recipient_identity) = LOWER(?) ELSE assertions.recipient_identity = ? END",
    );
    params.push(input.recipientIdentity, input.recipientIdentity);
  }
  if (input.recipientIdentityType !== undefined) {
    conditions.push("assertions.recipient_identity_type = ?");
    params.push(input.recipientIdentityType);
  }
  if (input.issuedFrom !== undefined) {
    conditions.push("assertions.issued_at::timestamptz >= ?::date AT TIME ZONE 'UTC'");
    params.push(input.issuedFrom);
  }
  if (input.issuedTo !== undefined) {
    conditions.push(
      "assertions.issued_at::timestamptz < (?::date + INTERVAL '1 day') AT TIME ZONE 'UTC'",
    );
    params.push(input.issuedTo);
  }
  const rows = await db
    .prepare(`SELECT ${assertionSelect} FROM assertions ${latestAssertionLifecycleJoinSql}
    WHERE ${conditions.join(" AND ")} ORDER BY assertions.id ASC LIMIT ?`)
    .bind(...params, input.limit + 1)
    .all<unknown>();
  return rows.results.map((row) => assertionRowSchema.parse(row));
};
/** Single assertion read with its effective lifecycle state, including immediate expiry. */
export const findProgrammaticAssertion = async (
  db: SqlDatabase,
  tenantId: string,
  assertionId: string,
): Promise<ProgrammaticAssertionRecord | null> => {
  const row = await db
    .prepare(`SELECT ${assertionSelect} FROM assertions ${latestAssertionLifecycleJoinSql}
    WHERE assertions.tenant_id = ? AND assertions.id = ?`)
    .bind(tenantId, assertionId)
    .first<unknown>();
  return row === null ? null : assertionRowSchema.parse(row);
};

const operationRowSchema = z
  .object({
    operationId: z.string(),
    tenantId: z.string(),
    jobType: z.enum(["issue_badge", "revoke_badge"]),
    payloadJson: z.string(),
    idempotencyKey: z.string(),
    attemptCount: z.number().int().nonnegative(),
    status: z.enum(["pending", "processing", "completed", "failed"]),
    availableAt: z.string(),
    completedAt: z.string().nullable(),
    failedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((row, ctx) => {
    if (
      (row.status === "completed" && row.completedAt === null) ||
      (row.status === "failed" && row.failedAt === null)
    ) {
      ctx.addIssue({ code: "custom", message: "Terminal operation is missing its timestamp" });
    }
  });
/** Operation persistence projection deliberately omits raw errors and lease credentials. */
export type ProgrammaticOperationRecord = z.infer<typeof operationRowSchema>;
/** Only issuance and revocation operations can be read through the public integration API. */
export const findProgrammaticOperation = async (
  db: SqlDatabase,
  tenantId: string,
  operationId: string,
): Promise<ProgrammaticOperationRecord | null> => {
  const row = await db
    .prepare(`SELECT id AS operationId, tenant_id AS tenantId, job_type AS jobType,
    payload_json AS payloadJson, idempotency_key AS idempotencyKey, attempt_count AS attemptCount,
    status, available_at AS availableAt, completed_at AS completedAt, failed_at AS failedAt,
    created_at AS createdAt, updated_at AS updatedAt FROM job_queue_messages
    WHERE tenant_id = ? AND id = ? AND job_type IN ('issue_badge', 'revoke_badge')`)
    .bind(tenantId, operationId)
    .first<unknown>();
  return row === null ? null : operationRowSchema.parse(row);
};
