import { useState } from "react";
import { Download } from "lucide-react";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { AsyncBoundary, SkeletonPanel } from "@/components/skeleton/Skeleton";
import { useApi } from "@/features/account/data";
import { Button, Empty, Notice, formatDate, readError } from "@/features/account/ui";
import { fetchApi } from "@/lib/api";
import type { FeedbackQuestion } from "./model";

type Response = {
  respondent: string;
  survey_version: string;
  answers: Record<string, string | number | string[]>;
  credits_granted: number;
  created_at: string | null;
};
type AdminFeedback = { total: number; questions_by_version: Record<string, FeedbackQuestion[]>; responses: Response[] };

function display(q: FeedbackQuestion | undefined, value: Response["answers"][string] | undefined): string {
  if (value === undefined || value === "") return "—";
  const label = (id: string) => q?.options?.find((o) => o.id === id)?.label ?? id;
  if (Array.isArray(value)) return value.map(label).join(", ");
  if (typeof value === "number") return q?.max ? `${value} / ${q.max}` : String(value);
  return q?.type === "text" ? value : label(value);
}

/** Administrators only: the API answers 404 to everyone else. Respondents are pseudonymous. */
export default function FeedbackReviewPage() {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar title="Questionnaire answers" className="mb-2" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        <div className="mx-auto w-full max-w-3xl">
          <FeedbackReviewContent />
        </div>
      </div>
    </div>
  );
}

export function FeedbackReviewContent() {
  const list = useApi<AdminFeedback>("/api/admin/feedback");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadCsv = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchApi("/api/admin/feedback.csv");
      if (!res.ok) throw new Error(await readError(res));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "convolve-feedback.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not download the CSV.");
    } finally {
      setBusy(false);
    }
  };

  return (
        <div className="space-y-5">
          {list.error && !list.data ? (
            <Notice kind="error">This page is only available to administrators.</Notice>
          ) : (
            <AsyncBoundary
              state={list}
              label="Loading answers"
              skeleton={<SkeletonPanel rows={4} />}
              isEmpty={(d) => d.responses.length === 0}
              empty={<Empty>No questionnaire answers yet.</Empty>}
            >
              {(d) => (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-white/60">
                      {d.total} {d.total === 1 ? "response" : "responses"}. Respondents are shown as a pseudonym, never by name or email.
                    </p>
                    <Button variant="secondary" onClick={() => void downloadCsv()} disabled={busy}>
                      <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      {busy ? "Preparing…" : "Download CSV (current version)"}
                    </Button>
                  </div>
                  {error && <Notice kind="error">{error}</Notice>}
                  {d.responses.map((r, i) => {
                    const questions = d.questions_by_version[r.survey_version] ?? [];
                    const ids = questions.length ? questions.map((q) => q.id) : Object.keys(r.answers);
                    return (
                      <article key={`${r.respondent}-${i}`} className="rounded-2xl border border-white/[0.09] bg-white/[0.02] p-5">
                        <header className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/45">
                          <span className="font-mono">{r.respondent}</span>
                          <span>
                            {r.created_at ? formatDate(r.created_at) : ""} · version {r.survey_version}
                          </span>
                        </header>
                        <dl className="grid gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-[minmax(0,15rem)_1fr]">
                          {ids.map((id) => {
                            const q = questions.find((x) => x.id === id);
                            return (
                              <div key={id} className="contents">
                                <dt className="text-white/45">{q?.prompt ?? id}</dt>
                                <dd className="whitespace-pre-wrap text-white/85">{display(q, r.answers[id])}</dd>
                              </div>
                            );
                          })}
                        </dl>
                      </article>
                    );
                  })}
                </div>
              )}
            </AsyncBoundary>
          )}
        </div>
  );
}
