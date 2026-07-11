import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchMe,
  login as apiLogin,
  verifyMfa as apiVerifyMfa,
  refreshSession,
  setToken,
  getToken,
  type MeResponse,
  type PermissionsView,
  type PublicUser,
} from "../lib/api";

// --- Session persistence + idle logout --------------------------------------
// The access token lives in localStorage (survives reloads and browser
// restarts), so a login persists. A session ends after 4h of NO activity: the
// client watchdog below signs out and, as a server backstop, the token is
// re-issued on activity (sliding refresh) so it lapses ~4h after last activity.
const IDLE_LIMIT_MS = 4 * 60 * 60 * 1000; // 4 hours
const REFRESH_EVERY_MS = 20 * 60 * 1000; // re-issue the token at most this often
const CHECK_EVERY_MS = 60 * 1000; // idle-watchdog tick
const STORE_EVERY_MS = 30 * 1000; // throttle localStorage writes
const ACTIVITY_KEY = "mcrc.lastActivityAt";
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];

function readLastActivity(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(ACTIVITY_KEY);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}
function writeLastActivity(ts: number): void {
  if (typeof window !== "undefined") window.localStorage.setItem(ACTIVITY_KEY, String(ts));
}
function clearActivity(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(ACTIVITY_KEY);
}
function nowMs(): number {
  return new Date().getTime();
}

interface AuthState {
  user: PublicUser | null;
  permissions: PermissionsView | null;
  loading: boolean;
  /** Returns true if fully signed in, false if an MFA step is required. */
  signIn: (email: string, password: string) => Promise<{ mfaToken?: string }>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  signOut: () => void;
  /** Re-fetch the signed-in user (e.g. after a profile name/photo change). */
  refreshUser: () => Promise<void>;
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
    // Already idle past the limit when the app (re)opens → don't resume; the
    // token may still be valid but the inactivity window has closed.
    const last = readLastActivity();
    if (last && nowMs() - last > IDLE_LIMIT_MS) {
      setToken(null);
      clearActivity();
      setMe(null);
      setLoading(false);
      return;
    }
    try {
      setMe(await fetchMe());
      writeLastActivity(nowMs());
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
    writeLastActivity(nowMs());
    setMe(await fetchMe());
    return {};
  }, []);

  const completeMfa = useCallback(async (mfaToken: string, code: string) => {
    const res = await apiVerifyMfa(mfaToken, code);
    setToken(res.accessToken);
    writeLastActivity(nowMs());
    setMe(await fetchMe());
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    clearActivity();
    setMe(null);
  }, []);

  // Idle watchdog + sliding token refresh — runs only while signed in.
  const authed = me !== null;
  const lastRefreshRef = useRef(0);
  const lastStoreRef = useRef(0);
  useEffect(() => {
    if (!authed) return;
    lastRefreshRef.current = nowMs(); // token is fresh from login/load
    let activity = readLastActivity() || nowMs();

    const onActivity = () => {
      const t = nowMs();
      activity = t;
      if (t - lastStoreRef.current > STORE_EVERY_MS) {
        lastStoreRef.current = t;
        writeLastActivity(t);
      }
      // Slide the server session forward so an active token never expires.
      if (t - lastRefreshRef.current > REFRESH_EVERY_MS) {
        lastRefreshRef.current = t;
        refreshSession()
          .then((r) => setToken(r.accessToken))
          .catch(() => {
            /* transient — the watchdog / next activity will retry or expire */
          });
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") onActivity();
    };
    // Activity in another tab counts here too.
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_KEY && e.newValue) activity = Number(e.newValue) || activity;
    };

    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true }),
    );
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("storage", onStorage);

    const tick = window.setInterval(() => {
      if (nowMs() - activity > IDLE_LIMIT_MS) signOut();
    }, CHECK_EVERY_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("storage", onStorage);
      window.clearInterval(tick);
    };
  }, [authed, signOut]);

  const refreshUser = useCallback(async () => {
    if (!getToken()) return;
    try {
      setMe(await fetchMe());
    } catch {
      // Keep the current session on a transient refresh failure.
    }
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
      refreshUser,
      hasPermission,
    }),
    [me, loading, signIn, completeMfa, signOut, refreshUser, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
