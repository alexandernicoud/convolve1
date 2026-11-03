import { useCallback, useMemo, useState } from "react";
import { Check, Copy, Download, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { btn, btnPrimary, cx } from "@/features/review/components/primitives";
import { buildPrompt, type AiPromptInput } from "./build";
import { TOOL_TITLE } from "./context";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/**
 * Collects every result of the current run into one prompt that explains Convolve, the tool and
 * each field, so any AI assistant can say what to change in the next run.
 */
export default function AiPromptButton({ collect, fileName, className }: { collect: () => Promise<AiPromptInput>; fileName: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<AiPromptInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);

  const start = useCallback(async () => {
    setOpen(true);
    setInput(null);
    setError(null);
    setCopied(false);
    try {
      setInput(await collect());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not collect the results");
    }
  }, [collect]);

  const prompt = useMemo(() => (input ? buildPrompt(input, note) : ""), [input, note]);
  const approxTokens = Math.round(prompt.length / 4);

  const copy = async () => {
    setCopied(await copyText(prompt));
    setTimeout(() => setCopied(false), 2500);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([prompt], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <button type="button" className={className ?? btn} onClick={() => void start()} title="Copy all results into a prompt for ChatGPT, Claude or Gemini">
        <Sparkles className="h-4 w-4" /> AI analysis prompt
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-4 border-white/10 bg-[#0b0b0b] p-6 text-white">
          <div>
            <DialogTitle className="text-[18px] font-semibold tracking-tight">AI analysis prompt · {input ? TOOL_TITLE[input.tool] : "collecting results"}</DialogTitle>
            <DialogDescription className="mt-1.5 text-[13.5px] leading-relaxed text-white/55">
              All results of this run, with an explanation of Convolve, of this tool and of every number, in one prompt. Paste it into ChatGPT, Claude or Gemini to get a
              diagnosis and concrete settings for your next run. Convolve does not send it to any AI service; you paste it yourself.
            </DialogDescription>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-white/55">Your goal or question (optional, added to the prompt)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. Fewer but more reliable trades, or: why does the model lose money in 2024?"
              className="resize-none rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-[13.5px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
          </label>

          {error ? (
            <p className="rounded-lg border border-red-400/25 bg-red-400/[0.06] px-3 py-2 text-[13px] text-red-200/90">{error}</p>
          ) : !input ? (
            <div className="flex h-64 items-center justify-center rounded-lg border border-white/[0.08] text-[13px] text-white/45">Collecting every result of this run…</div>
          ) : (
            <textarea
              readOnly
              value={prompt}
              aria-label="Prompt preview"
              className="h-72 min-h-0 flex-1 resize-none rounded-lg border border-white/[0.08] bg-black/50 p-3 font-mono text-[11.5px] leading-relaxed text-white/70 focus:outline-none"
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-white/40">
              {input ? `${prompt.length.toLocaleString("en-US")} characters · about ${approxTokens.toLocaleString("en-US")} tokens` : ""}
            </p>
            <div className="flex gap-2">
              <button type="button" className={btn} disabled={!input} onClick={download}>
                <Download className="h-4 w-4" /> Download .md
              </button>
              <button type="button" className={cx(btnPrimary)} disabled={!input} onClick={() => void copy()}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy prompt"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
