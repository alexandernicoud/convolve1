import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { fetchApi } from "@/lib/api";
import { LEGAL_LINKS } from "@/features/legal/meta";
import { initialsFromName } from "@/lib/userProfile";
import { useCreditSummary, usePlans, useProfile, useUsage, type AccountProfile } from "@/features/account/data";
import { Button, Card, Empty, Input, Notice, Row, Stat, formatDate, readError } from "@/features/account/ui";
import { PlanTab } from "@/features/account/PlanTab";
import { RunList, UsageTab } from "@/features/account/UsageTab";
import type { CreditSummary } from "@/features/credits/model";

type DeletionStep = { step: string; ok: boolean; detail: string };

const DELETE_PHRASE = "delete my account";

const STEP_LABELS: Record<string, string> = {
  stop_bots: "Stop paper-trading bots",
  cloud_storage: "Delete stored files",
  local_files: "Delete working files",
  database: "Delete account records",
  auth_user: "Delete sign-in identity",
  restore_sign_in: "Keep your sign-in so you can retry",
};

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "usage", label: "Usage & Credits" },
  { id: "plan", label: "Plan & Billing" },
  { id: "security", label: "Security" },
  { id: "privacy", label: "Data & Privacy" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTab(v: string | null): v is TabId {
  return TABS.some((t) => t.id === v);
}

function Tabs({ active, onSelect }: { active: TabId; onSelect: (id: TabId) => void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex((t) => t.id === active);
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    onSelect(next.id);
    document.getElementById(`account-tab-${next.id}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Account sections"
      onKeyDown={onKey}
      className="-mx-2 flex gap-1 overflow-x-auto border-b border-white/[0.08] px-2 [scrollbar-width:none] sm:mx-0 sm:px-0"
    >
      {TABS.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            id={`account-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`account-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(t.id)}
            className={`relative shrink-0 whitespace-nowrap px-3 pb-3 pt-1 text-sm transition-colors ${
              selected ? "text-white" : "text-white/45 hover:text-white/80"
            }`}
          >
            {t.label}
            {selected && <span className="absolute inset-x-3 -bottom-px h-px bg-white" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

export default function Account() {
  const auth = useAuth();
  const { user } = auth;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: TabId = isTab(params.get("tab")) ? (params.get("tab") as TabId) : "overview";
  const select = (id: TabId) => setParams(id === "overview" ? {} : { tab: id }, { replace: true });

  const profile = useProfile();
  const usage = useUsage();
  const credits = useCreditSummary();
  const plans = usePlans();
  const [nameOverride, setNameOverride] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Account | convolve.";
  }, []);

  const providers: string[] = (user?.app_metadata?.providers as string[] | undefined) ?? [
    String(user?.app_metadata?.provider ?? "email"),
  ];
  const hasPassword = providers.includes("email");
  const metaName = typeof user?.user_metadata?.display_name === "string" ? user.user_metadata.display_name : "";
  const displayName = nameOverride || profile.data?.display_name || metaName || user?.email?.split("@")[0] || "";

  if (!user) return null;

  const planName = profile.data?.plan.name ?? credits.data?.plan.name;

  return (
    <div className="relative z-10 h-full min-h-0 overflow-y-auto text-white">
      <div className="mx-auto w-full max-w-4xl px-2 py-6 pb-20 sm:px-4">
        <header className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.04] text-lg font-medium text-white/85">
            {initialsFromName(displayName || "C")}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-normal tracking-tight sm:text-3xl">{displayName || "Your account"}</h1>
            <p className="truncate text-sm text-white/50">{user.email}</p>
          </div>
          {planName && (
            <span className="hidden shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 sm:inline">
              {planName} plan
            </span>
          )}
        </header>

        <div className="mt-8">
          <Tabs active={tab} onSelect={select} />
        </div>

        <div id={`account-panel-${tab}`} role="tabpanel" aria-labelledby={`account-tab-${tab}`} className="mt-8 space-y-6">
          {tab === "overview" && (
            <>
              {profile.error && <Notice kind="error">{profile.error}</Notice>}
              <OverviewSummary
                profile={profile.data}
                credits={credits.data}
                planName={planName}
                verified={Boolean(user.email_confirmed_at)}
                memberSince={user.created_at}
              />
              <ProfileCard
                email={user.email ?? "—"}
                verified={Boolean(user.email_confirmed_at)}
                createdAt={user.created_at}
                lastSignIn={user.last_sign_in_at}
                providers={providers}
                displayName={displayName}
                onSaved={setNameOverride}
              />
              {profile.data && (
                <Card title="Your workspace" description="What is currently stored under your account.">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Research runs" value={profile.data.counts.runs} />
                    <Stat label="Datasets" value={profile.data.counts.datasets} />
                    <Stat label="Models" value={profile.data.counts.models} />
                    <Stat label="Paper bots" value={profile.data.counts.bots} />
                  </div>
                </Card>
              )}
              {usage.data && (
                <Card
                  title="Latest runs"
                  action={
                    <button type="button" onClick={() => select("usage")} className="shrink-0 text-sm text-white/55 hover:text-white">
                      All activity
                    </button>
                  }
                >
                  <RunList runs={usage.data.recent.slice(0, 5)} />
                </Card>
              )}
            </>
          )}

          {tab === "usage" && (
            <div data-help="account-usage">
              <UsageTab credits={credits} usage={usage} plans={plans} />
            </div>
          )}

          {tab === "plan" && (
            <div data-help="account-plan">
              <PlanTab profile={profile} plans={plans} credits={credits} />
            </div>
          )}

          {tab === "security" && (
            <>
              <EmailCard currentEmail={user.email ?? ""} />
              <PasswordCard hasPassword={hasPassword} email={user.email ?? ""} />
              <SessionCard onSignedOut={() => navigate("/login", { replace: true })} />
            </>
          )}

          {tab === "privacy" && (
            <>
              <TermsCard profile={profile.data} />
              <ExportCard />
              <DeleteCard hasPassword={hasPassword} onDeleted={() => navigate("/?account=deleted", { replace: true })} />
              <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 pt-2 text-sm text-white/40">
                {LEGAL_LINKS.map((l) => (
                  <Link key={l.href} to={l.href} className="hover:text-white">
                    {l.label}
                  </Link>
                ))}
              </nav>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewSummary({
  profile: p,
  credits: c,
  planName,
  verified,
  memberSince,
}: {
  profile: AccountProfile | null;
  credits: CreditSummary | null;
  planName: string | undefined;
  verified: boolean;
  memberSince: string | undefined;
}) {
  const enforced = c?.mode === "enforce";
  const last30 = c?.daily.reduce((s, d) => s + d.credits, 0) ?? 0;
  const periodEnd = p?.plan.current_period_end ?? c?.plan.current_period_end;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Plan" value={planName ?? "—"} hint={verified ? "Email verified" : "Email not verified"} />
      <Stat
        label="Available credits"
        value={c ? (enforced ? c.balance.toLocaleString() : "—") : "…"}
        hint={c && !enforced ? "Runs are not charged yet" : periodEnd ? `Next allocation ${formatDate(periodEnd)}` : undefined}
      />
      <Stat label="Credits used, 30 days" value={c ? last30.toLocaleString() : "…"} />
      <Stat label="Member since" value={formatDate(p?.created_at ?? memberSince)} />
    </div>
  );
}

function TermsCard({ profile }: { profile: AccountProfile | null }) {
  const t = profile?.terms;
  const current = t && t.terms_version === t.current_terms_version;
  return (
    <Card title="Terms and privacy" description="Your acceptance is recorded on our server with the version and time.">
      {!t ? (
        <Empty>Acceptance record unavailable.</Empty>
      ) : (
        <>
          <Row label="Terms of Service">
            {t.terms_version ? `Version ${t.terms_version}` : "Not accepted"}
            {t.terms_version && !current && <span className="ml-2 text-amber-200">(an update is waiting)</span>}
          </Row>
          <Row label="Privacy Policy">{t.privacy_version ? `Version ${t.privacy_version}` : "—"}</Row>
          <Row label="Accepted">{formatDate(t.accepted_at)}</Row>
        </>
      )}
    </Card>
  );
}

function ProfileCard({
  email,
  verified,
  createdAt,
  lastSignIn,
  providers,
  displayName,
  onSaved,
}: {
  email: string;
  verified: boolean;
  createdAt: string;
  lastSignIn?: string;
  providers: string[];
  displayName: string;
  onSaved: (name: string) => void;
}) {
  const { updateMetadata, resendConfirmation } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setMsg({ kind: "error", text: "Display name cannot be empty." });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetchApi("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: trimmed }),
      });
      if (!res.ok) throw new Error(await readError(res));
      await updateMetadata({ display_name: trimmed });
      onSaved(trimmed);
      setEditing(false);
      setMsg({ kind: "ok", text: "Display name updated." });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await resendConfirmation(email);
      setMsg({ kind: "ok", text: "Verification email sent." });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not send email" });
    }
  };

  return (
    <Card title="Profile">
      <Row label="Display name">
        {editing ? (
          <form onSubmit={(e) => void save(e)} className="flex gap-2">
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Display name" autoFocus />
            <Button type="submit" variant="primary" disabled={busy}>
              Save
            </Button>
            <Button onClick={() => (setEditing(false), setName(displayName))}>Cancel</Button>
          </form>
        ) : (
          <span className="inline-flex items-center gap-3">
            {displayName || "—"}
            <button type="button" onClick={() => setEditing(true)} className="text-white/45 underline-offset-2 hover:text-white hover:underline">
              Edit
            </button>
          </span>
        )}
      </Row>
      <Row label="Email">{email}</Row>
      <Row label="Email status">
        {verified ? (
          <span className="text-[#a6ecc8]">Verified</span>
        ) : (
          <span className="inline-flex items-center gap-3">
            <span className="text-amber-200">Not verified</span>
            <button type="button" onClick={() => void resend()} className="text-white/60 underline underline-offset-2 hover:text-white">
              Resend link
            </button>
          </span>
        )}
      </Row>
      <Row label="Sign-in method">{providers.map((p) => (p === "email" ? "Email and password" : p[0].toUpperCase() + p.slice(1))).join(", ")}</Row>
      <Row label="Member since">{formatDate(createdAt)}</Row>
      <Row label="Last sign-in">{formatDate(lastSignIn)}</Row>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </Card>
  );
}

function EmailCard({ currentEmail }: { currentEmail: string }) {
  const { changeEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = email.trim();
    if (!next || next.toLowerCase() === currentEmail.toLowerCase()) {
      return setMsg({ kind: "error", text: "Enter a new email address." });
    }
    setBusy(true);
    setMsg(null);
    try {
      await changeEmail(next);
      setEmail("");
      setMsg({
        kind: "ok",
        text: "Check your inbox. The change takes effect only after you confirm it from the link we sent.",
      });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not request the change" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Change email" description="We send a confirmation link. Your current address stays active until the change is confirmed.">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 sm:flex-row">
        <Input type="email" placeholder="new@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-label="New email" />
        <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Send link"}
        </Button>
      </form>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </Card>
  );
}

function PasswordCard({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const { verifyPassword, updatePassword, requestPasswordReset } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setMsg({ kind: "error", text: "Use at least 8 characters." });
    if (next !== confirm) return setMsg({ kind: "error", text: "The new passwords do not match." });
    setBusy(true);
    setMsg(null);
    try {
      await verifyPassword(current);
      await updatePassword(next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ kind: "ok", text: "Password changed." });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not change password" });
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    try {
      await requestPasswordReset(email);
      setMsg({ kind: "ok", text: `We sent a link to ${email} to set a password.` });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not send email" });
    }
  };

  if (!hasPassword) {
    return (
      <Card title="Password" description="You sign in with Google, so this account has no password. You can add one by email.">
        <Button onClick={() => void sendReset()}>Email me a link to set a password</Button>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </Card>
    );
  }

  return (
    <Card title="Change password">
      <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:max-w-sm">
        <Input type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" aria-label="Current password" />
        <Input type="password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-label="New password" />
        <Input type="password" placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-label="Repeat new password" />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" disabled={busy || !current || !next}>
            {busy ? "Saving…" : "Change password"}
          </Button>
          <button type="button" onClick={() => void sendReset()} className="text-sm text-white/50 underline-offset-2 hover:text-white hover:underline">
            Forgot current password?
          </button>
        </div>
      </form>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </Card>
  );
}

function SessionCard({ onSignedOut }: { onSignedOut: () => void }) {
  const { signOut, signOutEverywhere } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      onSignedOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out");
    }
  };

  return (
    <Card title="Sessions" description="Signing out everywhere ends your sessions on all browsers and devices.">
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void run(signOut)}>Sign out</Button>
        <Button onClick={() => void run(signOutEverywhere)}>Sign out everywhere</Button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}

function ExportCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchApi("/api/account/export");
      if (!res.ok) throw new Error(await readError(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `convolve-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Export your data"
      description="Download a machine-readable copy (JSON) of your profile, runs, datasets, models, labels, paper bots and their trade history. Model files, chart images and reports are not embedded; download those from the workspace."
    >
      <Button onClick={() => void download()} disabled={busy}>
        {busy ? "Preparing…" : "Download export"}
      </Button>
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}

function DeleteCard({ hasPassword, onDeleted }: { hasPassword: boolean; onDeleted: () => void }) {
  const { verifyPassword, signInWithGoogle, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<DeletionStep[] | null>(null);
  const phraseOk = phrase.trim().toLowerCase() === DELETE_PHRASE;

  const remove = async () => {
    setBusy(true);
    setError(null);
    setSteps(null);
    try {
      if (hasPassword) await verifyPassword(password);
      const res = await fetchApi("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: phrase }),
      });
      if (res.status === 200) {
        try {
          for (const key of Object.keys(localStorage)) if (key.startsWith("convolve")) localStorage.removeItem(key);
        } catch {
          /* storage unavailable */
        }
        await signOut().catch(() => undefined);
        onDeleted();
        return;
      }
      if (res.status === 500) {
        const body = (await res.json()) as { steps?: DeletionStep[] };
        setSteps(body.steps ?? []);
        setError("Deletion did not complete. Your account is still active. Please try again or contact us.");
        return;
      }
      throw new Error(await readError(res));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deletion failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Delete account" tone="danger" description="Permanently delete your Convolve account and everything stored under it.">
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4 text-sm leading-relaxed text-white/65">
            <p className="text-white/85">This cannot be undone. Deleting your account will:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>stop all your paper-trading bots and delete their trade and equity history,</li>
              <li>delete your research runs, generated datasets, chart images, labels and trained models,</li>
              <li>delete your profile and your sign-in identity, ending all sessions.</li>
            </ul>
            <p className="mt-2">
              Download an export first if you want to keep a copy. Encrypted backups held by our providers expire on their own schedule, as
              described in the{" "}
              <Link to="/privacy" className="text-white underline underline-offset-2">
                Privacy Policy
              </Link>
              .
            </p>
          </div>

          <label className="block text-sm text-white/60">
            Type <span className="font-mono text-white">{DELETE_PHRASE}</span> to confirm
            <div className="mt-2">
              <Input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" aria-label="Confirmation phrase" />
            </div>
          </label>

          {hasPassword ? (
            <label className="block text-sm text-white/60">
              Enter your password to confirm it is you
              <div className="mt-2">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="Password" />
              </div>
            </label>
          ) : (
            <p className="text-sm text-white/55">
              For security, you must have signed in within the last 10 minutes.{" "}
              <button type="button" onClick={() => void signInWithGoogle("/account")} className="text-white underline underline-offset-2">
                Sign in again with Google
              </button>{" "}
              if deletion is refused.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <Button variant="danger" disabled={busy || !phraseOk || (hasPassword && !password)} onClick={() => void remove()}>
              {busy ? "Deleting…" : "Permanently delete account"}
            </Button>
            <Button onClick={() => (setOpen(false), setPhrase(""), setPassword(""), setError(null), setSteps(null))} disabled={busy}>
              Cancel
            </Button>
          </div>

          {error && <Notice kind="error">{error}</Notice>}
          {steps && steps.length > 0 && (
            <ul className="space-y-1 text-sm">
              {steps.map((s) => (
                <li key={s.step} className={s.ok ? "text-white/55" : "text-red-300"}>
                  {s.ok ? "✓" : "✗"} {STEP_LABELS[s.step] ?? s.step}
                  {!s.ok && s.detail ? ` (${s.detail})` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
