import { z } from "zod";

/**
 * OAuth2 client-credentials token request (RFC 6749 §4.4). We accept the
 * credentials in the JSON body since the BIR Generator's `portal-sync` Edge
 * Function is the only (server-side) caller. `scope` is an optional space-
 * separated narrowing of the client's granted scopes.
 */
export const OAuthTokenRequestSchema = z.object({
  grant_type: z.literal("client_credentials"),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  scope: z.string().optional(),
});
export type OAuthTokenRequest = z.infer<typeof OAuthTokenRequestSchema>;

export interface OAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}
