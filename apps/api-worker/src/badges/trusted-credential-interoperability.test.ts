import jsonld from "jsonld";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { completeTrustEdCredentialMetadata } from "@credtrail/validation/testing";
import {
  projectTrustEdMetadataToOb3,
  emptyTrustEdOb3Projection,
  trustEdProjectionHasExtensionTerms,
  type TrustEdCredentialOb3Projection,
} from "./trusted-credential-ob3-projection";
import {
  generateTenantDidSigningMaterial,
  encodeJwkPublicKeyMultibase,
  signCredentialWithDataIntegrityProof,
  type JsonObject,
  trustedCredentialContext,
  TRUSTED_CREDENTIAL_CONTEXT_URL,
} from "@credtrail/core-domain";
import sources from "../../../../packages/core-domain/src/contexts/sources.json";

const officialDocuments = new Map(
  sources.map((source) => [
    source.url,
    JSON.parse(
      readFileSync(
        new URL(`../../../../packages/core-domain/src/contexts/${source.file}`, import.meta.url),
        "utf8",
      ),
    ) as unknown,
  ]),
);
const documentLoader = async (
  url: string,
): Promise<{ documentUrl: string; document: jsonld.NodeObject }> => {
  const document =
    url === TRUSTED_CREDENTIAL_CONTEXT_URL ? trustedCredentialContext : officialDocuments.get(url);
  if (
    document === undefined ||
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  )
    throw new Error("Unsupported fixture URL");
  // SAFETY: fixtures are checked-in JSON objects verified against their authoritative byte digests.
  return { documentUrl: url, document: document as jsonld.NodeObject };
};
const credentialFor = (projection: TrustEdCredentialOb3Projection): JsonObject => ({
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
    "https://www.w3.org/ns/credentials/status/v1",
    ...(trustEdProjectionHasExtensionTerms(projection) ? [TRUSTED_CREDENTIAL_CONTEXT_URL] : []),
  ],
  id: "urn:uuid:fc11db94-f8c4-4cfb-9efb-57428e74f49d",
  type: ["VerifiableCredential", "OpenBadgeCredential"],
  issuer: {
    id: "did:web:badges.example.edu",
    type: ["Profile"],
    name: "Example University",
    url: "https://badges.example.edu",
  },
  validFrom: "2026-10-03T00:00:00Z",
  credentialStatus: {
    id: "https://badges.example.edu/status#0",
    type: "BitstringStatusListEntry",
    statusPurpose: "revocation",
    statusListIndex: "0",
    statusListCredential: "https://badges.example.edu/status",
  },
  ...projection.credential,
  credentialSubject: {
    identifier: [
      {
        type: "IdentityObject",
        hashed: false,
        identityType: "emailAddress",
        identityHash: "learner@example.edu",
      },
    ],
    id: "mailto:learner@example.edu",
    type: ["AchievementSubject"],
    achievement: {
      id: "urn:uuid:1234",
      type: ["Achievement"],
      name: "Test achievement",
      image: { id: "https://example.edu/artwork.png", type: "Image" },
      ...projection.achievement,
    },
    ...projection.subject,
  },
});
const rdf = (credential: JsonObject): Promise<string> => {
  const options = {
    algorithm: "URDNA2015" as const,
    format: "application/n-quads" as const,
    documentLoader,
    safe: true,
  };
  return jsonld.canonize(credential, options);
};

