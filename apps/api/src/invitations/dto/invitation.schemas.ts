import { z } from "zod";

/** Client-portal roles offered at invite time. */
export const ClientRole = z.enum(["OWNER", "MANAGER", "VIEWER"]);
export type ClientRole = z.infer<typeof ClientRole>;

/** Maps a portal client role to the seeded CLIENT-scope Role name. */
export const CLIENT_ROLE_NAME: Record<ClientRole, string> = {
  OWNER: "Client Owner",
  MANAGER: "Client Manager",
  VIEWER: "Client Viewer",
};

export const CreateInvitationSchema = z.object({
  email: z.string().email(),
  clientRole: ClientRole,
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;

export const AcceptInvitationSchema = z.object({
  token: z.string().min(1),
  fullName: z.string().min(1),
  password: z.string().min(8),
});
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationSchema>;
