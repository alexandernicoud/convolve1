import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { canonicalDevOrigin, oauthRedirectTo, safeAppPath } from "@/lib/authRedirect";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  emailConfirmed: boolean;
  signUp: (
    email: string,
    password: string,
    metadata?: Record<string, unknown>,
    nextPath?: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: (redirectPath?: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  /** Re-checks the password and starts a fresh session (used before sensitive changes). */
  verifyPassword: (password: string) => Promise<void>;
  changeEmail: (email: string) => Promise<void>;
  updateMetadata: (data: Record<string, unknown>) => Promise<void>;
  signOutEverywhere: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function originUrl(path: string) {
  return `${window.location.origin}${path}`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    if (import.meta.env.DEV) {
      // PKCE verifiers live in per-origin storage and the allow-list names localhost, so every
      // auth flow must start and end on the localhost origin.
      const canonical = canonicalDevOrigin(window.location.origin);
      if (canonical !== window.location.origin) {
        window.location.replace(`${canonical}${window.location.pathname}${window.location.search}${window.location.hash}`);
        return;
      }
    }
    const supabase = getSupabaseClient();
    let cancelled = false;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      setSession(error ? null : data.session ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, metadata?: Record<string, unknown>, nextPath?: string) => {
    const supabase = getSupabaseClient();
    const next = nextPath ? safeAppPath(nextPath) : null;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: originUrl(next ? `/login?next=${encodeURIComponent(next)}` : "/login"), data: metadata },
    });
    if (error) throw error;
    return { needsEmailConfirmation: !data.session };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signInWithGoogle = useCallback(async (redirectPath = "/dashboard") => {
    const path = redirectPath.startsWith("/") ? redirectPath : "/dashboard";
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: oauthRedirectTo(window.location.origin, path, import.meta.env.DEV),
      },
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw error;
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
      redirectTo: originUrl("/reset-password"),
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw error;
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await getSupabaseClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: originUrl("/login") },
    });
    if (error) throw error;
  }, []);

  const verifyPassword = useCallback(async (password: string) => {
    const email = session?.user?.email;
    if (!email) throw new Error("No email address on this account");
    const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) throw new Error("Password is incorrect");
  }, [session]);

  const changeEmail = useCallback(async (email: string) => {
    const { error } = await getSupabaseClient().auth.updateUser(
      { email },
      { emailRedirectTo: originUrl("/account") },
    );
    if (error) throw error;
  }, []);

  const updateMetadata = useCallback(async (data: Record<string, unknown>) => {
    const { error } = await getSupabaseClient().auth.updateUser({ data });
    if (error) throw error;
  }, []);

  const signOutEverywhere = useCallback(async () => {
    const { error } = await getSupabaseClient().auth.signOut({ scope: "global" });
    if (error) throw error;
  }, []);

  const user = session?.user ?? null;
  const emailConfirmed = Boolean(user?.email_confirmed_at);

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      configured: isSupabaseConfigured,
      emailConfirmed,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendConfirmation,
      verifyPassword,
      changeEmail,
      updateMetadata,
      signOutEverywhere,
    }),
    [
      session,
      user,
      loading,
      emailConfirmed,
      signUp,
      signIn,
      signInWithGoogle,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendConfirmation,
      verifyPassword,
      changeEmail,
      updateMetadata,
      signOutEverywhere,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