describe("official-context interoperability", () => {
  it.each([
    ["base", {}, {}, null],
    [
      "criteria URI",
      { criteria: { type: "Criteria", id: "https://example.edu/criteria" } },
      {},
      "https://example.edu/criteria",
    ],
    [
      "criteria narrative",
      { criteria: { type: "Criteria", narrative: "Demonstrate understanding" } },
      {},
      "Demonstrate understanding",
    ],
    [
      "ordinary alignment",
      {
        alignment: [
          { type: "Alignment", targetUrl: "https://example.edu/skill", targetName: "Skill" },
        ],
      },
      {},
      "https://example.edu/skill",
    ],
    [
      "evidence",
      {},
      { evidence: [{ type: "Evidence", id: "https://example.edu/evidence", name: "Portfolio" }] },
      "Portfolio",
    ],
    ["result value", {}, { result: [{ type: "Result", value: "Pass" }] }, "Pass"],
  ] satisfies [string, JsonObject, JsonObject, string | null][])(
    "omits extensions for %s while retaining RDF",
    async (_name, achievement, subject, retained) => {
      const projection = {
        achievement,
        subject: _name === "evidence" ? {} : subject,
        credential: _name === "evidence" ? subject : {},
      };
      expect(trustEdProjectionHasExtensionTerms(projection)).toBe(false);
      const canonical = await rdf(credentialFor(projection));
      expect(canonical).toContain(retained ?? "VerifiableCredential");
    },
  );
  it("retains every full TrustEd extension and standard field", async () => {
    const projection = projectTrustEdMetadataToOb3(completeTrustEdCredentialMetadata());
    expect(trustEdProjectionHasExtensionTerms(projection)).toBe(true);
    const canonical = await rdf(credentialFor(projection));
    for (const term of [
      "assessment",
      "authorityType",
      "available",
      "creditValue",
      "duration",
      "earned",
      "endorsement",
      "issuerAuthority",
      "resultDate",
      "rubric",
      "skill",
      "sourceOrganization",
      "targetUrl",
      "value",
    ])
      expect(canonical).toContain(term);
    expect(canonical).toContain("6 weeks");
    expect(canonical).toContain(
      completeTrustEdCredentialMetadata().frameworkAlignments[0]?.frameworkUri,
    );
    expect(canonical).toContain(completeTrustEdCredentialMetadata().skills[0]?.source);
  });
  it.each([
    "frameworkUri",
    "resultDate",
    "skill",
    "assessment",
    "issuerAuthority",
    "rubric",
    "duration",
    "creditValue",
    "endorsement",
  ])("owns extension use for %s", async (field) => {
    const full = projectTrustEdMetadataToOb3(completeTrustEdCredentialMetadata());
    const projection =
      field === "frameworkUri"
        ? {
            achievement: { alignment: full.achievement.alignment ?? null },
            subject: {},
            credential: {},
          }
        : field === "resultDate"
          ? { achievement: {}, subject: { result: full.subject.result ?? null }, credential: {} }
          : {
              achievement: { [field]: full.achievement[field] ?? null },
              subject: {},
              credential: {},
            };
    expect(trustEdProjectionHasExtensionTerms(projection)).toBe(true);
    expect(await rdf(credentialFor(projection))).toContain(
      field === "frameworkUri" ? "targetUrl" : field,
    );
  });
  it("rejects the old protected source conflict", async () => {
    const credential = credentialFor(emptyTrustEdOb3Projection());
    credential["@context"] = [
      "https://www.w3.org/ns/credentials/v2",
      "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
      { "@protected": true, source: "https://schema.org/sourceOrganization" },
    ];
    await expect(rdf(credential)).rejects.toThrow("protected term");
  });
  it.each(["base", "full"])(
    "verifies a newly signed %s fixture with released independent verifier",
    async (shape) => {
      const material = await generateTenantDidSigningMaterial({
        did: "did:web:badges.example.edu",
        keyId: "key-1",
      });
      const credential = await signCredentialWithDataIntegrityProof({
        credential: credentialFor(
          shape === "base"
            ? emptyTrustEdOb3Projection()
            : projectTrustEdMetadataToOb3(completeTrustEdCredentialMetadata()),
        ),
        privateJwk: material.privateJwk,
        verificationMethod: "did:web:badges.example.edu#key-1",
        createdAt: "2026-10-03T00:00:00Z",
      });
      const output = execFileSync(
        process.execPath,
        [
          new URL("../../../../scripts/verify-credential-interoperability.mjs", import.meta.url)
            .pathname,
        ],
        {
          input: JSON.stringify({
            credential,
            publicKeyMultibase: encodeJwkPublicKeyMultibase(material.publicJwk),
            extension: trustedCredentialContext,
          }),
          encoding: "utf8",
        },
      );
      expect(JSON.parse(output)).toMatchObject({ verified: true });
      expect(() =>
        execFileSync(
          process.execPath,
          [
            new URL("../../../../scripts/verify-credential-interoperability.mjs", import.meta.url)
              .pathname,
          ],
          {
            input: JSON.stringify({
              credential: { ...credential, name: "Tampered name" },
              publicKeyMultibase: encodeJwkPublicKeyMultibase(material.publicJwk),
              extension: trustedCredentialContext,
            }),
            stdio: ["pipe", "pipe", "pipe"],
          },
        ),
      ).toThrow("Command failed");
    },
  );
});
