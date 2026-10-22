import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { parseOAuthCallbackError, urlHasAuthCallbackParams } from "@/lib/authRedirect";

export function isProtectedAppPath(pathname: string): boolean {
  if (pathname.startsWith("/tools/")) return true;
  if (pathname.startsWith("/products/labeling-optimizer/")) return true;
  if (pathname.startsWith("/products/trainer/")) return true;
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return true;
  if (pathname === "/account" || pathname === "/credits") return true;
  return false;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, configured } = useAuth();
  const location = useLocation();

  if (loading || (urlHasAuthCallbackParams(location.search, location.hash) && !session)) {
    if (
      !loading &&
      !session &&
      urlHasAuthCallbackParams(location.search, location.hash)
    ) {
      const message =
        parseOAuthCallbackError(location.search, location.hash) ||
        "Google sign-in did not complete. Please try again.";
      const next = encodeURIComponent(`${location.pathname}`);
      return (
        <Navigate
          to={`/login?next=${next}&error=${encodeURIComponent(message)}`}
          replace
        />
      );
    }
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-black text-sm text-white/50">
        Loading…
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center text-sm leading-relaxed text-white/70">
        Authentication is not configured. Set <code className="text-white">VITE_SUPABASE_URL</code> and{" "}
        <code className="text-white">VITE_SUPABASE_ANON_KEY</code> in the frontend environment.
      </div>
    );
  }

  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return <>{children}</>;
}
