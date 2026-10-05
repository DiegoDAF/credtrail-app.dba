import { z } from "zod";

/** Canonical positive decimal ID; kept as text to preserve all digits. */
export const linkedinOrganizationIdSchema = z
  .string()
  // (?![\s\S]) requires absolute end-of-string; $ permits a trailing newline.
  .regex(/^[1-9][0-9]{0,19}(?![\s\S])/)
  .brand<"LinkedInOrganizationId">();
export type LinkedInOrganizationId = z.infer<typeof linkedinOrganizationIdSchema>;

/** An explicit blank clears the setting; omission never clears it. */
export const updateTenantLinkedInSettingsRequestSchema = z.strictObject({
  organizationId: z
    .string()
    .trim()
    .pipe(z.union([z.literal("").transform(() => null), linkedinOrganizationIdSchema])),
});
