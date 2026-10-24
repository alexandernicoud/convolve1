import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { M2Footer } from "@/features/marketing2/ui";
import { LEGAL_LINKS, LEGAL_UPDATED, OPERATOR } from "./meta";

const hasPlaceholders = Object.values(OPERATOR).some((v) => v.includes("["));

export function LegalLayout({
  title,
  intro,
  sections,
  children,
}: {
  title: string;
  intro?: ReactNode;
  sections?: { id: string; title: string }[];
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `${title} | convolve.`;
  }, [title]);
  return (
    <div className="bg-[#050506] text-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 pb-24 pt-10 sm:px-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16 lg:pt-16">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <nav aria-label="Legal documents" className="flex flex-wrap gap-x-5 gap-y-2 text-[14px] lg:flex-col">
            {LEGAL_LINKS.map((l) => (
              <Link
                key={l.href}
                to={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={cn(
                  "transition-colors",
                  pathname === l.href ? "text-white" : "text-white/45 hover:text-white/80",
                )}
              >
                {pathname === l.href && <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#a6ecc8] align-middle" aria-hidden />}
                {l.label}
              </Link>
            ))}
          </nav>
          {sections && sections.length > 0 && (
            <nav aria-label="On this page" className="mt-10 hidden border-t border-white/[0.08] pt-6 lg:block">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">On this page</p>
              <ol className="mt-4 space-y-2 text-[13px] text-white/45">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="transition-colors hover:text-white">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
        </aside>

        <article className="min-w-0 max-w-[46rem]">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">Legal · Last updated {LEGAL_UPDATED}</p>
          <h1 className="mt-4 text-[clamp(2rem,3.4vw,2.9rem)] font-normal leading-[1.08] tracking-[-0.03em]">{title}</h1>
          {intro && <div className="mt-5 text-[17px] leading-[1.65] text-white/65">{intro}</div>}
          {hasPlaceholders && (
            <p className="mt-6 rounded-lg border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-[14px] leading-relaxed text-white/60">
              This document is being finalised. Details shown in [square brackets] have not been completed yet.
            </p>
          )}
          <div className="legal-body mt-10 space-y-10">{children}</div>
        </article>
      </div>
      <M2Footer />
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="text-[clamp(1.25rem,1.7vw,1.5rem)] font-normal tracking-[-0.015em] text-white">{title}</h2>
      <div className="mt-4 space-y-4 text-[16px] leading-[1.7] text-white/70 [&_a]:text-white [&_a]:underline [&_a]:decoration-white/30 [&_a]:underline-offset-4 hover:[&_a]:decoration-white [&_strong]:font-medium [&_strong]:text-white/90">
        {children}
      </div>
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2 pl-5 marker:text-white/30 [list-style:disc]">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.1]">
      <table className="w-full min-w-[34rem] border-collapse text-left text-[14.5px] leading-relaxed">
        <thead className="bg-white/[0.03] text-white/85">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/[0.07] align-top">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3 text-white/65">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Placeholder({ children }: { children: ReactNode }) {
  return <span className="rounded bg-white/[0.06] px-1 font-mono text-[0.9em] text-white/80">{children}</span>;
}
