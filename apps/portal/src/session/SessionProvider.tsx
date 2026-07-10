/**
 * Mock session context for the MCRC portal shell.
 *
 * Holds the demo session: which audience is active (firm vs client portal), the
 * current firm/portal role (switchable for RBAC demos), the active client in firm
 * mode, and the shell theme variant (A light / B navy). The active client + regime
 * are derived from the mock API so the whole Client Workspace re-contextualizes when
 * the client switcher changes.
 *
 * This is deliberately UI-only state — the real app will hydrate it from an auth
 * session. Screens depend on `useSession()`, never on this implementation.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { api, FIRM_USERS, PORTAL_USERS } from "@/mock";
import type { Client, FirmRole, PortalRole, Regime } from "@/mock";

/** Which audience the shell is rendering. */
export type SessionMode = "firm" | "portal";

/** Shell theme variant — A (light/cream) is the product default; B is navy. */
export type ShellVariant = "A" | "B";

/** The signed-in identity shown in the sidebar + avatar menu. */
export interface SessionUser {
  name: string;
  email: string;
  /** The active role label (firm or portal, depending on `mode`). */
  role: FirmRole | PortalRole;
}

export interface SessionContextValue {
  mode: SessionMode;
  user: SessionUser;
  firmRole: FirmRole;
  portalRole: PortalRole;
  activeClientId: string;
  /** Resolved from `api.getClient(activeClientId)`; undefined while loading. */
  activeClient: Client | undefined;
  /** Convenience: the active client's tax regime (drives conditional UI). */
  regime: Regime | undefined;
  shellVariant: ShellVariant;
  setMode: (mode: SessionMode) => void;
  setFirmRole: (role: FirmRole) => void;
  setPortalRole: (role: PortalRole) => void;
  setActiveClient: (clientId: string) => void;
  setShellVariant: (variant: ShellVariant) => void;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

const DEFAULT_ACTIVE_CLIENT = "c1";

/** Fallback identity used before a real auth session exists. */
const FALLBACK_FIRM_USER: SessionUser = {
  name: "Marielle Reyes-Cruz",
  email: "m.reyescruz@mcrc.ph",
  role: "Super Admin",
};

/** Pick the seeded firm user matching the demo role (keeps the name/email plausible). */
function firmUserForRole(role: FirmRole): SessionUser {
  const match = FIRM_USERS.find((u) => u.role === role);
  if (!match) return { ...FALLBACK_FIRM_USER, role };
  return { name: match.name, email: match.email, role: match.role };
}

/** Pick a plausible portal user for the active client + role, else synthesize one. */
function portalUserForRole(clientId: string, role: PortalRole): SessionUser {
  const match = PORTAL_USERS.find((u) => u.clientId === clientId && u.role === role);
  if (match) return { name: match.name, email: match.email, role: match.role };
  return { name: "Portal User", email: "user@client.ph", role };
}

export interface SessionProviderProps {
  children: React.ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps): React.JSX.Element {
  const [mode, setMode] = React.useState<SessionMode>("firm");
  const [firmRole, setFirmRole] = React.useState<FirmRole>("Super Admin");
  const [portalRole, setPortalRole] = React.useState<PortalRole>("Owner");
  const [activeClientId, setActiveClientId] = React.useState<string>(DEFAULT_ACTIVE_CLIENT);
  const [shellVariant, setShellVariant] = React.useState<ShellVariant>("A");

  const { data: activeClient } = useQuery({
    queryKey: ["client", activeClientId],
    queryFn: () => api.getClient(activeClientId),
  });

  const setActiveClient = React.useCallback((clientId: string) => {
    setActiveClientId(clientId);
  }, []);

  const user = React.useMemo<SessionUser>(
    () =>
      mode === "firm"
        ? firmUserForRole(firmRole)
        : portalUserForRole(activeClientId, portalRole),
    [mode, firmRole, portalRole, activeClientId],
  );

  const value = React.useMemo<SessionContextValue>(
    () => ({
      mode,
      user,
      firmRole,
      portalRole,
      activeClientId,
      activeClient,
      regime: activeClient?.regime,
      shellVariant,
      setMode,
      setFirmRole,
      setPortalRole,
      setActiveClient,
      setShellVariant,
    }),
    [
      mode,
      user,
      firmRole,
      portalRole,
      activeClientId,
      activeClient,
      shellVariant,
      setActiveClient,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Read the current session. Throws if used outside a `<SessionProvider>`. */
export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a <SessionProvider>");
  }
  return ctx;
}
