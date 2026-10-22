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
    const message = urlError || "Google sign-in did not complete. Please try again.";
    navigate(`/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(message)}`, {
      replace: true,
    });
  }, [loading, session, next, urlError, navigate]);

  return (
    <AuthShell title="Signing in" subtitle="Finishing Google authentication…">
      <p className="text-center text-sm text-white/50">Please wait a moment.</p>
    </AuthShell>
  );
}
