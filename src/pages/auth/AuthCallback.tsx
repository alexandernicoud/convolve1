import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthShell } from "@/components/auth/AuthShell";
import { useAuth } from "@/context/AuthContext";
import { parseOAuthCallbackError, safeAppPath } from "@/lib/authRedirect";

export default function AuthCallback() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = useMemo(() => safeAppPath(params.get("next")), [params]);
  const confirmed = params.get("confirmed") === "1";
  const urlError = parseOAuthCallbackError(
    typeof window === "undefined" ? "" : window.location.search,
    typeof window === "undefined" ? "" : window.location.hash,
  );

  useEffect(() => {
    if (loading) return;
    if (session) {
      navigate(next, { replace: true });
      return;
    }
    const to = `/login?next=${encodeURIComponent(next)}`;
    if (confirmed && !urlError) {
      navigate(`${to}&notice=confirmed`, { replace: true });
      return;
    }
    const message = urlError || "Google sign-in did not complete. Please try again.";
    navigate(`${to}&error=${encodeURIComponent(message)}`, { replace: true });
  }, [loading, session, next, urlError, confirmed, navigate]);

  return (
    <AuthShell title="Signing in" subtitle={confirmed ? "Confirming your email…" : "Finishing Google authentication…"}>
      <p className="text-center text-sm text-white/50">Please wait a moment.</p>
    </AuthShell>
  );
}
