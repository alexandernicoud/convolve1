import { useState } from "react";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { AsyncBoundary, SkeletonPanel } from "@/components/skeleton/Skeleton";
import { useApi } from "@/features/account/data";
import { Button, Card, Empty, Notice, formatDate, readError } from "@/features/account/ui";
import { fetchApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useCreditsStore } from "@/state/creditsStore";
import type { CitationClaim } from "./model";

type AdminClaim = CitationClaim & { user_id: string; email: string };
type Status = "pending" | "approved" | "rejected";

const CHECKLIST = [
  "The page or document is public (or a published paper or thesis) and names Convolve.",
  "It belongs to the account holder: their site, repository, paper or project.",
  "It is a genuine reference, not a page made only to claim the bonus.",
  "A screenshot or file alone is not enough unless it shows a published document you can verify.",
];

/** Administrators only: the API answers 404 to everyone else, so this page shows nothing to them. */
export default function CitationReviewPage() {
  const [status, setStatus] = useState<Status>("pending");
  const list = useApi<{ total: number; claims: AdminClaim[] }>(`/api/admin/citations?status=${status}`);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden font-sans">
      <DashboardTopBar title="Citation reviews" className="mb-2" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
        <div className="mx-auto w-full max-w-3xl space-y-5">
          <div role="tablist" aria-label="Status" className="flex gap-2">
            {(["pending", "approved", "rejected"] as Status[]).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={status === s}
                onClick={() => setStatus(s)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm capitalize transition",
                  status === s ? "border-white/40 bg-white/[0.08] text-white" : "border-white/[0.1] text-white/55 hover:text-white",
                )}
              >
                {s}
              </button>
            ))}
          </div>
          {list.error && !list.data ? (
            <Notice kind="error">This page is only available to administrators.</Notice>
          ) : (
            <AsyncBoundary
              state={list}
              label="Loading citations"
              skeleton={<SkeletonPanel rows={4} />}
              isEmpty={(d) => d.claims.length === 0}
              empty={<Empty>No {status} citations.</Empty>}
            >
              {(d) => (
                <div className="space-y-4">
                  {d.claims.map((c) => (
                    <ClaimCard key={c.id} claim={c} onDone={list.reload} />
                  ))}
                </div>
              )}
            </AsyncBoundary>
          )}
        </div>
      </div>
    </div>
  );
}

function ClaimCard({ claim, onDone }: { claim: AdminClaim; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshCredits = useCreditsStore((s) => s.refresh);

  const review = async (approve: boolean) => {
    if (!approve && !note.trim()) return setError("Say why it is not approved; the member sees this note.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetchApi(`/api/admin/citations/${claim.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve, note: note.trim() || null }),
      });
      if (!res.ok) throw new Error(await readError(res));
      void refreshCredits();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setError(null);
    try {
      const res = await fetchApi(`/api/admin/citations/${claim.id}/file`);
      if (!res.ok) throw new Error(await readError(res));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = claim.file_name || "citation";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    }
  };

  return (
    <Card title={claim.email || claim.user_id} description={`Submitted ${formatDate(claim.created_at)}`}>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-white/45">Address</dt>
          <dd className="break-all text-white/85">
            {claim.url ? (
              <a href={claim.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2 hover:text-white">
                {claim.url}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        {claim.note && (
          <div>
            <dt className="text-xs text-white/45">Note</dt>
            <dd className="whitespace-pre-wrap text-white/75">{claim.note}</dd>
          </div>
        )}
        {claim.has_file && (
          <div>
            <dt className="text-xs text-white/45">File</dt>
            <dd>
              <button type="button" onClick={() => void download()} className="text-white/85 underline underline-offset-2 hover:text-white">
                Download {claim.file_name}
              </button>
              <span className="ml-2 text-xs text-white/40">Downloaded as a file, never opened in the page.</span>
            </dd>
          </div>
        )}
        {claim.status !== "pending" && (
          <div>
            <dt className="text-xs text-white/45">Decision</dt>
            <dd className="text-white/75">
              {claim.status === "approved" ? `Approved, ${claim.credits_granted} credits` : "Rejected"} on {formatDate(claim.reviewed_at)}
              {claim.review_note ? ` · ${claim.review_note}` : ""}
            </dd>
          </div>
        )}
      </dl>
      {claim.status === "pending" && (
        <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4">
          <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-white/50">
            {CHECKLIST.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <textarea
            value={note}
            maxLength={2000}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note to the member (required when rejecting)"
            className="block w-full rounded-xl border border-white/15 bg-black/40 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
          />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" disabled={busy} onClick={() => void review(true)}>
              Approve and add credits
            </Button>
            <Button disabled={busy} onClick={() => void review(false)}>
              Reject
            </Button>
          </div>
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </Card>
  );
}
