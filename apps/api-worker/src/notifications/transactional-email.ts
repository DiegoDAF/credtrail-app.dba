const DEFAULT_FROM_EMAIL = "no-reply@credtrail.org";
const DEFAULT_FROM_NAME = "CredTrail";

/** Explicit application message kinds used by the operator copy policy. */
export type TransactionalEmailKind =
  | "magic_link"
  | "password_reset"
  | "member_invite"
  | "issuance"
  | "rule_approval"
  | "rule_lifecycle";

export interface SendTransactionalEmailInput {
  kind: TransactionalEmailKind;
  emailBinding?: SendEmail | undefined;
  fromEmail?: string | undefined;
  fromName?: string | undefined;
  recipientEmail: string;
  subject: string;
  text: string;
  category: string;
}

export const sendTransactionalEmail = async (input: SendTransactionalEmailInput): Promise<void> => {
  if (input.emailBinding === undefined) {
    return;
  }

  await input.emailBinding.send({
    from: {
      email: input.fromEmail?.trim() || DEFAULT_FROM_EMAIL,
      name: input.fromName?.trim() || DEFAULT_FROM_NAME,
    },
    to: input.recipientEmail,
    subject: input.subject,
    text: input.text,
    headers: {
      "X-CredTrail-Email-Category": input.category,
      "X-CredTrail-Email-Kind": input.kind,
    },
  });
};
