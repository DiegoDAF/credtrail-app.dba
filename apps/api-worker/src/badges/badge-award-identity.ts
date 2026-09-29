/** Identifies one learner's award of an institutional badge across courses and rule versions. */
export const badgeAwardIdempotencyKey = async (input: {
  readonly tenantId: string;
  readonly badgeTemplateId: string;
  readonly recipientEmail: string;
  readonly renewalOfAssertionId?: string | undefined;
  readonly sha256Hex: (value: string) => Promise<string>;
}): Promise<string> => {
  const identity = JSON.stringify([
    input.tenantId,
    input.badgeTemplateId,
    input.recipientEmail.trim().toLowerCase(),
    ...(input.renewalOfAssertionId === undefined ? [] : [input.renewalOfAssertionId]),
  ]);
  return `badge-award:${await input.sha256Hex(identity)}`;
};
