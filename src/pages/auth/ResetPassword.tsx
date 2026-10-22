import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthField, AuthShell, AuthSubmit } from "@/components/auth/AuthShell";
import { useAuth } from "@/context/AuthContext";

export default function ResetPassword() {
  const { session, loading, updatePassword, configured } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await updatePassword(password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <AuthShell title="New password" subtitle="Supabase is not configured.">
        <p className="text-center text-sm text-white/50">Ask the project owner to configure Auth.</p>
      </AuthShell>
    );
  }

  if (loading) {
    return (
      <AuthShell title="New password">
        <p className="text-center text-sm text-white/50">Loading session…</p>
      </AuthShell>
    );
  }

  if (!session) {
    return (
      <AuthShell title="Link expired" subtitle="Open the reset link from your email again, or request a new one.">
        <p className="text-center text-sm text-white/45">
          <Link to="/forgot-password" className="text-white underline-offset-2 hover:underline">
            Request a new link
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={(e) => void onSubmit(e)}>
        <AuthField
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        {error ? <p className="mb-3 text-center text-sm text-red-300">{error}</p> : null}
        <AuthSubmit busy={busy}>{busy ? "Saving…" : "Update password"}</AuthSubmit>
      </form>
    </AuthShell>
  );
}
