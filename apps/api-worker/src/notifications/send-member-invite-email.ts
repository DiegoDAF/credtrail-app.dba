import type { EmailTheme } from "./email-theme";
import { sendTransactionalEmail } from "./transactional-email";

export interface SendMemberInviteEmailNotificationInput {
  emailBinding?: SendEmail | undefined;
  fromEmail?: string | undefined;
  fromName?: string | undefined;
  theme?: EmailTheme | undefined;
  recipientEmail: string;
  tenantDisplayName: string;
  role: string;
  signInUrl: string;
}

export const sendMemberInviteEmailNotification = async (
  input: SendMemberInviteEmailNotificationInput,
): Promise<void> => {
  const subject = `You have been added to ${input.tenantDisplayName} on CredTrail`;
  await sendTransactionalEmail({
    kind: "member_invite",
    emailBinding: input.emailBinding,
    fromEmail: input.fromEmail,
    fromName: input.fromName,
    theme: input.theme,
    recipientEmail: input.recipientEmail,
    subject,
    content: {
      institution: input.tenantDisplayName,
      title: `You have been added to ${input.tenantDisplayName}`,
      paragraphs: ["Sign in with your institution account to get started."],
      details: [{ label: "Your role", value: input.role }],
      action: { label: "Sign in", url: input.signInUrl },
      footer: "Contact your institution administrator if you have questions about your access.",
    },
    category: "Tenant Member Invite",
  });
};
