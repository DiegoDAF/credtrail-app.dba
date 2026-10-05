import { sendTransactionalEmail } from "./transactional-email";

export interface SendPasswordResetEmailNotificationInput {
  emailBinding?: SendEmail | undefined;
  fromEmail?: string | undefined;
  fromName?: string | undefined;
  recipientEmail: string;
  tenantDisplayName?: string | undefined;
  tenantId: string;
  resetUrl: string;
}

export const sendPasswordResetEmailNotification = async (
  input: SendPasswordResetEmailNotificationInput,
): Promise<void> => {
  const institution = input.tenantDisplayName?.trim() || "CredTrail";
  const subject = `Set up local access to ${institution}`;
  await sendTransactionalEmail({
    kind: "password_reset",
    emailBinding: input.emailBinding,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    recipientEmail: input.recipientEmail,
    subject,
    content: {
      institution,
      title: subject,
      paragraphs: [
        "Set or reset your password for local emergency access.",
        "After setting your password, complete local MFA enrollment before relying on emergency access.",
      ],
      details: [],
      action: { label: "Set your password", url: input.resetUrl },
      secondaryActions: [],
      footer: "If you did not request this change, you can ignore this email.",
    },
    category: "Auth Password Reset",
  });
};
