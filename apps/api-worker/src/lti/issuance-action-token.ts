import { z } from "zod";
import type { AppBindings } from "../app/types";
import {
  createSignedJsonToken,
  namespacedSigningSecret,
  signedJsonTokenExpiry,
  verifySignedJsonToken,
} from "../signed-json-token";
import { ltiStateSigningSecret } from "./lti-helpers";

type LtiIssuanceActionBindings = Pick<AppBindings, "LTI_STATE_SIGNING_SECRET">;

const issuanceActionPayloadSchema = z.object({
  tenantId: z.string().min(1),
  ltiSessionId: z.string().min(1),
  issuer: z.string().min(1),
  clientId: z.string().min(1),
  deploymentId: z.string().min(1),
  contextId: z.string().min(1),
  resourceLinkId: z.string().min(1),
  badgeTemplateId: z.string().min(1),
  ruleId: z.string().min(1),
  versionId: z.string().min(1),
  issuedByUserId: z.string().min(1),
  exp: z.number().int(),
});

/** Signed course, actor, and approved rule version authorized by the instructor launch. */
export type LtiIssuanceActionPayload = z.infer<typeof issuanceActionPayloadSchema>;

const issuanceActionSigningSecret = (env: LtiIssuanceActionBindings): string => {
  return namespacedSigningSecret(ltiStateSigningSecret(env), "issuance-action");
};

const parseLtiIssuanceActionPayload = (value: unknown): LtiIssuanceActionPayload | null => {
  const parsed = issuanceActionPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const createLtiIssuanceActionToken = async (
  env: LtiIssuanceActionBindings,
  input: Omit<LtiIssuanceActionPayload, "exp"> & {
    ttlSeconds: number;
  },
): Promise<string> => {
  return createSignedJsonToken(issuanceActionSigningSecret(env), {
    tenantId: input.tenantId,
    ltiSessionId: input.ltiSessionId,
    issuer: input.issuer,
    clientId: input.clientId,
    deploymentId: input.deploymentId,
    contextId: input.contextId,
    resourceLinkId: input.resourceLinkId,
    badgeTemplateId: input.badgeTemplateId,
    ruleId: input.ruleId,
    versionId: input.versionId,
    issuedByUserId: input.issuedByUserId,
    exp: signedJsonTokenExpiry(input.ttlSeconds),
  });
};

export const verifyLtiIssuanceActionToken = async (
  env: LtiIssuanceActionBindings,
  token: string,
): Promise<LtiIssuanceActionPayload | null> => {
  return verifySignedJsonToken(
    issuanceActionSigningSecret(env),
    token,
    parseLtiIssuanceActionPayload,
  );
};
