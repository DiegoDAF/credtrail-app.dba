import type { ImmutableCredentialStore, JsonObject } from "@credtrail/core-domain";
import { immutableCredentialObjectKey } from "@credtrail/core-domain";
import { Hono } from "hono";
import { expect, it } from "vitest";
import {
  cleanupTestResources,
  createBadgeRuleIntegrationFixture,
  describeDbIntegration,
  seedAssertion,
} from "../../../../packages/db/src/postgres-test-support";
import type { AppEnv } from "../app/types";
import { registerPublicBadgeRoutes } from "../routes/public-badge-routes";
import { registerAppPageRenderer } from "../ui/render-page";
import { formatIsoTimestamp, linkedInAddToProfileUrl } from "../utils/display-format";
import { asNonEmptyString, asString } from "../utils/value-parsers";
import {
  badgeNameFromCredential,
  isWebUrl,
  issuerIdentifierFromCredential,
  issuerNameFromCredential,
  issuerUrlFromCredential,
  recipientFromCredential,
} from "./credential-display";
import {
  achievementDetailsFromCredential,
  evidenceDetailsFromCredential,
  githubAvatarUrlForUsername,
  githubUsernameFromUrl,
  imsOb3ValidatorUrl,
  recipientAvatarUrlFromAssertion,
  recipientDisplayNameFromAssertion,
  trustEdCredentialDetailsFromCredential,
} from "./public-badge-helpers";
import { loadPublicBadgeViewModel, publicBadgePathForAssertion } from "./public-badge-model";
import { createPublicBadgePageRenderers } from "./public-badge-pages";
import { publicBadgeSummaryPayload } from "./public-badge-summary-payload";

const metaContent = (head: string, attribute: string): string | null =>
  new RegExp(`<meta ${attribute} content="([^"]*)"`).exec(head)?.[1] ?? null;

const renderers = createPublicBadgePageRenderers({
  asString,
  achievementDetailsFromCredential,
  badgeNameFromCredential,
  evidenceDetailsFromCredential,
  formatIsoTimestamp,
  githubAvatarUrlForUsername,
  githubUsernameFromUrl,
  imsOb3ValidatorUrl,
  isWebUrl,
  issuerIdentifierFromCredential,
  issuerNameFromCredential,
  issuerUrlFromCredential,
  linkedInAddToProfileUrl,
  publicBadgePathForAssertion,
  recipientAvatarUrlFromAssertion,
  recipientDisplayNameFromAssertion,
  recipientFromCredential,
  trustEdCredentialDetailsFromCredential,
});

