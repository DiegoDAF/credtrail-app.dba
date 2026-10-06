import { canonicalAppUrl } from "../http/canonical-app-url";

/** Status links use the configured public origin, never a request or proxy hostname. */
export const programmaticOperationStatusUrl = (
  publicOrigin: string,
  tenantId: string,
  operationId: string,
): string =>
  canonicalAppUrl(
    publicOrigin,
    `/v1/programmatic/operations/${encodeURIComponent(operationId)}?${new URLSearchParams({ tenantId })}`,
  );

/** Credentials without a public badge identifier do not acquire an internal-ID public link. */
export const programmaticBadgeLinks = (
  publicOrigin: string,
  publicId: string | null,
): { readonly badgeUrl: string | null; readonly credentialUrl: string | null } => {
  if (publicId === null) return { badgeUrl: null, credentialUrl: null };
  const badgeUrl = canonicalAppUrl(publicOrigin, `/badges/${encodeURIComponent(publicId)}`);
  return { badgeUrl, credentialUrl: `${badgeUrl}/jsonld` };
};
