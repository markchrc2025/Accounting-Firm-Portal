// sessions.schemas.ts — PA3 (D67): request shapes of the work-session routes.
import { z } from "zod";

export const SUMMARY_REQUIRED = "A short summary of what was done is required.";

/** POST /projects/:key/sessions */
export const StartSessionSchema = z.object({
  title: z.string().trim().max(200).optional(),
});
export type StartSessionInput = z.infer<typeof StartSessionSchema>;

/** POST /projects/sessions/start: the repo kit's hook sends the key in snake_case. */
export const StartSessionByKeySchema = z.object({
  project_key: z.string().min(1),
  title: z.string().trim().max(200).optional(),
});

/** POST /projects/sessions/:id/end */
export const EndSessionSchema = z.object({
  summary: z.string().trim().min(1, SUMMARY_REQUIRED).max(5000),
  nextSteps: z.string().trim().max(5000).optional(),
});
export type EndSessionInput = z.infer<typeof EndSessionSchema>;
