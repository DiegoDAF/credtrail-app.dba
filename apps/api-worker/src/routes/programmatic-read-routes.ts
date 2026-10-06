import {
  findProgrammaticAssertion,
  findProgrammaticOperation,
  findProgrammaticTemplate,
  listProgrammaticAssertions,
  listProgrammaticTemplates,
  type ProgrammaticAssertionRecord,
  type ProgrammaticTemplateRecord,
} from "@credtrail/db";
import {
  resolveManagedBadgeTemplateImageReference,
  programmaticAssertionParamsSchema,
  programmaticAssertionQuerySchema,
  programmaticOperationParamsSchema,
  programmaticOperationSchema,
  programmaticTemplateParamsSchema,
  programmaticTemplateQuerySchema,
  programmaticTenantQuerySchema,
  type ProgrammaticApiScope,
} from "@credtrail/validation";
import type { Hono } from "hono";
import type { z } from "zod";
import type { AppContext, AppEnv } from "../app/types";
import type { ResolveDatabase } from "../app/route-deps";
import {
  authorizeProgrammaticRequest,
  type ProgrammaticAuthorizationStore,
} from "../auth/programmatic-api-key";
import { canonicalAppUrl } from "../http/canonical-app-url";
import { parseProgrammaticInput, programmaticApiError } from "../http/programmatic-api-response";
import { programmaticBadgeLinks } from "./programmatic-api-links";
import { programmaticApiDescription } from "../programmatic-api/service-description";

interface RegisterProgrammaticReadRoutesInput {
  readonly app: Hono<AppEnv>;
  readonly resolveDatabase: ResolveDatabase;
  readonly resolveQueueIngressStore: (
    bindings: AppEnv["Bindings"],
  ) => ProgrammaticAuthorizationStore;
  readonly sha256Hex: (value: string) => Promise<string>;
}

const assertionResponse = (origin: string, row: ProgrammaticAssertionRecord) => ({
  assertionId: row.assertionId,
  badgeTemplateId: row.badgeTemplateId,
  recipientIdentity: row.recipientIdentity,
  recipientIdentityType: row.recipientIdentityType,
  issuedAt: row.issuedAt,
  validUntil: row.validUntil,
  state: row.state,
  ...programmaticBadgeLinks(origin, row.publicId),
});

const templateResponse = (
  publicOrigin: string,
  tenantId: string,
  row: ProgrammaticTemplateRecord,
) => {
  const image =
    row.imageUrl === null
      ? null
      : resolveManagedBadgeTemplateImageReference({
          tenantId,
          badgeTemplateId: row.badgeTemplateId,
          imageUri: row.imageUrl,
        });
  return {
    badgeTemplateId: row.badgeTemplateId,
    title: row.title,
    description: row.description,
    criteriaUrl: row.criteriaUrl,
    archived: row.archived,
    imageUrl: image === null ? null : canonicalAppUrl(publicOrigin, image.path),
  };
};

