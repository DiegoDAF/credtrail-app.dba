import { DEFAULT_EMAIL_THEME, type EmailTheme } from "./email-theme";
import {
  transactionalEmailContentSchema,
  type TransactionalEmailContent,
} from "./transactional-email-content";

export interface RenderedTransactionalEmail {
  readonly text: string;
  readonly html: string;
}

export interface RenderTransactionalEmailOptions {
  /** Issuer colors and logo; the built-in CredTrail palette when absent. */
  readonly theme?: EmailTheme | undefined;
  /** Brand label above the heading, normally the sender name. */
  readonly brand?: string | undefined;
}

export const renderTransactionalEmail = async (
  input: TransactionalEmailContent,
  options: RenderTransactionalEmailOptions = {},
): Promise<RenderedTransactionalEmail> => {
  const parsed = transactionalEmailContentSchema.safeParse(input);
  if (!parsed.success) {
    // Validation errors must never include authentication URLs or their tokens.
    throw new Error("Transactional email content is invalid");
  }
  const content = parsed.data;
  const theme = options.theme ?? DEFAULT_EMAIL_THEME;
  const brand = options.brand?.trim() || "CredTrail";
  // The hero artwork takes the logo's place so the card never stacks two images.
  const logoUrl = content.image === undefined ? theme.logoUrl : undefined;
  const text = [
    content.institution,
    content.title,
    "",
    ...content.paragraphs.flatMap((paragraph) => [paragraph, ""]),
    ...content.details.map((detail) => `${detail.label}: ${detail.value}`),
    "",
    `${content.action.label}: ${content.action.url}`,
    ...content.secondaryActions.map((action) => `${action.label}: ${action.url}`),
    "",
    content.footer,
    "Sent with CredTrail.",
  ].join("\n");
  const document = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{content.title}</title>
      </head>
      <body
        style={{
          margin: "0",
          backgroundColor: "#f7fafd",
          color: "#173a5c",
          fontFamily: "Arial, 'Segoe UI', sans-serif",
          fontSize: "16px",
          lineHeight: "1.6",
        }}
      >
        <table role="presentation" width="100%" cellPadding="0" cellSpacing="0">
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <table
                  role="presentation"
                  width="100%"
                  cellPadding="0"
                  cellSpacing="0"
                  style={{
                    maxWidth: "600px",
                    backgroundColor: "#ffffff",
                    border: "1px solid #dbe5ef",
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          padding: "28px 24px",
                          borderTop: `4px solid ${theme.headerColor}`,
                        }}
                      >
                        {logoUrl === undefined ? null : (
                          <img
                            src={logoUrl}
                            width="180"
                            height="180"
                            alt=""
                            style={{
                              display: "block",
                              margin: "0 auto 16px",
                              width: "180px",
                              height: "180px",
                              border: "0",
                            }}
                          />
                        )}
                        {content.image === undefined ? null : (
                          <img
                            src={content.image.url}
                            width="128"
                            height="128"
                            alt={content.image.alt}
                            style={{
                              display: "block",
                              margin: "0 auto 16px",
                              width: "128px",
                              height: "128px",
                              border: "0",
                            }}
                          />
                        )}
                        <p
                          style={{
                            margin: "0 0 8px",
                            color: theme.highlightColor,
                            fontWeight: "bold",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {brand}
                        </p>
                        <p style={{ margin: "0 0 24px", overflowWrap: "anywhere" }}>
                          {content.institution}
                        </p>
                        <h1
                          style={{
                            margin: "0 0 20px",
                            color: "#0d2543",
                            fontFamily: "Georgia, serif",
                            fontSize: "28px",
                            lineHeight: "1.3",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {content.title}
                        </h1>
                        {content.paragraphs.map((paragraph) => (
                          <p
                            style={{
                              margin: "0 0 16px",
                              whiteSpace: "pre-line",
                              overflowWrap: "anywhere",
                            }}
                          >
                            {paragraph}
                          </p>
                        ))}
                        {content.details.length > 0 && (
                          <dl style={{ margin: "0 0 24px" }}>
                            {content.details.map((detail) => (
                              <div style={{ marginBottom: "12px" }}>
                                <dt style={{ fontWeight: "bold" }}>{detail.label}</dt>
                                <dd style={{ margin: "0", overflowWrap: "anywhere" }}>
                                  {detail.value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        <p style={{ margin: "24px 0" }}>
                          <a
                            href={content.action.url}
                            style={{
                              display: "inline-block",
                              backgroundColor: theme.accentColor,
                              color: "#ffffff",
                              padding: "12px 20px",
                              textDecoration: "none",
                              fontWeight: "bold",
                            }}
                          >
                            {content.action.label}
                          </a>
                        </p>
                        {content.secondaryActions.map((action) => (
                          <p style={{ margin: "0 0 12px" }}>
                            <a href={action.url} style={{ color: theme.accentColor }}>
                              {action.label}
                            </a>
                          </p>
                        ))}
                        <p style={{ fontSize: "14px", margin: "24px 0 8px" }}>
                          You can also copy this link into your browser:
                        </p>
                        <p style={{ fontSize: "14px", margin: "0", wordBreak: "break-all" }}>
                          <a href={content.action.url} style={{ color: theme.accentColor }}>
                            {content.action.url}
                          </a>
                        </p>
                        <p
                          style={{
                            margin: "28px 0 0",
                            paddingTop: "20px",
                            borderTop: "1px solid #dbe5ef",
                            color: "#4c6784",
                            fontSize: "14px",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {content.footer}
                        </p>
                        <p style={{ margin: "8px 0 0", color: "#4c6784", fontSize: "14px" }}>
                          Sent with CredTrail.
                        </p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
  return { text, html: "<!DOCTYPE html>" + (await document) };
};
