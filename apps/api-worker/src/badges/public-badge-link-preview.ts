import type { JsonObject } from "@credtrail/core-domain";
import {
  isBlockedNetworkHostname,
  isPublicNetworkAddress,
  literalNetworkAddress,
} from "../http/public-network-address";
import { asJsonObject, asNonEmptyString } from "../utils/value-parsers";
import { badgeNameFromCredential } from "./credential-display";
import { achievementDetailsFromCredential, linkedDataReferenceId } from "./public-badge-helpers";

export interface PublicBadgeLinkPreview {
  title: string;
  description: string;
  siteName: string;
  imageUrl: string | null;
  imageAlt: string | null;
}

const publicImageUrl = (value: string | null, canonicalUrl: string): string | null => {
  if (value === null) {
    return null;
  }

  try {
    const url = new URL(value, canonicalUrl);
    const address = literalNetworkAddress(url.hostname);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      (address === null && !url.hostname.includes(".")) ||
      isBlockedNetworkHostname(url.hostname) ||
      (address !== null && !isPublicNetworkAddress(address))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

export const publicBadgeLinkPreview = (
  credential: JsonObject,
  canonicalUrl: string,
): PublicBadgeLinkPreview => {
  const badgeName = asNonEmptyString(badgeNameFromCredential(credential)) ?? "Badge credential";
  const issuer = asJsonObject(credential.issuer);
  const issuerName = asNonEmptyString(issuer?.name);
  const siteName = issuerName ?? "CredTrail";
  const achievement = achievementDetailsFromCredential(credential);
  const introduction =
    issuerName === null
      ? `${badgeName} credential on CredTrail.`
      : `${badgeName} credential issued by ${issuerName}.`;
  const badgeImageUrl = publicImageUrl(achievement.imageUri, canonicalUrl);
  const imageUrl =
    badgeImageUrl ?? publicImageUrl(linkedDataReferenceId(issuer?.image), canonicalUrl);

  return {
    title: `${badgeName} | ${siteName}`,
    description:
      achievement.description === null
        ? introduction
        : `${introduction} ${achievement.description}`,
    siteName,
    imageUrl,
    imageAlt:
      imageUrl === null
        ? null
        : badgeImageUrl === null
          ? `${issuerName ?? "Issuer"} logo`
          : `${badgeName} badge artwork`,
  };
};
