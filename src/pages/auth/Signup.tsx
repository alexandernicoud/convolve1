import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthDivider, AuthField, AuthGoogleButton, AuthShell, AuthSubmit } from "@/components/auth/AuthShell";
import { useAuth } from "@/context/AuthContext";
import { TermsConsent, rememberPendingAcceptance } from "@/components/auth/TermsConsent";
import { acceptanceRecord } from "@/features/legal/meta";
import { safeAppPath } from "@/lib/authRedirect";
import { checkReferralCode } from "@/features/rewards/api";
import { REFERRAL_PARAM, friendRewardText, normaliseCode, rememberReferral } from "@/features/rewards/model";
import { BetaOfferNote } from "@/features/beta/BetaUI";

export default function Signup() {
  const { signUp, signInWithGoogle, resendConfirmation, configured } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = useMemo(() => safeAppPath(params.get("next")), [params]);
  const loginHref = next === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const refCode = useMemo(() => normaliseCode(params.get(REFERRAL_PARAM)), [params]);
  const [invite, setInvite] = useState<{ bonus: string } | null>(null);

  useEffect(() => {
    if (!refCode) return;
    let live = true;
    void checkReferralCode(refCode).then((r) => {
      if (!live || !r.valid) return;
      try {
        rememberReferral(localStorage, refCode);
      } catch {
        /* storage unavailable: the invite cannot be carried through sign-up */
      }
      setInvite({ bonus: r.rewards?.length ? friendRewardText(r.rewards) : `${r.credits_on_subscribe} credits` });
    });
    return () => {
      live = false;
    };
  }, [refCode]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accepted) {
      setError("Please accept the Terms of Service to create an account.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await signUp(email.trim(), password, acceptanceRecord(), next);
      if (result.needsEmailConfirmation) setCheckEmail(true);
      else navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    if (!accepted) {
      setError("Please accept the Terms of Service to create an account.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      rememberPendingAcceptance();
      await signInWithGoogle(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign in failed");
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <AuthShell title="Create account" subtitle="Supabase environment variables are missing.">
        <p className="text-center text-sm text-white/50">Ask the project owner to configure Auth.</p>
      </AuthShell>
    );
  }

  if (checkEmail) {
    return (
      <AuthShell title="Check your email" subtitle="Confirm your address to finish creating the account.">
        <p className="text-center text-sm text-white/55">
          We sent a verification link to <span className="text-white">{email}</span>.
        </p>
        <button
          type="button"
          onClick={() => void resendConfirmation(email.trim())}
          className="mt-6 w-full rounded-xl border border-white/20 px-4 py-3 text-sm text-white/80 hover:bg-white/[0.06]"
        >
          Resend confirmation
        </button>
        <p className="mt-4 text-center text-sm text-white/45">
          <Link to={loginHref} className="text-white underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={invite ? "Welcome to Convolve" : "Create account"}
      subtitle={
        invite
          ? `You were invited by a Convolve ambassador. Create your account and start a plan to get bonus credits: ${invite.bonus}.`
          : "You’ll use this identity across every tool."
      }
    >
      <TermsConsent checked={accepted} onChange={setAccepted} />
      <AuthGoogleButton busy={busy || !accepted} onClick={() => void onGoogle()} />
      {error ? <p className="mt-3 text-center text-sm text-red-300">{error}</p> : null}
      <AuthDivider />
      <form onSubmit={(e) => void onSubmit(e)}>
        <AuthField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <AuthSubmit busy={busy || !accepted}>{busy ? "Creating…" : "Create account"}</AuthSubmit>
      </form>
      <p className="mt-4 text-center text-sm text-white/45">
        Already have an account?{" "}
        <Link to={loginHref} className="text-white underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
      <BetaOfferNote className="mx-auto mt-5" />
    </AuthShell>
  );
}
