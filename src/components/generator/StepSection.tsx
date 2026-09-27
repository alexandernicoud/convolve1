/** Numbered step card — shared by training and test dataset generators. */
export default function StepSection({
  step,
  title,
  description,
  children,
  className = "",
}: {
  step: number;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-white/[0.12] bg-white/[0.04] p-5 md:p-6 ${className}`}>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-sm font-semibold text-white">
          {step}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-white/55">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
