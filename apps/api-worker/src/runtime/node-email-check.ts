import { z } from "zod";
import { createNodeEmail } from "./node-email";
import {
  EmailConfigurationError,
  emailMailboxSchema,
  type EmailEnvironment,
} from "./node-email-config";
import { SmtpFailure } from "../notifications/smtp-email";

/** Safe operator output; a successful send means relay acceptance, not inbox delivery. */
export interface EmailCheckResult {
  readonly exitCode: 0 | 1;
  readonly message: string;
}

/** Verify SMTP, or explicitly send one token-free message when --to is supplied. */
export const checkNodeEmail = async (
  environment: EmailEnvironment,
  args: readonly string[],
): Promise<EmailCheckResult> => {
  const parsed = z
    .union([z.tuple([]), z.tuple([z.literal("--to"), emailMailboxSchema])])
    .safeParse(args);
  if (!parsed.success)
    return { exitCode: 1, message: "Usage: email check [--to recipient@example.edu]" };
  try {
    const email = createNodeEmail(environment);
    if (email.config.provider === "none")
      return {
        exitCode: 1,
        message: "Email is disabled—set EMAIL_PROVIDER=smtp and configure your mail relay",
      };
    if (email.config.provider !== "smtp" || email.smtp === undefined || email.binding === undefined)
      return {
        exitCode: 1,
        message: "SMTP verification requires EMAIL_PROVIDER=smtp; SES is selected",
      };
    const recipient = parsed.data[1];
    if (recipient === undefined) {
      const verified = await email.smtp.verify();
      return verified.status === "error"
        ? { exitCode: 1, message: verified.error.message }
        : {
            exitCode: 0,
            message:
              "SMTP connection and authentication succeeded. Sender acceptance and inbox delivery have not been tested.",
          };
    }
    await email.binding.send({
      from: { email: email.config.settings.fromAddress, name: email.config.settings.fromName },
      to: recipient,
      subject: "CredTrail email check",
      text: "Your mail relay accepted this CredTrail test message. This message contains no account access links.",
      headers: { "X-CredTrail-Email-Kind": "operator_test" },
    });
    return {
      exitCode: 0,
      message: "The SMTP relay accepted the test message. Inbox delivery is not confirmed.",
    };
  } catch (cause: unknown) {
    return {
      exitCode: 1,
      message:
        cause instanceof SmtpFailure || cause instanceof EmailConfigurationError
          ? cause.message
          : "Email configuration failed—check the SMTP, sender, and mounted secret settings",
    };
  }
};
