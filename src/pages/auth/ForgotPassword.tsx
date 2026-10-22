import { useState } from "react";
import { Link } from "react-router-dom";
import { AuthField, AuthShell, AuthSubmit } from "@/components/auth/AuthShell";
import { useAuth } from "@/context/AuthContext";

export default function ForgotPassword() {
  const { requestPasswordReset, configured } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send reset email");
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <AuthShell title="Reset password" subtitle="Supabase is not configured.">
        <p className="text-center text-sm text-white/50">Ask the project owner to configure Auth.</p>
      </AuthShell>
    );
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="If that address exists, a reset link is on the way.">
        <p className="text-center text-sm text-white/45">
          <Link to="/login" className="text-white underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password" subtitle="We’ll email a link to choose a new password.">
      <form onSubmit={(e) => void onSubmit(e)}>
        <AuthField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        {error ? <p className="mb-3 text-center text-sm text-red-300">{error}</p> : null}
        <AuthSubmit busy={busy}>{busy ? "Sending…" : "Send reset link"}</AuthSubmit>
      </form>
      <p className="mt-4 text-center text-sm text-white/45">
        <Link to="/login" className="text-white underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
