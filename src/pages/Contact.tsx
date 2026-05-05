import { useState } from "react";
import { Calendar, Linkedin, Send } from "lucide-react";
import { toast } from "sonner";
import { FOUNDER_LINKEDIN_URL } from "@/lib/founderLinks";
import { submitContact } from "@/lib/submitContact";

export default function Contact() {
  const [formState, setFormState] = useState({
    name: "",
    email: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitMode, setSubmitMode] = useState<"web3forms" | "mailto" | null>(null);
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const result = await submitContact(formState);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSubmitMode(result.mode === "web3forms" ? "web3forms" : "mailto");
      setSubmitted(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col justify-center bg-black py-10 text-white md:py-12">
      <div className="container-aligned max-w-[100rem]">
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-8 text-center opacity-0 animate-fade-up md:mb-10">
            <p className="marketing-section-label">Contact</p>
            <h1 className="mt-5 text-[clamp(2rem,4vw,2.75rem)] font-extralight tracking-[-0.03em] text-white">
              Get in touch
            </h1>
            <p className="mt-4 text-[clamp(1rem,1.8vw,1.1rem)] text-white/65">
              Questions, feedback, partnership, or investment.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 md:mt-8">
              <a
                href="https://calendly.com/alexander-nicoud/30min"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 px-6 py-3 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/[0.08]"
              >
                <Calendar className="h-4 w-4" aria-hidden />
                Book a call
              </a>
              <a
                href={FOUNDER_LINKEDIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/25 px-6 py-3 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/[0.08]"
              >
                <Linkedin className="h-4 w-4 shrink-0 text-[#0A66C2]" strokeWidth={1.75} aria-hidden />
                LinkedIn DM
              </a>
            </div>
          </div>

          {submitted ? (
            <div className="py-12 text-center opacity-0 animate-fade-up" style={{ animationDelay: "100ms" }}>
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-white/15 bg-white/[0.06]">
                <Send className="h-8 w-8 text-white" />
              </div>
              <h2 className="mb-2 text-lg font-medium tracking-tight text-white">
                {submitMode === "mailto" ? "Almost there" : "Message sent"}
              </h2>
              <p className="text-white/60">
                {submitMode === "mailto" ?
                  "If your email app opened, send the message from there to deliver it."
                : "We'll get back to you as soon as possible."}
              </p>
            </div>
          ) : (
            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="tech-surface space-y-6 p-6 opacity-0 animate-fade-up md:p-8"
              style={{ animationDelay: "100ms" }}
            >
              <div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                  Name
                </label>
                <input
                  type="text"
                  required
                  value={formState.name}
                  onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                  className="input-field w-full"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={formState.email}
                  onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                  className="input-field w-full"
                />
              </div>

              <div>
                <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-white/50">
                  Message
                </label>
                <textarea
                  required
                  rows={5}
                  value={formState.message}
                  onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                  className="input-field w-full resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={sending}
                className="w-full rounded-full border border-white/25 bg-white px-6 py-3 text-sm font-medium text-[#0a0a0a] transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? "Sending…" : "Send message"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
