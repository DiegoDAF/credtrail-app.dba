import nodemailer, { type Transporter } from "nodemailer";

type SendEmailBuilderInput = Parameters<SendEmail["send"]>[0] extends EmailMessage
  ? never
  : Parameters<SendEmail["send"]>[0];

export interface CreateSmtpEmailBindingInput {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  password?: string | undefined;
  replyTo?: string | undefined;
  bcc?: string | undefined;
}

const formatEmailAddress = (address: string | EmailAddress): string => {
  if (typeof address === "string") {
    return address;
  }

  const email = address.email.trim();
  const name = address.name.trim();

  if (name.length === 0) {
    return email;
  }

  return `"${name.replace(/["\\]/g, (match) => `\\${match}`)}" <${email}>`;
};

const addressList = (
  input: string | EmailAddress | (string | EmailAddress)[] | undefined,
): string[] | undefined => {
  if (input === undefined) {
    return undefined;
  }

  const values = Array.isArray(input) ? input : [input];
  const normalized = values
    .map((value) => formatEmailAddress(value).trim())
    .filter((value) => value.length > 0);
  return normalized.length === 0 ? undefined : normalized;
};

const emailOf = (formatted: string): string => {
  const bracketed = /<([^>]+)>\s*$/.exec(formatted)?.[1];
  return (bracketed ?? formatted).trim().toLowerCase();
};

const withAlwaysBcc = (
  bcc: string[] | undefined,
  alwaysBcc: string | undefined,
  alreadyAddressed: (string[] | undefined)[],
): string[] | undefined => {
  const extra = alwaysBcc?.trim();

  if (extra === undefined || extra.length === 0) {
    return bcc;
  }

  const addressed = new Set([...alreadyAddressed, bcc].flatMap((list) => list ?? []).map(emailOf));

  if (addressed.has(emailOf(extra))) {
    return bcc;
  }

  return [...(bcc ?? []), extra];
};

export const createSmtpEmailBinding = (
  input: CreateSmtpEmailBindingInput,
  transporter: Transporter = nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure: input.secure,
    ...(input.user === undefined ? {} : { auth: { user: input.user, pass: input.password ?? "" } }),
  }),
): SendEmail => {
  return {
    send: async (message: EmailMessage | SendEmailBuilderInput): Promise<EmailSendResult> => {
      if (!("subject" in message)) {
        throw new Error("SMTP transactional email adapter requires builder-style messages");
      }

      if (message.attachments !== undefined && message.attachments.length > 0) {
        throw new Error("SMTP transactional email adapter does not support attachments");
      }

      const to = addressList(message.to);

      if (to === undefined) {
        throw new Error("SMTP transactional email requires at least one recipient");
      }

      const cc = addressList(message.cc);
      const bcc = withAlwaysBcc(addressList(message.bcc), input.bcc, [to, cc]);

      const result = await transporter.sendMail({
        from: formatEmailAddress(message.from),
        to,
        cc,
        bcc,
        replyTo:
          message.replyTo === undefined ? input.replyTo : formatEmailAddress(message.replyTo),
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      });

      return {
        messageId: result.messageId ?? "",
      };
    },
  };
};
