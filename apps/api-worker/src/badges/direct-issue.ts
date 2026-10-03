import { emailThemeFromBindings, type EmailThemeBindings } from "../notifications/email-layout";
import { linkedInOrganizationIdForTenant } from "../utils/display-format";
import { prepareRenewableBadgeIssuance } from "./renewable-badge-issuance";
import {
  attemptIssuanceEmail,
  recordIssuanceEmailOutcome,
} from "../notifications/issuance-email-outcome";
import {
  createDidWeb,
  createTenantScopedId,
  getImmutableCredentialObject,
  logWarn,
  pinnedJsonLdContextTermSets,
  storeImmutableCredentialObject,
  type ImmutableCredentialStore,
  type JsonObject,
  type ObservabilityContext,
} from "@credtrail/core-domain";
import {
  badgeAchievementSnapshotFromRuleVersion,
  finalizeAssertionIssuance,
  findAssertionByIdempotencyKey,
  findBadgeTemplateById,
  findBadgeIssuanceRuleVersionById,
  findTenantById,
  listLearnerIdentitiesByProfile,
  reserveAssertionStatusListIndex,
  resolveAssertionLifecycleState,
  resolveLearnerProfileForIdentity,
  type AssertionLifecycleState,
  type BadgeIssuanceRuleLmsProviderKind,
  type AssertionRecord,
  type RecipientIdentifierType,
  type ResolveAssertionLifecycleStateResult,
  type SqlDatabase,
} from "@credtrail/db";
import {
  parseBadgeIssuanceRuleDefinitionJson,
  type BadgeIssuanceRuleDefinition,
  type BadgeAchievementSnapshot,
} from "@credtrail/validation";
import type { SendIssuanceEmailNotificationInput } from "../notifications/send-issuance-email";
import type {
  SignCredentialForDidInput,
  SignCredentialForDidResult,
} from "../signing/credential-signer";
import { canonicalAppOrigin } from "../http/canonical-app-url";
import { asJsonObject } from "../utils/value-parsers";
import {
  credentialStatusForAssertion,
  revocationStatusListUrlForTenant,
} from "./revocation-status";
import {
  recipientIdentifiersForIssueRequest,
  type DirectIssueBadgeRequest,
} from "./recipient-identifiers";
import { resolveIssuableBadgeAchievementSnapshot } from "./badge-achievement-snapshot";
import { badgeArtworkIssuanceHttpFailure } from "./badge-artwork-issuance-http";
import {
  parseTrustEdCredentialMetadataJsonResult,
  type TrustEdCredentialMetadataParseResult,
} from "./trusted-credential-metadata";
import {
  emptyTrustEdOb3Projection,
  projectTrustEdMetadataToOb3,
  type TrustEdCredentialOb3Projection,
} from "./trusted-credential-ob3-projection";

interface IssueBadgeBindings extends EmailThemeBindings {
  LINKEDIN_ORGANIZATION_IDS?: string | undefined;
  BADGE_OBJECTS: ImmutableCredentialStore;
  PLATFORM_DOMAIN: string;
  PUBLIC_APP_ORIGIN: string;
  EMAIL?: SendEmail | undefined;
  ISSUANCE_EMAIL_NOTIFICATIONS_ENABLED?: string | undefined;
  TRANSACTIONAL_EMAIL_FROM_ADDRESS?: string | undefined;
  TRANSACTIONAL_EMAIL_FROM_NAME?: string | undefined;
}

const issuerUrlFromTenantDomain = (issuerDomain: string): string | undefined => {
  const trimmedDomain = issuerDomain.trim();

  if (trimmedDomain.length === 0) {
    return undefined;
  }

  return `https://${trimmedDomain}`;
};

/** HTTP error payload emitted by direct badge issuance. */
export interface IssueBadgeHttpErrorPayload {
  readonly error: string;
  readonly did?: string | undefined;
}

