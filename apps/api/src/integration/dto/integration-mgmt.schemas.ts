import { OAUTH_SCOPES } from "@portal/shared";
import { z } from "zod";

/**
 * Firm-facing integration-client management (Phase 6/7). Distinct from the frozen
 * Portal⇄Generator contract in @portal/shared: this is Portal-internal admin input
 * (a human name + the OAuth scopes to grant), so its validation lives here. Each
 * requested scope must be a member of the frozen `OAUTH_SCOPES` list.
 */
export const CreateIntegrationSchema = z.object({
  name: z.string().min(1),
  scopes: z.array(z.enum(OAUTH_SCOPES)).default([]),
});
export type CreateIntegrationInput = z.infer<typeof CreateIntegrationSchema>;
