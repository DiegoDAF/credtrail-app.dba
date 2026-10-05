import { z } from "zod";

const actionSchema = z.object({
  label: z.string().trim().min(1),
  url: z.url({ protocol: /^https?$/u }),
});

export const transactionalEmailContentSchema = z.object({
  institution: z.string().trim().min(1),
  title: z.string().trim().min(1),
  paragraphs: z.array(z.string()).min(1),
  details: z.array(z.object({ label: z.string(), value: z.string() })),
  action: actionSchema,
  secondaryActions: z.array(actionSchema),
  footer: z.string().trim().min(1),
});

export type TransactionalEmailContent = z.infer<typeof transactionalEmailContentSchema>;