/** HTTP status codes emitted by direct badge issuance. */
const ISSUE_BADGE_HTTP_ERROR_STATUS_CODES = [400, 404, 409, 422, 500, 502, 503] as const;

/** HTTP status codes emitted by direct badge issuance. */
export type IssueBadgeHttpErrorStatusCode = (typeof ISSUE_BADGE_HTTP_ERROR_STATUS_CODES)[number];

const issueBadgeHttpErrorStatusCodes = new Set<number>(ISSUE_BADGE_HTTP_ERROR_STATUS_CODES);

/** Framework-neutral shape of an HTTP error emitted by direct badge issuance. */
export interface IssueBadgeHttpError {
  readonly statusCode: IssueBadgeHttpErrorStatusCode;
  readonly payload: IssueBadgeHttpErrorPayload;
}

/** Returns whether an unknown failure is a direct-issuance HTTP error. */
export const isIssueBadgeHttpError = (error: unknown): error is IssueBadgeHttpError => {
  if (error === null || typeof error !== "object" || !("statusCode" in error)) {
    return false;
  }

  if (
    typeof error.statusCode !== "number" ||
    !issueBadgeHttpErrorStatusCodes.has(error.statusCode)
  ) {
    return false;
  }

  if (!("payload" in error) || error.payload === null || typeof error.payload !== "object") {
    return false;
  }

  return "error" in error.payload && typeof error.payload.error === "string";
};

type IssueBadgeHttpErrorClass = new (
  statusCode: IssueBadgeHttpErrorStatusCode,
  payload: IssueBadgeHttpErrorPayload,
) => Error;

export interface DirectIssueBadgeOptions {
  recipientDisplayName?: string;
  issuerName?: string;
  issuerUrl?: string;
  issuerImageUri?: string;
  issuedAt?: string;
  sendEmailNotification?: boolean;
}

export interface DirectIssueBadgeResult {
  status: "issued" | "already_issued";
  tenantId: string;
  assertionId: string;
  idempotencyKey: string;
  vcR2Key: string;
  credential: JsonObject;
}

interface CreateIssueBadgeForTenantInput<
  ContextType extends { env: BindingsType; req: { url: string } },
  BindingsType extends IssueBadgeBindings,
> {
  resolveDatabase: (bindings: BindingsType) => SqlDatabase;
  signCredentialForDid: (
    request: SignCredentialForDidInput<ContextType>,
  ) => Promise<SignCredentialForDidResult>;
  sendIssuanceEmailNotification: (input: SendIssuanceEmailNotificationInput) => Promise<void>;
  observabilityContext: (bindings: BindingsType) => ObservabilityContext;
  publicBadgePathForAssertion: (assertion: AssertionRecord) => string;
  HttpErrorResponseClass: IssueBadgeHttpErrorClass;
}

const assertionLifecycleBlockMessage = (
  assertionId: string,
  lifecycle: ResolveAssertionLifecycleStateResult,
): string => {
  const stateLabel = lifecycle.state;
  const reasonDetail = lifecycle.reason ?? lifecycle.reasonCode;
  const reasonSuffix =
    reasonDetail === null ? "" : ` Reason: ${reasonDetail.replace(/\s+/g, " ").trim()}.`;

  return `Issuance blocked by lifecycle policy: assertion ${assertionId} is ${stateLabel}.${reasonSuffix}`;
};

const isIssuableAssertionLifecycleState = (state: AssertionLifecycleState): boolean => {
  return state === "active";
};

const issuanceEmailNotificationsEnabled = (bindings: IssueBadgeBindings): boolean => {
  return bindings.ISSUANCE_EMAIL_NOTIFICATIONS_ENABLED?.trim().toLowerCase() === "true";
};

const VC_DATA_MODEL_V2_CONTEXT_URL = "https://www.w3.org/ns/credentials/v2";
const OB3_CONTEXT_URL = "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";
const VC_STATUS_LIST_CONTEXT_URL = "https://www.w3.org/ns/credentials/status/v1";
const CREDTRAIL_TRUSTED_CREDENTIAL_CONTEXT_URL = "https://credtrail.org/ns/trusted-credential/v1";

