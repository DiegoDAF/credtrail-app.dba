interface LinkedInAddToProfileInput {
  badgeName: string;
  issuerName: string;
  issuedAtIso: string;
  credentialUrl: string;
  credentialId: string;
  /** Issuer's LinkedIn company page ID. LinkedIn then links the certification to the page and shows its logo. */
  organizationId?: string | undefined;
}

const LINKEDIN_ORGANIZATION_ID_PATTERN = /^\d+$/;

/**
 * LinkedIn company page ID for a tenant, from LINKEDIN_ORGANIZATION_IDS ("tenant:pageId,other:pageId").
 * Entries without a numeric page ID are ignored.
 */
export const linkedInOrganizationIdForTenant = (
  configuredIds: string | undefined,
  tenantId: string,
): string | undefined => {
  for (const entry of (configuredIds ?? "").split(",")) {
    const separatorIndex = entry.lastIndexOf(":");
    const entryTenantId = entry.slice(0, Math.max(separatorIndex, 0)).trim();
    const organizationId = entry.slice(separatorIndex + 1).trim();

    if (
      separatorIndex > 0 &&
      entryTenantId === tenantId &&
      LINKEDIN_ORGANIZATION_ID_PATTERN.test(organizationId)
    ) {
      return organizationId;
    }
  }

  return undefined;
};

const linkedInIssuedDateFromIso = (
  issuedAtIso: string,
): {
  issueYear: string;
  issueMonth: string;
} | null => {
  const timestampMs = Date.parse(issuedAtIso);

  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  const issuedAtDate = new Date(timestampMs);
  return {
    issueYear: String(issuedAtDate.getUTCFullYear()),
    issueMonth: String(issuedAtDate.getUTCMonth() + 1),
  };
};

export const formatIsoTimestamp = (timestampIso: string): string => {
  const timestampMs = Date.parse(timestampIso);

  if (!Number.isFinite(timestampMs)) {
    return timestampIso;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(timestampMs));
};

export const linkedInAddToProfileUrl = (input: LinkedInAddToProfileInput): string => {
  const linkedInUrl = new URL("https://www.linkedin.com/profile/add");
  linkedInUrl.searchParams.set("startTask", "CERTIFICATION_NAME");
  linkedInUrl.searchParams.set("name", input.badgeName);
  linkedInUrl.searchParams.set("certUrl", input.credentialUrl);

  const credentialId = input.credentialId.trim();

  if (credentialId.length > 0) {
    linkedInUrl.searchParams.set("certId", credentialId);
  }

  const organizationId = input.organizationId?.trim() ?? "";
  const issuerName = input.issuerName.trim();

  // LinkedIn takes organizationId or organizationName, never both.
  if (LINKEDIN_ORGANIZATION_ID_PATTERN.test(organizationId)) {
    linkedInUrl.searchParams.set("organizationId", organizationId);
  } else if (issuerName.length > 0 && issuerName !== "Unknown issuer") {
    linkedInUrl.searchParams.set("organizationName", issuerName);
  }

  const issuedDate = linkedInIssuedDateFromIso(input.issuedAtIso);

  if (issuedDate !== null) {
    linkedInUrl.searchParams.set("issueYear", issuedDate.issueYear);
    linkedInUrl.searchParams.set("issueMonth", issuedDate.issueMonth);
  }

  return linkedInUrl.toString();
};