/** Institution-scoped integration reads share exactly the write routes' key authentication. */
export const registerProgrammaticReadRoutes = (
  input: RegisterProgrammaticReadRoutesInput,
): void => {
  const readQuery = async <Value extends { tenantId: string }>(
    c: AppContext,
    schema: z.ZodType<Value>,
    scope: ProgrammaticApiScope,
  ): Promise<{ readonly value: Value } | { readonly response: Response }> => {
    c.header("Cache-Control", "no-store");
    const parsed = parseProgrammaticInput(c, schema, c.req.query());
    if ("response" in parsed) return parsed;
    const auth = await authorizeProgrammaticRequest(
      c,
      input.resolveQueueIngressStore(c.env),
      {
        tenantId: parsed.value.tenantId,
        requiredScope: scope,
      },
      input.sha256Hex,
    );
    return "response" in auth ? auth : parsed;
  };

  input.app.get("/v1/programmatic/openapi.json", (c) =>
    c.json(programmaticApiDescription(c.env.PUBLIC_APP_ORIGIN)),
  );

  input.app.get("/v1/programmatic/operations/:operationId", async (c) => {
    const query = await readQuery(c, programmaticTenantQuerySchema, "operations.read");
    if ("response" in query) return query.response;
    const params = parseProgrammaticInput(c, programmaticOperationParamsSchema, c.req.param());
    if ("response" in params) return params.response;
    const db = input.resolveDatabase(c.env);
    const operation = await findProgrammaticOperation(
      db,
      query.value.tenantId,
      params.value.operationId,
    );
    if (operation === null)
      return programmaticApiError(c, 404, "operation_not_found", "Operation not found");
    switch (operation.status) {
      case "pending":
      case "processing":
        c.header("Retry-After", "5");
        return c.json(programmaticOperationSchema.parse(operation));
      case "completed":
        return c.json(
          programmaticOperationSchema.parse({
            ...operation,
            result: programmaticBadgeLinks(c.env.PUBLIC_APP_ORIGIN, operation.publicId),
          }),
        );
      case "failed":
        return c.json(
          programmaticOperationSchema.parse({
            ...operation,
            failure: {
              code: "operation_failed",
              message:
                "Operation failed after retries. Check worker diagnostics with this operation ID before deciding whether to submit a new request.",
            },
          }),
        );
    }
  });

  input.app.get("/v1/programmatic/templates", async (c) => {
    const query = await readQuery(c, programmaticTemplateQuerySchema, "templates.read");
    if ("response" in query) return query.response;
    const rows = await listProgrammaticTemplates(input.resolveDatabase(c.env), query.value);
    const templates = rows
      .slice(0, query.value.limit)
      .map((row) => templateResponse(c.env.PUBLIC_APP_ORIGIN, query.value.tenantId, row));
    return c.json({
      tenantId: query.value.tenantId,
      templates,
      nextCursor:
        rows.length > query.value.limit ? (templates.at(-1)?.badgeTemplateId ?? null) : null,
    });
  });

  input.app.get("/v1/programmatic/templates/:badgeTemplateId", async (c) => {
    const query = await readQuery(c, programmaticTenantQuerySchema, "templates.read");
    if ("response" in query) return query.response;
    const params = parseProgrammaticInput(c, programmaticTemplateParamsSchema, c.req.param());
    if ("response" in params) return params.response;
    const template = await findProgrammaticTemplate(
      input.resolveDatabase(c.env),
      query.value.tenantId,
      params.value.badgeTemplateId,
    );
    return template === null
      ? programmaticApiError(c, 404, "template_not_found", "Badge template not found")
      : c.json(templateResponse(c.env.PUBLIC_APP_ORIGIN, query.value.tenantId, template));
  });

  input.app.get("/v1/programmatic/assertions", async (c) => {
    const query = await readQuery(c, programmaticAssertionQuerySchema, "assertions.read");
    if ("response" in query) return query.response;
    const rows = await listProgrammaticAssertions(input.resolveDatabase(c.env), query.value);
    const assertions = rows
      .slice(0, query.value.limit)
      .map((row) => assertionResponse(c.env.PUBLIC_APP_ORIGIN, row));
    return c.json({
      tenantId: query.value.tenantId,
      assertions,
      nextCursor: rows.length > query.value.limit ? (assertions.at(-1)?.assertionId ?? null) : null,
    });
  });

  input.app.get("/v1/programmatic/assertions/:assertionId", async (c) => {
    const query = await readQuery(c, programmaticTenantQuerySchema, "assertions.read");
    if ("response" in query) return query.response;
    const params = parseProgrammaticInput(c, programmaticAssertionParamsSchema, c.req.param());
    if ("response" in params) return params.response;
    const row = await findProgrammaticAssertion(
      input.resolveDatabase(c.env),
      query.value.tenantId,
      params.value.assertionId,
    );
    return row === null
      ? programmaticApiError(c, 404, "assertion_not_found", "Issued badge not found")
      : c.json(assertionResponse(c.env.PUBLIC_APP_ORIGIN, row));
  });
};