const ob3IdentityTypeFromRecipientIdentifierType = (
  recipientIdentifierType: RecipientIdentifierType,
): string => {
  switch (recipientIdentifierType) {
    case "emailAddress":
      return "emailAddress";
    case "sourcedId":
      return "sourcedId";
    case "nationalIdentityNumber":
      return "nationalIdentityNumber";
    case "studentId":
      return "ext:studentId";
    case "did":
      return "ext:did";
  }
};

const projectTrustEdMetadataForIssuance = (
  metadataResult: TrustEdCredentialMetadataParseResult,
): TrustEdCredentialOb3Projection => {
  return metadataResult.status === "valid"
    ? projectTrustEdMetadataToOb3(metadataResult.metadata)
    : emptyTrustEdOb3Projection();
};

// Terms that only the CredTrail trusted-credential context defines. That context is pinned for
// CredTrail's own verifier but not published at its URL, so other verifiers cannot load it: only
// reference it when the projection really uses one of its terms, as a property or as a type.
const CREDTRAIL_TRUSTED_CREDENTIAL_TERMS: ReadonlySet<string> = new Set(
  (pinnedJsonLdContextTermSets.get(CREDTRAIL_TRUSTED_CREDENTIAL_CONTEXT_URL) ?? []).filter(
    (term) => term !== "id" && term !== "type",
  ),
);

const jsonUsesAnyTerm = (value: unknown, terms: ReadonlySet<string>): boolean => {
  if (Array.isArray(value)) {
    return value.some((entry) => jsonUsesAnyTerm(entry, terms));
  }

  if (value === null || typeof value !== "object") {
    return false;
  }

  return Object.entries(value).some(([key, entry]) => {
    if (key === "type" || key === "@type") {
      const typeValues: unknown[] = Array.isArray(entry) ? entry : [entry];
      return typeValues.some((typeValue) => typeof typeValue === "string" && terms.has(typeValue));
    }

    return terms.has(key) || jsonUsesAnyTerm(entry, terms);
  });
};

/**
 * The queue ingress reserves the assertion id and returns it to the API caller, so issuance keeps it.
 * Only an id scoped to this tenant is accepted; anything else gets a fresh one.
 */
export const assertionIdForIssuance = (
  requestedAssertionId: string | undefined,
  tenantId: string,
): string => {
  const scopedPrefix = `${tenantId}:`;

  return requestedAssertionId !== undefined &&
    requestedAssertionId.startsWith(scopedPrefix) &&
    requestedAssertionId.length > scopedPrefix.length
    ? requestedAssertionId
    : createTenantScopedId(tenantId);
};

const trustEdProjectionHasExtensionTerms = (
  projection: TrustEdCredentialOb3Projection,
): boolean => {
  return (
    jsonUsesAnyTerm(projection.achievement, CREDTRAIL_TRUSTED_CREDENTIAL_TERMS) ||
    jsonUsesAnyTerm(projection.subject, CREDTRAIL_TRUSTED_CREDENTIAL_TERMS)
  );
};

const criteriaForIssuedAchievement = (
  templateCriteriaUri: string | null,
  projectedCriteria: unknown,
): JsonObject | null => {
  const projectedCriteriaObject = asJsonObject(projectedCriteria);

  if (projectedCriteriaObject === null && templateCriteriaUri === null) {
    return null;
  }

  const criteria: JsonObject =
    projectedCriteriaObject === null ? {} : { ...projectedCriteriaObject };

  if (criteria.type === undefined) {
    criteria.type = "Criteria";
  }

  if (criteria.id === undefined && templateCriteriaUri !== null) {
    criteria.id = templateCriteriaUri;
  }

  return criteria;
};

export const createIssueBadgeForTenant = <
  ContextType extends { env: BindingsType; req: { url: string } },
  BindingsType extends IssueBadgeBindings,
