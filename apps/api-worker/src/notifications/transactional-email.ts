import type { EmailTheme } from "./email-theme";
import type { TransactionalEmailContent } from "./transactional-email-content";
import { renderTransactionalEmail } from "./transactional-email-renderer";

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
  content: TransactionalEmailContent;
  category: string;
  theme?: EmailTheme | undefined;
}

export const sendTransactionalEmail = async (input: SendTransactionalEmailInput): Promise<void> => {
  if (input.emailBinding === undefined) {
    return;
  }

  const fromName = input.fromName?.trim() || DEFAULT_FROM_NAME;
  const rendered = await renderTransactionalEmail(input.content, {
    theme: input.theme,
    brand: fromName,
  });
  await input.emailBinding.send({
    from: {
      email: input.fromEmail?.trim() || DEFAULT_FROM_EMAIL,
      name: fromName,
    },
    to: input.recipientEmail,
    subject: input.subject,
    text: rendered.text,
    html: rendered.html,
    headers: {
      "X-CredTrail-Email-Category": input.category,
      "X-CredTrail-Email-Kind": input.kind,
    },
  });
};
