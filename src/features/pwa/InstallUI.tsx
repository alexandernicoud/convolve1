import { useState } from "react";
import { Download, MonitorSmartphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useInstall, type InstallState } from "./install";

const BLURB =
  "Install Convolve as a web app: it opens in its own window from your Dock, taskbar or home screen and starts straight in your workspace. Same account and data as in the browser; no app store involved.";

function InstallBody({ install, onDone }: { install: InstallState; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  if (install.native) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await install.promptInstall();
          } finally {
            setBusy(false);
            onDone();
          }
        }}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-[#0a0a0a] transition hover:bg-white/90 disabled:opacity-60"
      >
        <Download className="h-4 w-4" aria-hidden />
        Install Convolve
      </button>
    );
  }
  if (!install.steps) return null;
  return (
    <ol className="space-y-2 text-[13.5px] leading-relaxed text-white/75">
      {install.steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/20 font-digits text-[11px] text-white/60">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

export function InstallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const install = useInstall();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl border-white/12 bg-[#0a0a0a] text-white">
        <DialogTitle className="flex items-center gap-2 text-lg">
          <MonitorSmartphone className="h-5 w-5 text-white/70" aria-hidden />
          Install Convolve
        </DialogTitle>
        <DialogDescription className="text-[13.5px] leading-relaxed text-white/55">{BLURB}</DialogDescription>
        {install.visible ? (
          <InstallBody install={install} onDone={() => onOpenChange(false)} />
        ) : (
          <p className="text-[13.5px] text-white/60">This browser does not support installing web apps. Chrome, Edge or Safari can install Convolve.</p>
        )}
        <div className="flex items-center justify-between gap-3 pt-1">
          {!install.dismissed ? (
            <button
              type="button"
              onClick={() => {
                install.dismiss();
                onOpenChange(false);
              }}
              className="text-[12.5px] text-white/45 underline-offset-2 hover:text-white/75 hover:underline"
            >
              Don’t show this again
            </button>
          ) : (
            <span className="text-[12px] text-white/35">You can always install from the Help page.</span>
          )}
          <button type="button" onClick={() => onOpenChange(false)} className="rounded-lg border border-white/15 px-3 py-1.5 text-[12.5px] text-white/70 hover:text-white">
            Not now
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Sidebar entry: only when installation is possible, not already installed and not dismissed. */
export function InstallSideLink({ className, variant = "rail" }: { className?: string; variant?: "rail" | "row" }) {
  const install = useInstall();
  const [open, setOpen] = useState(false);
  if (!install.visible || install.dismissed) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Install Convolve as an app"
        className={cn(
          variant === "rail"
            ? "flex w-full flex-col items-center gap-0.5 rounded-xl py-1 text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
            : "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-white/80 hover:bg-white/[0.06]",
          className,
        )}
      >
        <Download className="h-[20px] w-[20px] shrink-0" aria-hidden />
        {variant === "rail" ? (
          <span className="text-center text-[7px] font-semibold uppercase leading-tight tracking-wide text-white/55">Install</span>
        ) : (
          <span>Install Convolve app</span>
        )}
      </button>
      <InstallDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Always-available entry (Help page), including after the sidebar entry was dismissed. */
export function InstallCard({ className }: { className?: string }) {
  const install = useInstall();
  const [open, setOpen] = useState(false);
  const standalone = !install.visible && install.platform !== "unsupported";
  return (
    <section className={cn("rounded-2xl border border-white/[0.1] bg-white/[0.02] p-5", className)}>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white">
        <MonitorSmartphone className="h-4 w-4 text-white/60" aria-hidden />
        Install Convolve as an app
      </h2>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-white/55">{BLURB}</p>
      {install.visible ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-white/25 bg-white/[0.04] px-3 text-[13px] font-semibold text-white hover:border-white/40"
        >
          <Download className="h-4 w-4" aria-hidden />
          {install.native ? "Install Convolve" : "Show how to install"}
        </button>
      ) : (
        <p className="mt-3 text-[12.5px] text-white/45">
          {standalone ? "You are using the installed app, or this browser has already installed it." : "This browser does not support installing web apps. Chrome, Edge or Safari can install Convolve."}
        </p>
      )}
      <InstallDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}
