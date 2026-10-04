import type { JsonObject } from "./index";
import credentialsV2 from "./contexts/credentials-v2.json";
import openBadges from "./contexts/open-badges-3.0.3.json";
import statusV1 from "./contexts/status-v1.json";
import {
  trustedCredentialContext,
  TRUSTED_CREDENTIAL_CONTEXT_URL,
} from "./trusted-credential-context";

// Unmodified authoritative documents; origins and byte digests live beside the fixtures.
export const pinnedJsonLdContexts: ReadonlyMap<string, JsonObject> = new Map<string, JsonObject>([
  ["https://www.w3.org/ns/credentials/v2", credentialsV2],
  ["https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json", openBadges],
  ["https://www.w3.org/ns/credentials/status/v1", statusV1],
  [TRUSTED_CREDENTIAL_CONTEXT_URL, trustedCredentialContext],
]);

const asJsonObject = (value: unknown): JsonObject | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
};

const collectContextTerms = (value: unknown, terms: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectContextTerms(entry, terms);
    }
    return;
  }

  const valueObject = asJsonObject(value);

  if (valueObject === null) {
    return;
  }

  const nestedContext = valueObject["@context"];

  if (nestedContext !== undefined && nestedContext !== value) {
    collectContextTerms(nestedContext, terms);
  }

  for (const [key, entryValue] of Object.entries(valueObject)) {
    if (key.startsWith("@")) {
      continue;
    }

    const normalizedKey = key.trim();

    if (normalizedKey.length > 0) {
      terms.add(normalizedKey);
    }

    const entryObject = asJsonObject(entryValue);

    if (entryObject?.["@context"] !== undefined) {
      collectContextTerms(entryObject["@context"], terms);
    }
  }
};

const contextTermsFromPinnedDocument = (document: JsonObject): readonly string[] => {
  const terms = new Set<string>();
  collectContextTerms(document["@context"], terms);
  return Array.from(terms).sort();
};

export const pinnedJsonLdContextTermSets: ReadonlyMap<string, readonly string[]> = new Map(
  Array.from(pinnedJsonLdContexts.entries(), ([contextUrl, document]) => {
    return [contextUrl, contextTermsFromPinnedDocument(document)] as const;
  }),
);
