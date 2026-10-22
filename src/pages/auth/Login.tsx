import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthDivider, AuthField, AuthGoogleButton, AuthShell, AuthSubmit } from "@/components/auth/AuthShell";
import { useAuth } from "@/context/AuthContext";
import { parseOAuthCallbackError, safeAppPath } from "@/lib/authRedirect";

export default function Login() {
  const { signIn, signInWithGoogle, configured, session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = useMemo(() => safeAppPath(params.get("next")), [params]);
  const oauthError = useMemo(
    () => params.get("error") || parseOAuthCallbackError(params.toString()),
    [params],
  );

  useEffect(() => {
    if (!loading && session) navigate(next, { replace: true });
  }, [loading, session, next, navigate]);

  useEffect(() => {
    if (oauthError) setError(oauthError);
  }, [oauthError]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign in failed");
      setBusy(false);
    }
  };

  if (loading || session) {
    return (
      <AuthShell title="Sign in" subtitle="Opening your workspace…">
        <p className="text-center text-sm text-white/50">Please wait a moment.</p>
      </AuthShell>
    );
  }

  if (!configured) {
    return (
      <AuthShell title="Sign in" subtitle="Supabase environment variables are missing.">
        <p className="text-center text-sm text-white/50">Ask the project owner to configure Auth.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in" subtitle="Use your Convolve account to open the workspace.">
      <AuthGoogleButton busy={busy} onClick={() => void onGoogle()} />
      {error ? <p className="mt-3 text-center text-sm text-red-300">{error}</p> : null}
      <AuthDivider />
      <form onSubmit={(e) => void onSubmit(e)}>
        <AuthField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <AuthSubmit busy={busy}>{busy ? "Signing in…" : "Sign in"}</AuthSubmit>
      </form>
      <p className="mt-4 text-center text-sm text-white/45">
        <Link to="/forgot-password" className="text-white/75 underline-offset-2 hover:underline">
          Forgot password
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-white/45">
        No account?{" "}
        <Link to="/signup" className="text-white underline-offset-2 hover:underline">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}
