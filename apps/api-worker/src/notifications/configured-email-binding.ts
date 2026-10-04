import type { EmailSettings } from "../runtime/node-email-config";

/** Apply operator reply/copy policy without copying authentication or invitation links. */
export const createConfiguredEmailBinding = (
  binding: SendEmail,
  settings: EmailSettings,
): SendEmail => ({
  send: async (message): Promise<EmailSendResult> => {
    if (!("subject" in message)) throw new Error("Transactional email requires a builder message");
    if (message.to === undefined)
      throw new Error("Transactional email requires a primary recipient");
    const { bcc: _callerBcc, replyTo: _callerReplyTo, ...delivery } = message;
    const issuance = message.headers?.["X-CredTrail-Email-Kind"] === "issuance";
    return binding.send({
      ...delivery,
      to: message.to,
      ...(settings.replyTo === undefined ? {} : { replyTo: settings.replyTo }),
      ...(issuance && settings.issuanceBcc.length > 0 ? { bcc: settings.issuanceBcc } : {}),
    });
  },
});
