import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { AsyncBoundary, SkeletonPanel } from "@/components/skeleton/Skeleton";
import { useApi } from "@/features/account/data";
import { Button, Notice, readError } from "@/features/account/ui";
import { fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCreditsStore } from "@/state/creditsStore";
import {
  answeredCount,
  cleanAnswers,
  isComplete,
  rewardLine,
  TEXT_MAX,
  toggleOption,
  type FeedbackAnswers as Answers,
  type FeedbackStatus,
} from "./model";

export default function FeedbackPage() {
  const state = useApi<FeedbackStatus>("/api/feedback");
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar title="Feedback" className="mb-2" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        <div className="mx-auto w-full max-w-2xl">
          <Link
            to="/dashboard"
            className="mb-4 inline-flex w-fit items-center gap-2 text-[12px] font-medium text-white/70 transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to overview
          </Link>
          <AsyncBoundary state={state} label="Loading the questionnaire" skeleton={<SkeletonPanel rows={6} />}>
            {(data) => (data.completed ? <Thanks data={data} /> : <Questionnaire data={data} onDone={state.reload} />)}
          </AsyncBoundary>
        </div>
      </div>
    </div>
  );
}

function Intro({ bonus, gate }: { bonus: number; gate?: FeedbackStatus["gate"] }) {
  return (
    <div className="mb-6">
      <h2 className="text-[22px] font-light tracking-tight text-white">Help shape Convolve.</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/60">
        {gate?.required
          ? "You've now had a chance to try Convolve. Before your next experiment, tell us what works, what doesn't, and what you'd improve."
          : "Tell us what works, what doesn't, and what you'd improve. Honest answers help most, including criticism."}
      </p>
      <p className="mt-2 text-sm text-white/85">
        About three minutes, mostly one click per question. Complete it and earn{" "}
        <strong className="font-medium text-white">{bonus} credits</strong> for the full launch.
      </p>
      <ul className="mt-3 space-y-1 text-xs leading-relaxed text-white/45">
        {gate && gate.threshold > 0 && (
          <li>
            During the beta, the questionnaire is needed once before starting new experiments after your first {gate.threshold}{" "}
            successful ones. Your results, downloads, account settings and data controls are always available.
          </li>
        )}
        <li>
          Bonus credits are promotional: one claim per verified account, non-refundable and not exchangeable for money. While
          Convolve is free, they are saved to your account for the full launch.
        </li>
        <li>
          Your answers are stored with your account and read only by the founder to improve Convolve, without your name or
          email. They are never sold, shared or used for marketing, and are deleted with your account. See the{" "}
          <Link to="/privacy#data" className="underline underline-offset-2 hover:text-white/70">
            Privacy Policy
          </Link>
          .
        </li>
      </ul>
    </div>
  );
}

function Thanks({ data }: { data: FeedbackStatus }) {
  return (
    <section className="rounded-2xl border border-white/[0.09] bg-white/[0.02] p-7 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/[0.06]">
        <Check className="h-6 w-6 text-[#a6ecc8]" aria-hidden />
      </div>
      <h2 className="text-lg font-medium text-white">Thank you for your feedback</h2>
      <p className="mt-2 text-sm text-white/55">
        {rewardLine(data.reward) ?? "Your answers have been recorded."} The questionnaire can be completed once per account.
      </p>
      <Link
        to="/dashboard"
        className="mt-5 inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90"
      >
        Continue researching
      </Link>
    </section>
  );
}

function Questionnaire({ data, onDone }: { data: FeedbackStatus; onDone?: () => void }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (id: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [id]: v }));
  const ready = isComplete(data.questions, answers);
  const required = data.questions.filter((q) => !q.optional).length;
  const done = answeredCount(data.questions.filter((q) => !q.optional), answers);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetchApi("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: cleanAnswers(data.questions, answers) }),
      });
      if (!res.ok && res.status !== 409) throw new Error(await readError(res));
      void useCreditsStore.getState().refresh();
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your answers.");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="rounded-2xl border border-white/[0.09] bg-white/[0.02] p-5 sm:p-7">
      <Intro bonus={data.bonus_credits} gate={data.gate} />
      <ol className="space-y-7">
        {data.questions.map((q, i) => (
          <li key={q.id}>
            <fieldset>
              <legend className="mb-3 text-sm font-medium text-white/90">
                <span className="mr-2 font-mono text-xs text-white/35">{i + 1}.</span>
                {q.prompt}
              </legend>
              {q.type === "rating" && (
                <div className="flex flex-wrap items-center gap-2">
                  {Array.from({ length: (q.max ?? 5) - (q.min ?? 1) + 1 }, (_, k) => (q.min ?? 1) + k).map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={answers[q.id] === n}
                      onClick={() => set(q.id, n)}
                      className={cn(
                        "h-10 w-10 rounded-lg border text-sm transition",
                        answers[q.id] === n
                          ? "border-white bg-white text-[#0a0a0a]"
                          : "border-white/15 text-white/75 hover:bg-white/[0.06]",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                  <span className="ml-1 text-xs text-white/40">
                    {(q.max ?? 5) > 5 ? `${q.min ?? 0} = not at all, ${q.max} = definitely` : "1 = poor, 5 = excellent"}
                  </span>
                </div>
              )}
              {q.type === "multi" && (
                <div className="flex flex-wrap gap-2">
                  {q.options?.map((o) => {
                    const on = Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(o.id);
                    return (
                      <button
                        key={o.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set(q.id, toggleOption(answers[q.id], o.id))}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition",
                          on ? "border-white bg-white text-[#0a0a0a]" : "border-white/15 text-white/75 hover:bg-white/[0.06]",
                        )}
                      >
                        {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {q.type === "choice" && (
                <div className="flex flex-wrap gap-2">
                  {q.options?.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={answers[q.id] === o.id}
                      onClick={() => set(q.id, o.id)}
                      className={cn(
                        "rounded-full border px-3.5 py-1.5 text-[13px] transition",
                        answers[q.id] === o.id
                          ? "border-white bg-white text-[#0a0a0a]"
                          : "border-white/15 text-white/75 hover:bg-white/[0.06]",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {q.type === "text" && (
                <textarea
                  rows={3}
                  maxLength={TEXT_MAX}
                  value={(answers[q.id] as string) ?? ""}
                  onChange={(e) => set(q.id, e.target.value)}
                  className="input-field w-full resize-y text-sm"
                />
              )}
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button variant="primary" type="submit" disabled={!ready || sending}>
          {sending ? "Sending…" : `Submit and get ${data.bonus_credits} credits`}
        </Button>
        <span className="text-xs text-white/40">
          {ready ? "All set." : `${done} of ${required} answered. Every question except the last is needed.`}
        </span>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
    </form>
  );
}
