import {
  findBadgeAwardCycle,
  type BadgeIssuanceRuleLmsProviderKind,
  type SqlDatabase,
} from "@credtrail/db";
import {
  badgeIssuanceRuleFactsSchema,
  badgeRuleInstructorConfirmation,
  parseIssuanceEvidenceSnapshotJson,
  type BadgeIssuanceRuleDefinition,
} from "@credtrail/validation";
import { z } from "zod";
import { badgeRenewalValidUntil } from "../rules/badge-renewal";
import { loadRuleFacts } from "../rules/badge-rule-facts-loader";
import { evaluateBadgeIssuanceRuleRenewal } from "../rules/engine";
import { resolveBadgeIssuanceRuleDefinitionValueLists } from "../rules/badge-rule-definition-resolver";

type RenewableBadgeIssuanceResult =
  | {
      readonly status: "ready";
      readonly validUntil: string;
      readonly renewalOfAssertionId?: string;
    }
  | { readonly status: "blocked"; readonly detail: string };

/** Checks the current cycle and its saved completion evidence before signing a renewable award. */
export const prepareRenewableBadgeIssuance = async (input: {
  readonly db: SqlDatabase;
  readonly tenantId: string;
  readonly badgeTemplateId: string;
  readonly recipientEmail: string;
  readonly definition: BadgeIssuanceRuleDefinition;
  readonly lmsProviderKind: BadgeIssuanceRuleLmsProviderKind;
  readonly intervalMonths: number;
  readonly provenanceJson: string | null;
  readonly issuedAt: string;
  readonly issuedByUserId?: string | undefined;
}): Promise<RenewableBadgeIssuanceResult> => {
  const cycle = await findBadgeAwardCycle(input.db, input);
  const validUntil = badgeRenewalValidUntil(input.issuedAt, input.intervalMonths);
  if (cycle === null) return { status: "ready", validUntil };
  if (cycle.state !== "expired") {
    return {
      status: "blocked",
      detail:
        cycle.state === "active"
          ? "This learner already has a current badge. Renewal becomes due when its validity period ends."
          : "Resolve the previous badge's suspension or revocation before issuing a renewal.",
    };
  }

  const snapshot = parseIssuanceEvidenceSnapshotJson(input.provenanceJson);
  const definition = await resolveBadgeIssuanceRuleDefinitionValueLists(
    input.db,
    input.tenantId,
    input.definition,
  );
  const missingFreshEvidence = {
    status: "blocked",
    detail:
      "Renewal requires a new training completion after the previous badge was earned. The saved evidence does not prove a new completion.",
  } as const;
  if (
    snapshot.facts === null ||
    Date.parse(snapshot.facts.nowIso) <= Date.parse(cycle.issuedAt) ||
    Date.parse(snapshot.facts.nowIso) > Date.parse(input.issuedAt)
  )
    return missingFreshEvidence;

  if (badgeRuleInstructorConfirmation(definition.conditions) !== null) {
    const confirmation = z
      .object({ confirmedByUserId: z.string().min(1) })
      .safeParse(snapshot.facts.instructorConfirmation);
    if (!confirmation.success || confirmation.data.confirmedByUserId !== input.issuedByUserId)
      return missingFreshEvidence;
  } else {
    const parsedFacts = badgeIssuanceRuleFactsSchema.safeParse(snapshot.facts);
    if (!parsedFacts.success) return missingFreshEvidence;
    const facts = await loadRuleFacts({
      db: input.db,
      tenantId: input.tenantId,
      lmsProviderKind: input.lmsProviderKind,
      learnerId: snapshot.facts.learnerId,
      recipient: { identity: input.recipientEmail, identityType: "email" },
      definition,
      // Prerequisites must still be current when a queued award is delivered.
      requestedFacts: { ...parsedFacts.data, earnedBadgeTemplateIds: undefined },
      nowIso: input.issuedAt,
    });
    if (!evaluateBadgeIssuanceRuleRenewal(definition, facts, cycle.issuedAt).matched)
      return missingFreshEvidence;
  }
  return { status: "ready", validUntil, renewalOfAssertionId: cycle.assertionId };
};
