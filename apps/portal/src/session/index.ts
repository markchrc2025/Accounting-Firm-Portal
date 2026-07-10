/** Barrel for the mock session + RBAC layer. */
export {
  SessionProvider,
  useSession,
  type SessionContextValue,
  type SessionMode,
  type SessionUser,
  type ShellVariant,
} from "./SessionProvider";
export {
  can,
  isNavVisible,
  CAPABILITY_MATRIX,
  CAPABILITY_ROWS,
  NAV_VISIBILITY,
  FIRM_ROLES,
  PORTAL_ROLES,
  type Capability,
  type NavId,
  type NavVisibilityContext,
} from "./rbac";
