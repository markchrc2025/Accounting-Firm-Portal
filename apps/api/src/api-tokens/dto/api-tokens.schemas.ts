// api-tokens.schemas.ts — PA3 (D67): request shapes of the token routes.
import { z } from "zod";

export const TOKEN_SCOPES = ["read", "read_write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const TOKEN_NAME_MESSAGE =
  "Give the token a name, for example 'Claude Code laptop'.";

export const CreateTokenSchema = z.object({
  name: z.string().trim().min(1, TOKEN_NAME_MESSAGE).max(100),
  scope: z.enum(TOKEN_SCOPES),
});
export type CreateTokenInput = z.infer<typeof CreateTokenSchema>;
