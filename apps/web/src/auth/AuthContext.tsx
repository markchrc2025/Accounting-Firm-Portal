import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchMe,
  login as apiLogin,
  verifyMfa as apiVerifyMfa,
  setToken,
  getToken,
  type MeResponse,
  type PermissionsView,
  type PublicUser,
} from "../lib/api";

interface AuthState {
  user: PublicUser | null;
  permissions: PermissionsView | null;
  loading: boolean;
  /** Returns true if fully signed in, false if an MFA step is required. */
  signIn: (email: string, password: string) => Promise<{ mfaToken?: string }>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  signOut: () => void;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await fetchMe());
    } catch {
      setToken(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password);
    if (res.status === "mfa_required") return { mfaToken: res.mfaToken };
    setToken(res.accessToken);
    setMe(await fetchMe());
    return {};
  }, []);

  const completeMfa = useCallback(async (mfaToken: string, code: string) => {
    const res = await apiVerifyMfa(mfaToken, code);
    setToken(res.accessToken);
    setMe(await fetchMe());
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setMe(null);
  }, []);

  const hasPermission = useCallback(
    (permission: string) =>
      (me?.permissions.global.includes(permission) ?? false) ||
      (me?.permissions.clients.some((c) => c.permissions.includes(permission)) ?? false),
    [me],
  );

  const value = useMemo<AuthState>(
    () => ({
      user: me?.user ?? null,
      permissions: me?.permissions ?? null,
      loading,
      signIn,
      completeMfa,
      signOut,
      hasPermission,
    }),
    [me, loading, signIn, completeMfa, signOut, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