>(
  input: CreateIssueBadgeForTenantInput<ContextType, BindingsType>,
) => {
  return async (
    context: ContextType,
    tenantId: string,
    request: DirectIssueBadgeRequest,
    issuedByUserId?: string,
    options?: DirectIssueBadgeOptions,
  ): Promise<DirectIssueBadgeResult> => {
    const db = input.resolveDatabase(context.env);
    const hasGovernedRuleSnapshot = request.achievementSource.kind === "rule_version";
    let requestedAchievement: BadgeAchievementSnapshot;
    let governedRule: {
      definition: BadgeIssuanceRuleDefinition;
      lmsProviderKind: BadgeIssuanceRuleLmsProviderKind;
    } | null = null;

    if (request.achievementSource.kind === "rule_version") {
      const issuanceProvenance = request.achievementSource.provenance;
      const ruleVersion = await findBadgeIssuanceRuleVersionById(db, {
        tenantId,
        ruleId: issuanceProvenance.ruleId,
        versionId: issuanceProvenance.versionId,
      });

      if (ruleVersion === null) {
        throw new input.HttpErrorResponseClass(409, {
          error: "The governed badge rule version is no longer available.",
        });
      }

      requestedAchievement = badgeAchievementSnapshotFromRuleVersion(ruleVersion.snapshot);
      governedRule = {
        definition: parseBadgeIssuanceRuleDefinitionJson(ruleVersion.ruleJson),
        lmsProviderKind: ruleVersion.snapshot.lmsProviderKind,
      };
    } else {
      requestedAchievement = request.achievementSource.snapshot;
    }

    const idempotencyKey = request.idempotencyKey ?? crypto.randomUUID();
    const existingAssertion = await findAssertionByIdempotencyKey(db, tenantId, idempotencyKey);

    if (existingAssertion !== null) {
      const existingLifecycle = await resolveAssertionLifecycleState(
        db,
        tenantId,
        existingAssertion.id,
      );

      if (existingLifecycle === null) {
        throw new Error(`Existing assertion "${existingAssertion.id}" could not be resolved`);
      }

      if (!isIssuableAssertionLifecycleState(existingLifecycle.state)) {
        throw new input.HttpErrorResponseClass(409, {
          error: assertionLifecycleBlockMessage(existingAssertion.id, existingLifecycle),
        });
      }

      const existingCredential = await getImmutableCredentialObject(context.env.BADGE_OBJECTS, {
        tenantId,
        assertionId: existingAssertion.id,
      });

      if (existingCredential === null) {
        throw new Error(
          `Existing assertion "${existingAssertion.id}" is missing its immutable credential object`,
        );
      }

      return {
        status: "already_issued",
        tenantId,
        assertionId: existingAssertion.id,
        idempotencyKey: existingAssertion.idempotencyKey,
        vcR2Key: existingAssertion.vcR2Key,
        credential: existingCredential,
      };
    }

    const issuedAt = options?.issuedAt ?? new Date().toISOString();
    let validity: { validUntil?: string; renewalOfAssertionId?: string } = {};
    if (
      governedRule?.definition.options?.renewal !== undefined &&
      request.achievementSource.kind === "rule_version"
    ) {
      if (request.recipientIdentityType !== "email") {
        throw new input.HttpErrorResponseClass(422, {
          error: "Renewable badges require the learner's email address.",
        });
      }
      const renewal = await prepareRenewableBadgeIssuance({
        db,
        tenantId,
        badgeTemplateId: requestedAchievement.badgeTemplateId,
        recipientEmail: request.recipientIdentity,
        definition: governedRule.definition,
        lmsProviderKind: governedRule.lmsProviderKind,
        intervalMonths: governedRule.definition.options.renewal.intervalMonths,
        provenanceJson: request.achievementSource.provenance.provenanceJson ?? null,
        issuedAt,
        issuedByUserId,
      });
      if (renewal.status === "blocked")
        throw new input.HttpErrorResponseClass(409, { error: renewal.detail });
      validity = {
        validUntil: renewal.validUntil,
        ...(renewal.renewalOfAssertionId === undefined
          ? {}
          : { renewalOfAssertionId: renewal.renewalOfAssertionId }),
      };
    }

    const resolvedAchievement = await resolveIssuableBadgeAchievementSnapshot({
      store: context.env.BADGE_OBJECTS,
      publicAppOrigin: context.env.PUBLIC_APP_ORIGIN,
      tenantId,
      snapshot: requestedAchievement,
    });

    if (resolvedAchievement.status !== "resolved") {
      const failure = badgeArtworkIssuanceHttpFailure(resolvedAchievement);
      throw new input.HttpErrorResponseClass(failure.statusCode, {
        error: failure.error,
      });
    }

    const achievement = resolvedAchievement.snapshot;
    const [badgeTemplate, tenant] = await Promise.all([
      findBadgeTemplateById(db, tenantId, achievement.badgeTemplateId),
      findTenantById(db, tenantId),
    ]);

    if (badgeTemplate === null) {
      throw new input.HttpErrorResponseClass(404, {
        error: "Badge template not found",
      });
    }

    if (tenant === null) {
      throw new input.HttpErrorResponseClass(404, {
        error: "Tenant not found",
      });
    }

    if (badgeTemplate.isArchived && !hasGovernedRuleSnapshot) {
      throw new input.HttpErrorResponseClass(409, {
        error: "Badge template is archived",
      });
    }

    const issuerDid = createDidWeb({
      host: context.env.PLATFORM_DOMAIN,
      pathSegments: [tenantId],
    });

    const credentialBaseUrl = canonicalAppOrigin(context.env.PUBLIC_APP_ORIGIN);
    const recipientDisplayName = options?.recipientDisplayName ?? request.recipientDisplayName;
    const learnerProfile = await resolveLearnerProfileForIdentity(db, {
      tenantId,
      identityType: request.recipientIdentityType,
      identityValue: request.recipientIdentity,
      ...(recipientDisplayName === undefined ? {} : { displayName: recipientDisplayName }),
    });
    const assertionId = assertionIdForIssuance(request.assertionId, tenantId);
    const statusListIndex = await reserveAssertionStatusListIndex(db, tenantId);
    const statusListCredentialUrl = revocationStatusListUrlForTenant(credentialBaseUrl, tenantId);
    const learnerIdentities = await listLearnerIdentitiesByProfile(db, tenantId, learnerProfile.id);
    const learnerDidSubjectId =
      learnerIdentities.find((identity) => identity.identityType === "did")?.identityValue ??
      learnerProfile.subjectId;
    const recipientIdentifiers = recipientIdentifiersForIssueRequest(
      request,
      learnerProfile.id,
      learnerIdentities,
    );
    const credentialSubjectIdentifiers: JsonObject[] = recipientIdentifiers.map((entry) => {
      return {
        type: "IdentityObject",
        hashed: false,
        identityHash: entry.identifierValue,
        identityType: ob3IdentityTypeFromRecipientIdentifierType(entry.identifierType),
      };
    });
    const issuerUrl = options?.issuerUrl ?? issuerUrlFromTenantDomain(tenant.issuerDomain);
    const issuerImageUri = options?.issuerImageUri ?? request.issuerImageUri;
    const issuer = {
      id: issuerDid,
      type: "Profile",
      name: options?.issuerName ?? tenant.displayName,
      ...(issuerUrl === undefined ? {} : { url: issuerUrl }),
      ...(issuerImageUri === undefined
        ? {}
        : {
            image: {
              id: issuerImageUri,
              type: "Image",
              caption: `${options?.issuerName ?? tenant.displayName} logo`,
            },
          }),
    };
    const trustEdMetadataResult = parseTrustEdCredentialMetadataJsonResult(
      achievement.trustedCredentialMetadataJson,
    );
    const trustEdProjection = projectTrustEdMetadataForIssuance(trustEdMetadataResult);
    const criteria = criteriaForIssuedAchievement(
      achievement.criteriaUri,
      trustEdProjection.achievement.criteria,
    );

    if (trustEdMetadataResult.status === "invalid") {
      logWarn(input.observabilityContext(context.env), "trusted_credential_metadata_invalid", {
        tenantId,
        badgeTemplateId: achievement.badgeTemplateId,
        detail: trustEdMetadataResult.error,
      });
    }

    const signedCredentialResult = await input.signCredentialForDid({
      context,
      did: issuerDid,
      proofType: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      createdAt: issuedAt,
      missingPrivateKeyError:
        "Tenant DID is missing private signing key material and no remote signer is configured",
      ed25519KeyRequirementError: "Tenant issuance requires an Ed25519 private key",
      credential: {
        "@context": trustEdProjectionHasExtensionTerms(trustEdProjection)
          ? [
              VC_DATA_MODEL_V2_CONTEXT_URL,
              OB3_CONTEXT_URL,
              VC_STATUS_LIST_CONTEXT_URL,
              CREDTRAIL_TRUSTED_CREDENTIAL_CONTEXT_URL,
            ]
          : [VC_DATA_MODEL_V2_CONTEXT_URL, OB3_CONTEXT_URL, VC_STATUS_LIST_CONTEXT_URL],
        id: `urn:credtrail:assertion:${encodeURIComponent(assertionId)}`,
        type: ["VerifiableCredential", "OpenBadgeCredential"],
        name: achievement.title,
        issuer,
        validFrom: issuedAt,
        ...(validity.validUntil === undefined ? {} : { validUntil: validity.validUntil }),
        credentialStatus: credentialStatusForAssertion(statusListCredentialUrl, statusListIndex),
        credentialSubject: {
          id: learnerDidSubjectId,
          type: ["AchievementSubject"],
          ...(learnerProfile.displayName === null ? {} : { name: learnerProfile.displayName }),
          identifier: credentialSubjectIdentifiers,
          achievement: {
            id: `urn:credtrail:badge-template:${encodeURIComponent(achievement.badgeTemplateId)}`,
            type: ["Achievement"],
            name: achievement.title,
            ...(achievement.description === null ? {} : { description: achievement.description }),
            ...(achievement.imageUri === null
              ? {}
              : {
                  image: {
                    id: achievement.imageUri,
                    type: "Image",
                  },
                }),
            ...trustEdProjection.achievement,
            ...(criteria === null ? {} : { criteria }),
          },
          ...trustEdProjection.subject,
        },
      },
    });

    if (signedCredentialResult.status !== "ok") {
      throw new input.HttpErrorResponseClass(signedCredentialResult.statusCode, {
        error: signedCredentialResult.error,
        did: issuerDid,
      });
    }

    const signedCredential = signedCredentialResult.credential;

    const stored = await storeImmutableCredentialObject(context.env.BADGE_OBJECTS, {
      tenantId,
      assertionId,
      credential: signedCredential,
    });

    const finalizeResult = await finalizeAssertionIssuance(db, {
      assertion: {
        id: assertionId,
        tenantId,
        learnerProfileId: learnerProfile.id,
        recipientIdentity: request.recipientIdentity,
        recipientIdentityType: request.recipientIdentityType,
        vcR2Key: stored.key,
        statusListIndex,
        idempotencyKey,
        issuedAt,
        ...validity,
        recipientIdentifiers,
        ...(issuedByUserId === undefined ? {} : { issuedByUserId }),
      },
      achievementSource:
        request.achievementSource.kind === "rule_version"
          ? request.achievementSource
          : {
              ...request.achievementSource,
              snapshot: achievement,
            },
      buildAuditLog: (assertion) => ({
        tenantId,
        ...(issuedByUserId === undefined ? {} : { actorUserId: issuedByUserId }),
        action: "assertion.issued",
        targetType: "assertion",
        targetId: assertion.id,
        metadata: {
          assertionPublicId: assertion.publicId,
          badgeTemplateId: achievement.badgeTemplateId,
          recipientIdentity: assertion.recipientIdentity,
          recipientIdentityType: assertion.recipientIdentityType,
          issuedAt: assertion.issuedAt,
        },
      }),
      ...(request.lmsLearnerIdentity === undefined
        ? {}
        : { lmsLearnerIdentity: request.lmsLearnerIdentity }),
      ...(request.learnerPathwayCompletionHandoffId === undefined
        ? {}
        : {
            learnerPathwayCompletionHandoffId: request.learnerPathwayCompletionHandoffId,
          }),
    });

    if (finalizeResult.status === "badge_renewal_conflict") {
      throw new input.HttpErrorResponseClass(409, {
        error:
          "This learner's badge status changed. Refresh eligibility before issuing the renewal.",
      });
    }

    if (finalizeResult.status === "lms_identity_conflict") {
      throw new input.HttpErrorResponseClass(409, {
        error:
          finalizeResult.reason === "lms_learner_id_in_use"
            ? "This LMS learner ID is already linked to another learner record."
            : "This learner record is already linked to a different learner ID for this LMS connection.",
      });
    }

    if (finalizeResult.status === "learner_pathway_handoff_conflict") {
      throw new input.HttpErrorResponseClass(409, {
        error: "This pathway completion is no longer eligible for issuance.",
      });
    }

    const createdAssertion = finalizeResult.assertion;

    const emailOutcome = await attemptIssuanceEmail({
      isEmailRecipient: request.recipientIdentityType === "email",
      enabled: issuanceEmailNotificationsEnabled(context.env),
      suppressed: options?.sendEmailNotification === false,
      configured: context.env.EMAIL !== undefined,
      send: async () => {
        const publicBadgePath = input.publicBadgePathForAssertion(createdAssertion);
        await input.sendIssuanceEmailNotification({
          emailBinding: context.env.EMAIL,
          fromEmail: context.env.TRANSACTIONAL_EMAIL_FROM_ADDRESS,
          fromName: context.env.TRANSACTIONAL_EMAIL_FROM_NAME,
          recipientEmail: request.recipientIdentity.trim().toLowerCase(),
          badgeTitle: achievement.title,
          assertionId,
          tenantId,
          issuedAtIso: issuedAt,
          publicBadgeUrl: new URL(publicBadgePath, credentialBaseUrl).toString(),
          verificationUrl: new URL(`${publicBadgePath}/verification`, credentialBaseUrl).toString(),
          credentialDownloadUrl: new URL(
            `${publicBadgePath}/download`,
            credentialBaseUrl,
          ).toString(),
          credentialPdfDownloadUrl: new URL(
            `${publicBadgePath}/download.pdf`,
            credentialBaseUrl,
          ).toString(),
          issuerName: options?.issuerName ?? tenant.displayName,
          badgeDescription: achievement.description,
          badgeImageUrl: achievement.imageUri,
          theme: emailThemeFromBindings(context.env),
          linkedInOrganizationId: linkedInOrganizationIdForTenant(
            context.env.LINKEDIN_ORGANIZATION_IDS,
            tenantId,
          ),
        });
      },
    });
    if (emailOutcome === "failed") {
      logWarn(input.observabilityContext(context.env), "issuance_email_notification_failed", {
        assertionId,
        tenantId,
      });
    }
    try {
      await recordIssuanceEmailOutcome({ db, tenantId, assertionId, status: emailOutcome });
    } catch {
      // Issuance has committed. A missing notification record must not invite duplicate issuance.
      logWarn(input.observabilityContext(context.env), "issuance_email_outcome_record_failed", {
        assertionId,
        tenantId,
      });
    }

    return {
      status: "issued",
      tenantId,
      assertionId,
      idempotencyKey,
      vcR2Key: stored.key,
      credential: signedCredential,
    };
  };
};
