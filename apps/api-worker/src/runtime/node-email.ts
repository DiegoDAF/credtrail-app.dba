import { createConfiguredEmailBinding } from "../notifications/configured-email-binding";
import { createSesEmailBinding } from "../notifications/ses-email";
import { createSmtpEmail, type SmtpEmail } from "../notifications/smtp-email";
import {
  parseNodeEmailConfig,
  type EmailEnvironment,
  type NodeEmailConfig,
} from "./node-email-config";

/** Selected Node mail capability; construction never initializes Postgres or object storage. */
export interface NodeEmail {
  readonly config: NodeEmailConfig;
  readonly binding: SendEmail | undefined;
  readonly smtp: SmtpEmail | undefined;
}
/** Compose the selected transport with deployment-wide reply/copy policy. */
export const createNodeEmail = (environment: EmailEnvironment): NodeEmail => {
  const config = parseNodeEmailConfig(environment);
  switch (config.provider) {
    case "none":
      return { config, binding: undefined, smtp: undefined };
    case "ses":
      return {
        config,
        smtp: undefined,
        binding: createConfiguredEmailBinding(
          createSesEmailBinding({
            region: config.region,
            configurationSetName: config.configurationSetName,
          }),
          config.settings,
        ),
      };
    case "smtp": {
      const smtp = createSmtpEmail(config.smtp);
      return { config, smtp, binding: createConfiguredEmailBinding(smtp.binding, config.settings) };
    }
  }
};
