import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { programmaticApiDescription } from "./service-description";
import { programmaticTemplateQuerySchema } from "@credtrail/validation";

describe("published institution integration contract", () => {
  it("keeps the downloadable snapshot synchronized with the runtime description", () => {
    const snapshot: unknown = JSON.parse(
      readFileSync(
        new URL("../../../../docs/openapi/programmatic.openapi.json", import.meta.url),
        "utf8",
      ),
    );
    expect(snapshot).toEqual(programmaticApiDescription("https://credtrail.org"));
  });
  it("describes all integration operations, explicit key permissions and bounded list input", () => {
    const description = z
      .object({
        servers: z.array(z.object({ url: z.string() })),
        paths: z.record(
          z.string(),
          z.record(
            z.string(),
            z.object({
              operationId: z.string(),
              "x-required-scope": z.string(),
              responses: z.record(z.string(), z.unknown()),
            }),
          ),
        ),
      })
      .parse(programmaticApiDescription("https://badges.example.edu"));
    expect(description.servers).toEqual([{ url: "https://badges.example.edu" }]);
    const operations = Object.values(description.paths).flatMap((path) => Object.values(path));
    expect(operations.map((operation) => operation.operationId).sort()).toEqual([
      "getAssertion",
      "getOperation",
      "getTemplate",
      "issueBadge",
      "listAssertions",
      "listTemplates",
      "revokeBadge",
    ]);
    expect(
      operations.every(
        (operation) =>
          operation.responses["401"] !== undefined && operation.responses["403"] !== undefined,
      ),
    ).toBe(true);
    expect(programmaticTemplateQuerySchema.parse({ tenantId: "tenant_one" })).toMatchObject({
      limit: 50,
      includeArchived: false,
    });
    for (const limit of ["0", "101", "1.5", "1\n", "0x10"]) {
      expect(
        programmaticTemplateQuerySchema.safeParse({ tenantId: "tenant_one", limit }).success,
      ).toBe(false);
    }
  });
});
