import { z } from "zod";
import { findBadgeTemplateById } from "@credtrail/db";
import type { AppContext } from "../app/types";
import type { ResolveDatabase } from "../app/route-deps";
import type { DirectIssueBadgeResult } from "../badges/direct-issue";
import type { DirectIssueBadgeRequest } from "../badges/recipient-identifiers";
import { renderAppPage } from "../ui/render-page";
import { asNonEmptyString } from "../utils/value-parsers";
import { createCredTrailLtiTool } from "./credtrail-lti-tool";
import { verifyLtiIssuanceActionToken } from "./issuance-action-token";
import { ltiRosterIssuanceResultPage } from "./pages";
import { executeLtiRosterIssuance } from "./roster-issuance";
import {
  ltiSessionMatchesIssuanceAction,
  selectedLearnerUserIdsFromForm,
} from "./roster-issuance-helpers";

/**
 * Dependencies required to handle instructor Resource Link badge issuance.
 */
export interface HandleLtiResourceLinkIssueInput {
  readonly c: AppContext;
  resolveDatabase: ResolveDatabase;
  readonly sha256Hex: (value: string) => Promise<string>;
  readonly issueBadgeForTenant: (
    c: AppContext,
    tenantId: string,
    request: DirectIssueBadgeRequest,
    issuedByUserId?: string,
    options?: {
      readonly recipientDisplayName?: string;
      readonly issuerName?: string;
      readonly issuerUrl?: string;
    },
  ) => Promise<DirectIssueBadgeResult>;
}

/**
 * Handles instructor-triggered Resource Link roster badge issuance.
 */
export const handleLtiResourceLinkIssue = async (
  input: HandleLtiResourceLinkIssueInput,
): Promise<Response> => {
  const { c, resolveDatabase, sha256Hex, issueBadgeForTenant } = input;
  const form = await c.req.formData();
  const actionToken = asNonEmptyString(form.get("issuance_action_token"));
  const selectedLearnerUserIds = selectedLearnerUserIdsFromForm(form);

  if (actionToken === null) {
    return c.json(
      {
        error: "issuance_action_token is required",
      },
      400,
    );
  }

  const issuanceAction = await verifyLtiIssuanceActionToken(c.env, actionToken);

  if (issuanceAction === null) {
    return c.json(
      {
        error: "LTI issuance action token is invalid or expired",
      },
      403,
    );
  }

  const db = resolveDatabase(c.env);
  const ltiTool = await createCredTrailLtiTool({
    db,
    env: c.env,
    tenantId: issuanceAction.tenantId,
  });
  const ltiSession = await ltiTool.getSession(issuanceAction.ltiSessionId);

  if (ltiSession === undefined) {
    return c.json(
      {
        error: "LTI launch session was not found or is no longer active",
      },
      404,
    );
  }

  if (!ltiSessionMatchesIssuanceAction(ltiSession, issuanceAction)) {
    return c.json(
      {
        error: "LTI launch session does not match issuance action",
      },
      403,
    );
  }

  if (!ltiSession.isInstructor) {
    return c.json(
      {
        error: "LTI roster badge issuance requires an instructor launch",
      },
      403,
    );
  }

  const confirmation = z.literal("confirmed").safeParse(form.get("completion_confirmation"));
  if (!confirmation.success)
    return c.json(
      {
        error:
          "Confirm that the selected learners completed the badge requirements before issuing.",
      },
      400,
    );
  if (selectedLearnerUserIds.length === 0)
    return c.json({ error: "Select at least one learner." }, 400);

  const badgeTemplate = await findBadgeTemplateById(
    db,
    issuanceAction.tenantId,
    issuanceAction.badgeTemplateId,
  );

  if (badgeTemplate === null || badgeTemplate.isArchived) {
    return c.json(
      {
        error: "LTI resource-link badge template is not available for this tenant",
      },
      404,
    );
  }

  const outcome = await executeLtiRosterIssuance({
    c,
    db,
    ltiTool,
    ltiSession,
    issuanceAction,
    selectedLearnerUserIds,
    sha256Hex,
    issueBadgeForTenant,
  });
  if (outcome.status !== "completed") {
    const status =
      outcome.status === "denied" ? 403 : outcome.status === "rule_changed" ? 409 : 502;
    return c.json({ error: outcome.detail }, status);
  }
  const issuanceResult = outcome.summary;

  c.header("Cache-Control", "no-store");
  return renderAppPage(
    c,
    ltiRosterIssuanceResultPage({
      tenantId: issuanceResult.tenantId,
      badgeTemplateId: issuanceResult.badgeTemplateId,
      courseContextTitle: issuanceResult.courseContextTitle,
      selectedCount: issuanceResult.selectedCount,
      results: issuanceResult.results,
    }),
  );
};
