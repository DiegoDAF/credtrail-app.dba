import type { JsonObject } from "@credtrail/core-domain";
import { publicHttpUrl } from "../http/public-http-url";
import { asJsonObject, asNonEmptyString } from "../utils/value-parsers";
import { badgeNameFromCredential, issuerBrandNameFromCredential } from "./credential-display";
import { achievementDetailsFromCredential, linkedDataReferenceId } from "./public-badge-helpers";

export interface PublicBadgeLinkPreview {
  title: string;
  description: string;
  siteName: string;
  imageUrl: string | null;
  imageAlt: string | null;
}

export const publicBadgeLinkPreview = (
  credential: JsonObject,
  canonicalUrl: string,
): PublicBadgeLinkPreview => {
  const badgeName = asNonEmptyString(badgeNameFromCredential(credential)) ?? "Badge credential";
  const issuerName = issuerBrandNameFromCredential(credential);
  const siteName = issuerName ?? "CredTrail";
  const achievement = achievementDetailsFromCredential(credential);
  const introduction =
    issuerName === null
      ? `${badgeName} credential on CredTrail.`
      : `${badgeName} credential issued by ${issuerName}.`;
  const badgeImageUrl =
    achievement.imageUri === null
      ? null
      : (publicHttpUrl(achievement.imageUri, canonicalUrl)?.toString() ?? null);
  const issuerImageUri = linkedDataReferenceId(asJsonObject(credential.issuer)?.image);
  const imageUrl =
    badgeImageUrl ??
    (issuerImageUri === null
      ? null
      : (publicHttpUrl(issuerImageUri, canonicalUrl)?.toString() ?? null));

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
