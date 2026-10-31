import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, Send } from "lucide-react";
import { AsyncBoundary, SkeletonPanel } from "@/components/skeleton/Skeleton";
import { useCreditsStore } from "@/state/creditsStore";
import { Button, Card, Input, Notice, Stat, formatDate } from "@/features/account/ui";
import { createReferralCode, submitCitation, useRewards } from "./api";
import {
  ambassadorRewardText,
  citationFileProblem,
  friendRewardText,
  inviteLink,
  inviteMessage,
  isHttpUrl,
  maxFriendCredits,
  type RewardsStatus,
} from "./model";

type Msg = { kind: "ok" | "error" | "info"; text: string } | null;

function Bonus({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full border border-[#a6ecc8]/35 px-3 py-1 text-xs tabular-nums text-[#a6ecc8]">{children}</span>
  );
}

function Done({ children }: { children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm text-[#a6ecc8]">
      <Check className="h-4 w-4" aria-hidden />
      {children}
    </p>
  );
}

/** Account → Earn credits: questionnaire, citation bonus and the ambassador programme. */
export function EarnTab() {
  const rewards = useRewards();
  const refreshCredits = useCreditsStore((s) => s.refresh);
  const reload = () => {
    rewards.reload();
    void refreshCredits();
  };
  return (
    <AsyncBoundary state={rewards} label="Loading rewards" skeleton={<SkeletonPanel rows={6} />}>
      {(r) => (
        <div className="space-y-6">
          {r.referred && (
            <Notice kind={r.referred.status === "reversed" ? "info" : "ok"}>
              {r.referred.status === "rewarded"
                ? `You joined through an ambassador's invite and received ${r.referred.credits} bonus credits.`
                : r.referred.status === "reversed"
                  ? "You joined through an ambassador's invite. The bonus was withdrawn because the qualifying payment was refunded or disputed."
                  : `You joined through an ambassador's invite: start a plan to get your bonus credits (${friendRewardText(r.referred.rewards)}).`}
            </Notice>
          )}
          <Ambassador r={r} onChanged={reload} />
          <Citation r={r} onChanged={reload} />
          <Questionnaire r={r} />
          <p className="text-xs leading-relaxed text-white/40">
            Bonus credits are promotional: they have no cash value, cannot be transferred and are never refunded. See the{" "}
            <Link to="/terms" className="underline underline-offset-2 hover:text-white">
              Terms
            </Link>
            .
          </p>
        </div>
      )}
    </AsyncBoundary>
  );
}

function Questionnaire({ r }: { r: RewardsStatus }) {
  return (
    <Card
      title="Answer the feedback questionnaire"
      description="Six short questions about what works for you and what is missing. Once per account."
      action={<Bonus>+{r.questionnaire.credits} credits</Bonus>}
    >
      {r.questionnaire.completed ? (
        <Done>Completed. The credits are in your balance.</Done>
      ) : (
        <Link to="/dashboard/feedback" className="inline-flex rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90">
          Answer the questions
        </Link>
      )}
    </Card>
  );
}

function Citation({ r, onChanged }: { r: RewardsStatus; onChanged: () => void }) {
  const c = r.citation;
  const latest = c.claims[0];
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isHttpUrl(url)) return setMsg({ kind: "error", text: "Enter the full address, starting with https://." });
    if (!url.trim() && !file) return setMsg({ kind: "error", text: "Add the address where you cite Convolve, or attach a file." });
    const problem = citationFileProblem(file, c.max_file_bytes);
    if (problem) return setMsg({ kind: "error", text: problem });
    setBusy(true);
    setMsg(null);
    try {
      await submitCitation({ url, note, file });
      setUrl("");
      setNote("");
      setFile(null);
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not send" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Cite Convolve"
      description="Reference Convolve publicly on your website, in a paper, thesis, article or public repository. Send the link, or the published document if it has no public link. We review every submission and add the credits within 24 hours of approval."
      action={<Bonus>+{c.credits} credits</Bonus>}
    >
      <ul className="mb-5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-white/50">
        <li>The reference must be genuine, public and name Convolve (we-convolve.com), on a page or document you published or co-authored.</li>
        <li>A screenshot alone, a private message, or a page made only to claim the bonus does not qualify.</li>
        <li>One approved citation per account. If a submission is not approved, we tell you why and you can send another.</li>
      </ul>
      {c.status === "approved" ? (
        <Done>Thank you for citing Convolve. {c.credits} credits were added to your balance.</Done>
      ) : c.status === "pending" ? (
        <p className="text-sm text-white/65">
          Under review since {formatDate(latest?.created_at)}. You will get the credits within 24 hours of approval.
        </p>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:max-w-lg">
          {c.status === "rejected" && latest && (
            <Notice kind="error">
              Your last submission was not approved{latest.review_note ? `: ${latest.review_note}` : "."} You can send another one.
            </Notice>
          )}
          <label className="block text-sm text-white/60">
            Where do you cite Convolve?
            <div className="mt-2">
              <Input type="url" inputMode="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          </label>
          <label className="block text-sm text-white/60">
            File (PDF or image, up to {Math.round(c.max_file_bytes / (1024 * 1024))} MB)
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full text-sm text-white/70 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-white/15"
            />
          </label>
          <label className="block text-sm text-white/60">
            Note (optional)
            <textarea
              value={note}
              maxLength={2000}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For example: cited in section 3, page 12."
              className="mt-2 block w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
            />
          </label>
          <div>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Sending…" : "Send for review"}
            </Button>
          </div>
        </form>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </Card>
  );
}

function Ambassador({ r, onChanged }: { r: RewardsStatus; onChanged: () => void }) {
  const a = r.ambassador;
  const tier = a.reward_tier ?? "Research";
  const [code, setCode] = useState<string | null>(a.code);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const link = code ? inviteLink(window.location.origin, code) : "";

  const generate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setCode(await createReferralCode());
      onChanged();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not create your code" });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg({ kind: "ok", text: `${what} copied.` });
    } catch {
      setMsg({ kind: "error", text: "Copying is blocked in this browser. Select the text and copy it." });
    }
  };

  const send = async () => {
    if (!code) return;
    const text = inviteMessage(code, link, maxFriendCredits(a.rewards, a.referee_credits));
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Join me on Convolve", text, url: link });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copy(text, "Invite message with your link and code");
  };

  return (
    <Card
      title="Become an ambassador"
      description={`Invite people to Convolve. You get ${ambassadorRewardText(a.rewards)}. Your friend gets ${friendRewardText(a.rewards)}.`}
      action={<Bonus>Up to {a.max_rewards_per_year} free months of {tier} a year</Bonus>}
    >
      <ol className="grid gap-3 text-sm text-white/65 sm:grid-cols-3">
        {[
          "Generate your personal invite code.",
          "Send your link. It opens a Convolve sign-up page that welcomes your friend.",
          "When their first paid plan payment goes through, you both get your reward automatically.",
        ].map((step, i) => (
          <li key={step} className="rounded-xl border border-white/[0.07] px-4 py-3.5">
            <span className="font-mono text-[11px] text-white/35">0{i + 1}</span>
            <p className="mt-1.5 leading-relaxed">{step}</p>
          </li>
        ))}
      </ol>

      {!code ? (
        <div className="mt-5">
          <Button variant="primary" onClick={() => void generate()} disabled={busy}>
            {busy ? "Generating…" : "Generate my code"}
          </Button>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-white/[0.1] bg-black/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs text-white/45">Your invite code</div>
              <div className="mt-1 font-mono text-2xl tracking-[0.18em] text-white">{code}</div>
              <div className="mt-1 truncate text-xs text-white/45">{link}</div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="primary" onClick={() => void send()}>
                <span className="inline-flex items-center gap-2">
                  <Send className="h-4 w-4" aria-hidden />
                  Send invite
                </span>
              </Button>
              <Button onClick={() => void copy(link, "Link")}>
                <span className="inline-flex items-center gap-2">
                  <Copy className="h-4 w-4" aria-hidden />
                  Copy link
                </span>
              </Button>
              <Button onClick={() => void copy(code, "Code")}>Copy code</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Signed up" value={a.invited} />
            <Stat label="Started a plan" value={a.subscribed} />
            <Stat label="Free months earned" value={a.months_earned} />
            <Stat label="Credits earned" value={a.credits_earned} />
          </div>
          {a.free_month_until && <Notice kind="ok">Your free month of {tier} runs until {formatDate(a.free_month_until)}.</Notice>}
        </div>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <p className="mt-4 text-xs leading-relaxed text-white/40">
        Only your friend's first paid plan counts. If you already pay for a plan, the free month is credited against your next invoices
        instead. Up to {a.max_rewards_per_year} free months per year. Invite codes work for new accounts only, not your own, and the plan
        must be paid for, not fully covered by a discount. If that payment is refunded or disputed, unused rewards from it are withdrawn.
        Reward credits are promotional and never refundable for cash.
      </p>
    </Card>
  );
}
