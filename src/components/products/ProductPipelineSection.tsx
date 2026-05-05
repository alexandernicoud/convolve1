import { Link } from "react-router-dom";
import { PRODUCT_PIPELINE_LINKS } from "./productPipelineLinks";

/**
 * Hub-only subsection: quick links into each pipeline stage (matches header dropdown).
 */
export default function ProductPipelineSection() {
  return (
    <section
      id="pipeline"
      className="relative border-b border-white/[0.07] bg-black px-6 py-16 md:px-10 md:py-20"
      aria-labelledby="pipeline-heading"
    >
      <div className="container-aligned max-w-[100rem]">
        <p className="marketing-section-label">Pipeline</p>
        <h2
          id="pipeline-heading"
          className="mt-5 max-w-4xl text-[clamp(1.75rem,3.2vw,2.35rem)] font-extralight leading-[1.08] tracking-[-0.03em] text-white"
        >
          Generate · train · test · optimize · deploy · compare
        </h2>
        <p className="mt-4 max-w-2xl text-[clamp(1.05rem,1.9vw,1.2rem)] font-normal leading-snug text-white/80">
          Jump straight into each stage of the workspace.
        </p>
        <ul className="mt-8 flex max-w-md flex-col gap-2">
          {PRODUCT_PIPELINE_LINKS.map((item) => (
            <li key={item.href}>
              <Link
                to={item.href}
                className="flex min-h-[48px] items-center justify-start rounded-xl border border-white/[0.12] bg-white/[0.04] px-4 py-3 text-left text-sm font-semibold text-white transition hover:border-white/25 hover:bg-white/[0.08] md:text-[15px]"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