describeDbIntegration("issuer-branded credential previews", () => {
  it("renders crawler metadata from each tenant's stored credential on the public origin", async () => {
    const first = await createBadgeRuleIntegrationFixture();
    const second = await createBadgeRuleIntegrationFixture();
    const objects = new Map<string, string>();
    const store: ImmutableCredentialStore = {
      head: async (key) => (objects.has(key) ? { key } : null),
      get: async (key) => {
        const serialized = objects.get(key);
        return serialized === undefined
          ? null
          : { size: serialized.length, text: async () => serialized };
      },
      put: async () => {
        throw new Error("This credential fixture is read-only");
      },
      delete: async (key) => {
        objects.delete(key);
      },
    };
    const app = new Hono<AppEnv>();
    registerAppPageRenderer(app);
    registerPublicBadgeRoutes({
      app,
      resolveDatabase: () => first.db,
      loadPublicBadgeViewModel,
      ...renderers,
      publicBadgeSummaryPayload: (requestUrl, model) =>
        publicBadgeSummaryPayload({ requestUrl, model, formatIsoTimestamp }),
      asNonEmptyString,
      SAKAI_SHOWCASE_TENANT_ID: "unused-showcase",
      SAKAI_SHOWCASE_TEMPLATE_ID: "unused-template",
    });

    try {
      const cases: readonly {
        fixture: typeof first;
        issuer: JsonObject | string;
        badgeImage: string | JsonObject | null;
        expectedSiteName: string;
        expectedImage: string | null;
      }[] = [
        {
          fixture: first,
          issuer: { name: "First University", image: "/first-logo.png" },
          badgeImage: { id: "/badge-artwork.png" },
          expectedSiteName: "First University",
          expectedImage: "https://badges.example.edu/badge-artwork.png",
        },
        {
          fixture: second,
          issuer: { name: "Second Institute", image: { id: "https://cdn.example.edu/logo.png" } },
          badgeImage: null,
          expectedSiteName: "Second Institute",
          expectedImage: "https://cdn.example.edu/logo.png",
        },
        {
          fixture: first,
          issuer: "did:web:example.edu:raw-tenant-id",
          badgeImage: "javascript:alert(1)",
          expectedSiteName: "CredTrail",
          expectedImage: null,
        },
        {
          fixture: second,
          issuer: { name: 'Institute "A" <Research>', image: "http://127.0.0.1/logo.png" },
          badgeImage: "https://user:password@example.edu/image.png",
          expectedSiteName: "Institute &quot;A&quot; &lt;Research&gt;",
          expectedImage: null,
        },
      ];
      const identifiers: string[] = [];
      for (const entry of cases) {
        const publicId = crypto.randomUUID();
        const assertionId = await seedAssertion(entry.fixture.db, {
          tenantId: entry.fixture.tenantId,
          badgeTemplateId: entry.fixture.badgeTemplateId,
          recipientIdentity: "learner@example.edu",
          publicId,
          issuedAt: "2026-09-01T00:00:00.000Z",
        });
        identifiers.push(publicId);
        objects.set(
          immutableCredentialObjectKey({ tenantId: entry.fixture.tenantId, assertionId }),
          JSON.stringify({
            issuer: entry.issuer,
            credentialSubject: {
              achievement: {
                name: "Research Methods",
                description: "Completed the research course.",
                image: entry.badgeImage,
              },
            },
          }),
        );
      }
      // Revisit one tenant after the other to catch shared branding or cached HTML.
      for (const index of [0, 1, 2, 3, 0]) {
        const entry = cases[index];
        const publicId = identifiers[index];
        if (entry === undefined || publicId === undefined) throw new Error("Missing fixture");
        const response = await app.request(`http://localhost/badges/${publicId}`, undefined, {
          BADGE_OBJECTS: store,
          PUBLIC_APP_ORIGIN: "https://badges.example.edu",
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const body = await response.text();
        const head = body.slice(0, body.indexOf("</head>"));
        expect(head).toContain(`<title>Research Methods | ${entry.expectedSiteName}</title>`);
        expect(head).toContain(`property="og:site_name" content="${entry.expectedSiteName}"`);
        for (const attribute of ['property="og:title"', 'name="twitter:title"']) {
          expect(head).toContain(
            `${attribute} content="Research Methods | ${entry.expectedSiteName}"`,
          );
        }
        for (const attribute of ['property="og:description"', 'name="twitter:description"']) {
          const attribution =
            entry.expectedSiteName === "CredTrail"
              ? "on CredTrail"
              : `issued by ${entry.expectedSiteName}`;
          expect(head).toContain(
            `${attribute} content="Research Methods credential ${attribution}.`,
          );
        }
        expect(head).toContain("Completed the research course.");
        expect(head).toContain(
          `rel="canonical" href="https://badges.example.edu/badges/${publicId}"`,
        );
        expect(head).toContain(
          `property="og:url" content="https://badges.example.edu/badges/${publicId}"`,
        );
        expect(head).not.toContain("localhost");
        expect(head).not.toContain("raw-tenant-id");
        expect(head).not.toContain("password");
        expect(metaContent(head, 'property="og:image"')).toBe(entry.expectedImage);
        expect(metaContent(head, 'name="twitter:image"')).toBe(entry.expectedImage);
        expect(metaContent(head, 'name="twitter:card"')).toBe(
          entry.expectedImage === null ? "summary" : "summary_large_image",
        );
        expect(metaContent(head, 'property="og:image:alt"') !== null).toBe(
          entry.expectedImage !== null,
        );
        expect(metaContent(head, 'name="twitter:image:alt"') !== null).toBe(
          entry.expectedImage !== null,
        );
        for (const other of cases.filter(
          (candidate) => candidate.expectedSiteName !== entry.expectedSiteName,
        )) {
          expect(head).not.toContain(other.expectedSiteName);
        }
      }
    } finally {
      await cleanupTestResources(first.db, {
        tenantIds: [first.tenantId, second.tenantId],
        userIds: [first.userId, second.userId],
      });
    }
  });
});
