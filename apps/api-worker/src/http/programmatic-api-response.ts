import type { ProgrammaticErrorCode } from "@credtrail/validation";
import { z } from "zod";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppContext } from "../app/types";

/** Stable error codes and safe messages at the programmatic HTTP boundary. */
export const programmaticApiError = (
  c: AppContext,
  status: ContentfulStatusCode,
  code: ProgrammaticErrorCode,
  error: string,
): Response => c.json({ code, error }, status);

/** Parses unknown protocol input and projects validation errors without submitted values. */
export const parseProgrammaticInput = <Value>(
  c: AppContext,
  schema: z.ZodType<Value>,
  input: unknown,
): { readonly value: Value } | { readonly response: Response } => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      response: c.json(
        {
          code: "invalid_request",
          error: "Invalid request payload",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.map(String),
            message: issue.message,
          })),
        },
        400,
      ),
    };
  }
  return { value: parsed.data };
};
