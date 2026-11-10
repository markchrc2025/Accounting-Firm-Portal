import { SetMetadata } from "@nestjs/common";

export const ACCEPTS_API_TOKEN_KEY = "acceptsApiToken";

/**
 * PA3 (D67): marks a controller (or route) that also accepts a personal API token
 * (`Authorization: Bearer ppt_...`). Every other route answers a token with 403. A token never
 * reaches the token routes, so a token cannot make or revoke tokens.
 */
export const AcceptsApiToken = () => SetMetadata(ACCEPTS_API_TOKEN_KEY, true);
