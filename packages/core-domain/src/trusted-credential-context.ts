import type { JsonObject } from "./index";

const OB_VOCAB = "https://purl.imsglobal.org/spec/vc/ob/vocab.html#";
const XSD_DATETIME = "http://www.w3.org/2001/XMLSchema#dateTime";
export const TRUSTED_CREDENTIAL_CONTEXT_URL = "https://credtrail.org/ns/trusted-credential/v1";
export const trustedCredentialContext: JsonObject = {
  "@context": {
    "@protected": true,
    id: "@id",
    type: "@type",
    Assessment: `${OB_VOCAB}Assessment`,
    CreditValue: `${OB_VOCAB}CreditValue`,
    Duration: {
      "@id": `${OB_VOCAB}Duration`,
      "@context": { "@protected": true, value: "https://schema.org/value" },
    },
    Endorsement: `${OB_VOCAB}Endorsement`,
    IssuerAuthority: `${OB_VOCAB}IssuerAuthority`,
    Rubric: `${OB_VOCAB}Rubric`,
    Skill: `${OB_VOCAB}Skill`,
    assessment: {
      "@id": `${OB_VOCAB}assessment`,
      "@container": "@set",
    },
    assessmentDate: `${OB_VOCAB}assessmentDate`,
    authorityType: `${OB_VOCAB}authorityType`,
    available: `${OB_VOCAB}available`,
    creditValue: `${OB_VOCAB}creditValue`,
    duration: `${OB_VOCAB}duration`,
    earned: `${OB_VOCAB}earned`,
    endorsement: {
      "@id": `${OB_VOCAB}endorsement`,
      "@container": "@set",
    },
    issuerAuthority: `${OB_VOCAB}issuerAuthority`,
    resultDate: {
      "@id": `${OB_VOCAB}resultDate`,
      "@type": XSD_DATETIME,
    },
    rubric: {
      "@id": `${OB_VOCAB}rubric`,
      "@container": "@set",
    },
    skill: {
      "@id": `${OB_VOCAB}skill`,
      "@container": "@set",
    },
    skillSource: "https://schema.org/sourceOrganization",
    frameworkUri: {
      "@id": "https://schema.org/targetUrl",
      "@type": "https://www.w3.org/2001/XMLSchema#anyURI",
    },
  },
};
