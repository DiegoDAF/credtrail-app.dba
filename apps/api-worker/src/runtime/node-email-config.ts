import { openSync, readSync, closeSync } from "node:fs";
import { inspect } from "node:util";
import { z } from "zod";

/** Environment input at the Node email composition boundary. */
export type EmailEnvironment = Readonly<Record<string, string | undefined>>;

/** Configuration error containing setting names only. */
export class EmailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigurationError";
  }
}

/** A credential whose inspection and serialization never reveal its contents. */
export class EmailSecret {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  /** Unwrap only at the transport authentication boundary. */
  reveal(): string {
    return this.#value;
  }
  /** Safe JSON representation. */
  toJSON(): string {
    return "[REDACTED]";
  }
  [inspect.custom](): string {
    return "[REDACTED]";
  }
}

/** Single mailbox without display-name or header syntax. */
export const emailMailboxSchema = z
  .email()
  .max(254)
  .refine((value) => !/[\r\n]/u.test(value));
const headerSchema = z
  .string()
  .max(998)
  .refine((value) => !/[\r\n]/u.test(value));
const settingsSchema = z.strictObject({
  fromAddress: emailMailboxSchema,
  fromName: headerSchema,
  replyTo: emailMailboxSchema.optional(),
  issuanceBcc: z.array(emailMailboxSchema).max(10),
});

/** Operator sender and copy policy shared by Node email transports. */
export type EmailSettings = z.infer<typeof settingsSchema>;

/** Parsed SMTP connection; no plaintext production mode is supported. */
export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly security: "starttls" | "tls";
  readonly auth:
    | { readonly kind: "none" }
    | {
        readonly kind: "login";
        readonly username: string;
        readonly password: EmailSecret;
      };
  readonly ca: string | undefined;
}

/** One selected transport, parsed before constructing the application runtime. */
export type NodeEmailConfig =
  | { readonly provider: "none" }
  | {
      readonly provider: "ses";
      readonly settings: EmailSettings;
      readonly region: string;
      readonly configurationSetName: string | undefined;
    }
  | { readonly provider: "smtp"; readonly settings: EmailSettings; readonly smtp: SmtpConfig };

const optional = (env: EmailEnvironment, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === "" ? undefined : value;
};
const parseSetting = <T>(schema: z.ZodType<T>, value: unknown, name: string): T => {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new EmailConfigurationError(`Invalid email configuration: check ${name}`);
  return result.data;
};
const readBoundedFile = (path: string, name: string): string => {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const bytes = Buffer.alloc(65_537);
    let length = 0;
    while (length < bytes.length) {
      const received = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (received === 0) break;
      length += received;
    }
    if (length === 0 || length > 65_536) throw new Error("Invalid file size");
    return bytes.subarray(0, length).toString("utf8");
  } catch {
    throw new EmailConfigurationError(
      `Cannot read ${name}—mount a nonempty file of at most 64 KiB`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

/** Parse only the selected provider; diagnostics identify settings without exposing values. */
export const parseNodeEmailConfig = (env: EmailEnvironment): NodeEmailConfig => {
  const provider = parseSetting(
    z.enum(["none", "ses", "smtp"]),
    optional(env, "EMAIL_PROVIDER")?.toLowerCase() ?? "none",
    "EMAIL_PROVIDER",
  );
  if (provider === "none") return { provider };
  if (optional(env, "TRANSACTIONAL_EMAIL_FROM_ADDRESS") === undefined) {
    throw new EmailConfigurationError("TRANSACTIONAL_EMAIL_FROM_ADDRESS is required");
  }
  const settings = parseSetting(
    settingsSchema,
    {
      fromAddress: optional(env, "TRANSACTIONAL_EMAIL_FROM_ADDRESS"),
      fromName: optional(env, "TRANSACTIONAL_EMAIL_FROM_NAME") ?? "CredTrail",
      replyTo: optional(env, "TRANSACTIONAL_EMAIL_REPLY_TO"),
      issuanceBcc:
        optional(env, "ISSUANCE_EMAIL_BCC")
          ?.split(",")
          .map((value) => value.trim()) ?? [],
    },
    "sender address/name, Reply-To, or issuance BCC",
  );
  if (provider === "ses") {
    return {
      provider,
      settings,
      region: parseSetting(
        z.string().min(1),
        optional(env, "AWS_SES_REGION") ?? optional(env, "S3_REGION"),
        "AWS_SES_REGION",
      ),
      configurationSetName: optional(env, "AWS_SES_CONFIGURATION_SET"),
    };
  }
  const security = parseSetting(
    z.enum(["starttls", "tls"]),
    optional(env, "SMTP_SECURITY") ?? "starttls",
    "SMTP_SECURITY",
  );
  const host = parseSetting(
    z
      .string()
      .max(253)
      .regex(
        /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/u,
      )
      .refine((value) => !/^\d+(?:\.\d+){3}$/u.test(value)),
    optional(env, "SMTP_HOST"),
    "SMTP_HOST",
  );
  const port = parseSetting(
    z.coerce.number().int().min(1).max(65535),
    optional(env, "SMTP_PORT") ?? (security === "tls" ? 465 : 587),
    "SMTP_PORT",
  );
  const authKind = parseSetting(
    z.enum(["none", "login"]),
    optional(env, "SMTP_AUTH") ?? "login",
    "SMTP_AUTH",
  );
  const passwordFile = optional(env, "SMTP_PASSWORD_FILE");
  const password = env.SMTP_PASSWORD === "" ? undefined : env.SMTP_PASSWORD;
  const username = optional(env, "SMTP_USERNAME");
  let auth: SmtpConfig["auth"];
  if (authKind === "none") {
    if (username !== undefined || password !== undefined || passwordFile !== undefined) {
      throw new EmailConfigurationError(
        "SMTP_AUTH=none requires SMTP_USERNAME and password settings to be unset",
      );
    }
    auth = { kind: "none" };
  } else {
    if ((password === undefined) === (passwordFile === undefined)) {
      throw new EmailConfigurationError("Set exactly one of SMTP_PASSWORD or SMTP_PASSWORD_FILE");
    }
    const secret =
      passwordFile === undefined
        ? password
        : readBoundedFile(passwordFile, "SMTP_PASSWORD_FILE").replace(/\r?\n$/u, "");
    auth = {
      kind: "login",
      username: parseSetting(headerSchema.min(1), username, "SMTP_USERNAME"),
      password: new EmailSecret(parseSetting(z.string().min(1), secret, "SMTP_PASSWORD")),
    };
  }
  const caFile = optional(env, "SMTP_TLS_CA_FILE");
  return {
    provider,
    settings,
    smtp: {
      host,
      port,
      security,
      auth,
      ca: caFile === undefined ? undefined : readBoundedFile(caFile, "SMTP_TLS_CA_FILE"),
    },
  };
};
