import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { fetchApi } from "@/lib/api";
import {
  acceptanceRecord,
  PRIVACY_VERSION,
  TERMS_VERSION,
  termsGateState,
  type TermsAcceptance,
} from "@/features/legal/meta";

const PENDING_KEY = "convolve-pending-terms";

/** Google sign-up leaves the page, so the explicit acceptance is carried across the redirect. */
export function rememberPendingAcceptance() {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(acceptanceRecord()));
  } catch {
    /* storage unavailable: the gate will ask again after sign-in */
  }
}

function peekPendingAcceptance(): boolean {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as TermsAcceptance)?.terms_version === TERMS_VERSION : false;
  } catch {
    return false;
  }
}

function clearPendingAcceptance() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* storage unavailable */
  }
}

type ServerTerms = { terms_version: string | null } | null | undefined;

async function loadServerTerms(): Promise<ServerTerms> {
  try {
    const res = await fetchApi("/api/account");
    if (!res.ok) return null;
    const body = (await res.json()) as { terms?: { terms_version: string | null } };
    return body.terms ?? null;
  } catch {
    return null;
  }
}

/** Server record (timestamped by the backend), plus sign-in metadata as a fallback copy. */
async function recordAcceptance(updateMetadata: (m: Record<string, unknown>) => Promise<void>) {
  const res = await fetchApi("/api/account/terms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION }),
  });
  if (!res.ok && res.status !== 401) throw new Error(`Could not record acceptance (${res.status})`);
  await updateMetadata(acceptanceRecord());
}

export function TermsConsent({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.12] bg-white/[0.02] p-3.5 text-[13.5px] leading-relaxed text-white/65">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#a6ecc8]"
        aria-describedby="terms-consent-text"
      />
      <span id="terms-consent-text">
        I accept the{" "}
        <Link to="/terms" target="_blank" className="text-white underline underline-offset-2">
          Terms of Service
        </Link>{" "}
        and have read the{" "}
        <Link to="/privacy" target="_blank" className="text-white underline underline-offset-2">
          Privacy Policy
        </Link>{" "}
        and the{" "}
        <Link to="/risk-disclosure" target="_blank" className="text-white underline underline-offset-2">
          risk disclosure
        </Link>
        . I am at least 18 years old.
      </span>
    </label>
  );
}

/** Blocks the workspace until the signed-in user has accepted the current Terms version. */
export function TermsGate({ children }: { children: ReactNode }) {
  const { user, updateMetadata, signOut } = useAuth();
  const { pathname } = useLocation();
  const [server, setServer] = useState<ServerTerms>(undefined);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let live = true;
    setServer(undefined);
    void loadServerTerms().then((t) => live && setServer(t));
    return () => {
      live = false;
    };
  }, [userId]);

  const state = termsGateState(server, user?.user_metadata as TermsAcceptance | undefined, peekPendingAcceptance());

  const accept = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await recordAcceptance(updateMetadata);
      clearPendingAcceptance();
      setServer({ terms_version: TERMS_VERSION });
    } catch {
      setError("Could not record your acceptance. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [updateMetadata]);

  useEffect(() => {
    if (state === "record") void accept();
  }, [state, accept]);

  // Account stays reachable so someone who declines can still export or delete their data.
  if (!user || state === "accepted" || pathname === "/account") return <>{children}</>;
  if (state === "loading" || (state === "record" && !error)) return null;

  return (
    <div className="relative z-10 flex min-h-[calc(100vh-5rem)] items-start justify-center px-4 pb-16 pt-16">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-normal tracking-tight text-white">Before you continue</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          Please review and accept the current Terms of Service to use the Convolve workspace.
        </p>
        <div className="mt-6">
          <TermsConsent checked={checked} onChange={setChecked} />
        </div>
        {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
        <button
          type="button"
          disabled={!checked || busy}
          onClick={() => void accept()}
          className="w-full rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Accept and continue"}
        </button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-3 w-full rounded-xl border border-white/15 px-4 py-3 text-sm text-white/70 transition hover:bg-white/[0.05]"
        >
          Sign out
        </button>
        <p className="mt-6 text-center text-xs text-white/40">
          Don’t want to accept?{" "}
          <Link to="/account" className="text-white/70 underline underline-offset-2">
            Export or delete your account
          </Link>
        </p>
      </div>
    </div>
  );
}
