import { z } from "zod";
import {
  recipientIdentityTypeSchema,
  type ProgrammaticAssertionQuery,
  type ProgrammaticTemplateQuery,
} from "@credtrail/validation";
import {
  effectiveAssertionLifecycleStateSql,
  latestAssertionLifecycleJoinSql,
} from "./assertion-lifecycle-sql.js";
import type { SqlDatabase } from "./tenant-scope.js";

const templateRowSchema = z.object({
  badgeTemplateId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  criteriaUri: z.string().nullable(),
  imageUri: z.string().nullable(),
  archived: z.boolean(),
});
/** Selected template columns before the HTTP layer resolves public URLs. */
export type ProgrammaticTemplateRecord = z.infer<typeof templateRowSchema>;
const assertionRowSchema = z.object({
  assertionId: z.string(),
  publicId: z.string().nullable(),
  badgeTemplateId: z.string(),
  recipientIdentity: z.string(),
  recipientIdentityType: recipientIdentityTypeSchema,
  issuedAt: z.string(),
  validUntil: z.string().nullable(),
  state: z.enum(["active", "suspended", "revoked", "expired"]),
});
/** Selected assertion columns without credential blobs, keys, or administrative metadata. */
export type ProgrammaticAssertionRecord = z.infer<typeof assertionRowSchema>;
const templateSelect = `id AS badgeTemplateId, title, description,
  criteria_uri AS criteriaUri, image_uri AS imageUri, (is_archived = 1) AS archived`;
const assertionSelect = `assertions.id AS assertionId, assertions.public_id AS publicId,
  assertions.badge_template_id AS badgeTemplateId, assertions.recipient_identity AS recipientIdentity,
  assertions.recipient_identity_type AS recipientIdentityType, assertions.issued_at AS issuedAt,
  assertions.valid_until AS validUntil, ${effectiveAssertionLifecycleStateSql} AS state`;

/** A tenant-scoped page sorted by immutable ID, with the lookahead row excluded. */
export const listProgrammaticTemplates = async (
  db: SqlDatabase,
  input: ProgrammaticTemplateQuery,
): Promise<{
  readonly rows: readonly ProgrammaticTemplateRecord[];
  readonly nextCursor: string | null;
}> => {
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
  const records = rows.results.map((row) => templateRowSchema.parse(row));
  if (records.length <= input.limit) return { rows: records, nextCursor: null };
  const pageRows = records.slice(0, input.limit);
  const lastRow = pageRows.at(-1);
  if (lastRow === undefined) throw new Error("Template page is missing its cursor row");
  return { rows: pageRows, nextCursor: lastRow.badgeTemplateId };
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
): Promise<{
  readonly rows: readonly ProgrammaticAssertionRecord[];
  readonly nextCursor: string | null;
}> => {
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
  const records = rows.results.map((row) => assertionRowSchema.parse(row));
  if (records.length <= input.limit) return { rows: records, nextCursor: null };
  const pageRows = records.slice(0, input.limit);
  const lastRow = pageRows.at(-1);
  if (lastRow === undefined) throw new Error("Assertion page is missing its cursor row");
  return { rows: pageRows, nextCursor: lastRow.assertionId };
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

const timestamp = z.iso.datetime({ offset: true });
const operationIdentity = z.object({
  operationId: z.string(),
  tenantId: z.string(),
  jobType: z.enum(["issue_badge", "revoke_badge"]),
  assertionId: z.string(),
  idempotencyKey: z.string(),
  attemptCount: z.number().int().nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const operationRowSchema = z.discriminatedUnion("status", [
  operationIdentity.extend({
    status: z.literal("pending"),
    nextAttemptAt: timestamp,
  }),
  operationIdentity.extend({ status: z.literal("processing") }),
  operationIdentity.extend({
    status: z.literal("completed"),
    completedAt: timestamp,
    publicId: z.string().nullable(),
  }),
  operationIdentity.extend({ status: z.literal("failed"), failedAt: timestamp }),
]);
/** Operation persistence projection deliberately omits raw errors and lease credentials. */
export type ProgrammaticOperationRecord = z.infer<typeof operationRowSchema>;
/** Only issuance and revocation operations can be read through the public integration API. */
export const findProgrammaticOperation = async (
  db: SqlDatabase,
  tenantId: string,
  operationId: string,
): Promise<ProgrammaticOperationRecord | null> => {
  const row = await db
    .prepare(`SELECT jobs.id AS operationId, jobs.tenant_id AS tenantId, jobs.job_type AS jobType,
    jobs.payload_json::jsonb ->> 'assertionId' AS assertionId,
    jobs.idempotency_key AS idempotencyKey, jobs.attempt_count AS attemptCount,
    jobs.status, jobs.available_at AS nextAttemptAt, jobs.completed_at AS completedAt,
    jobs.failed_at AS failedAt, jobs.created_at AS createdAt, jobs.updated_at AS updatedAt,
    assertions.public_id AS publicId FROM job_queue_messages AS jobs
    LEFT JOIN assertions ON jobs.status = 'completed' AND assertions.tenant_id = jobs.tenant_id
      AND assertions.id = jobs.payload_json::jsonb ->> 'assertionId'
    WHERE jobs.tenant_id = ? AND jobs.id = ? AND jobs.job_type IN ('issue_badge', 'revoke_badge')`)
    .bind(tenantId, operationId)
    .first<unknown>();
  return row === null ? null : operationRowSchema.parse(row);
};
