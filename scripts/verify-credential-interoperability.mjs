// Test-only released verifier; authoritative fixtures are read independently of the product loader.
import { readFileSync } from "node:fs";
import { DataIntegrityProof } from "@digitalbazaar/data-integrity";
import { cryptosuite } from "@digitalbazaar/eddsa-rdfc-2022-cryptosuite";
import jsigs from "jsonld-signatures";
const { credential, publicKeyMultibase, extension } = JSON.parse(readFileSync(0, "utf8"));
const documents = new Map([
  [
    "https://www.w3.org/ns/credentials/v2",
    JSON.parse(
      readFileSync(
        new URL("../packages/core-domain/src/contexts/credentials-v2.json", import.meta.url),
      ),
    ),
  ],
  [
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
    JSON.parse(
      readFileSync(
        new URL("../packages/core-domain/src/contexts/open-badges-3.0.3.json", import.meta.url),
      ),
    ),
  ],
  [
    "https://www.w3.org/ns/credentials/status/v1",
    JSON.parse(
      readFileSync(new URL("../packages/core-domain/src/contexts/status-v1.json", import.meta.url)),
    ),
  ],
  ["https://credtrail.org/ns/trusted-credential/v1", extension],
]);
const verificationMethod = credential.proof.verificationMethod;
const controller = verificationMethod.split("#")[0];
const key = { id: verificationMethod, controller, type: "Multikey", publicKeyMultibase };
const documentLoader = async (url) => {
  const document =
    url === verificationMethod
      ? key
      : url === controller
        ? {
            "@context": "https://www.w3.org/ns/did/v1",
            id: controller,
            assertionMethod: [verificationMethod],
          }
        : documents.get(url);
  if (!document) throw new Error("Unsupported offline verification document");
  return { contextUrl: null, documentUrl: url, document };
};
const result = await jsigs.verify(credential, {
  suite: new DataIntegrityProof({ cryptosuite }),
  purpose: new jsigs.purposes.AssertionProofPurpose(),
  documentLoader,
});
if (!result.verified) {
  console.error(
    JSON.stringify(result, (key, value) =>
      value instanceof Error ? { message: value.message, stack: value.stack } : value,
    ),
  );
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      verified: true,
      verifier: "jsonld-signatures 11.6.0 / data-integrity 2.5.0 / eddsa-rdfc-2022 1.3.0",
    }),
  );
