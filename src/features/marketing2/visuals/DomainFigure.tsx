import { cn } from "@/lib/utils";
import { asset, domain } from "../data";
import { ProvenanceTag } from "../ui";

const ROWS = [
  { key: "mri", label: "Brain MRI", input: domain.mri.input, maps: domain.mri.maps, cam: domain.mri.gradcam, camBy: "EfficientNet-B0 · ImageNet" },
  { key: "chart", label: "Candlestick chart", input: domain.chart.input, maps: domain.chart.maps, cam: domain.chart.gradcam, camBy: "Convolve CNN · MSFT" },
] as const;

const COLS = "grid grid-cols-3 gap-x-3 sm:grid-cols-5 sm:gap-x-4 lg:gap-x-5";
/** On phones only the first filter is shown, so each row stays image · filter · Grad-CAM. */
const extraMap = (i: number) => (i > 0 ? "hidden sm:block" : "");

const LEGEND: { title: string; body: string; span?: string }[] = [
  { title: "01 · Image", body: "What the network receives." },
  { title: "02 · Learned filters", body: "Each one responds to an edge or texture.", span: "sm:col-span-3" },
  { title: "03 · Grad-CAM", body: "The regions that drove the output." },
];

const img = "aspect-square w-full rounded-[3px] border border-white/[0.1] bg-black";

/** Same filters on a scan and a chart, then where a trained network looks. */
export function DomainFigure() {
  return (
    <figure>
      <div className={COLS}>
        {LEGEND.map((l) => (
          <div key={l.title} className={cn("border-t border-white/[0.14] pt-3", l.span)}>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/70">{l.title}</div>
            <p className="mt-1.5 text-[13px] leading-snug text-white/45">{l.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-7 space-y-6">
        {ROWS.map((r) => (
          <div key={r.key}>
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-white/50">{r.label}</div>
            <div className={cn(COLS, "items-start")}>
              <img src={asset(r.input)} alt={r.key === "mri" ? "Axial slice of an MRI brain template" : "Candlestick chart image"} className={img} draggable={false} />
              {r.maps.map((f, i) => (
                <img
                  key={f}
                  src={asset(f)}
                  alt={`Response of filter ${domain.channels[i]}`}
                  className={cn(img, "[image-rendering:pixelated]", extraMap(i))}
                  draggable={false}
                />
              ))}
              <div>
                <img src={asset(r.cam)} alt={`Grad-CAM of the ${r.label.toLowerCase()}`} className={img} draggable={false} />
                <div className="mt-1.5 font-mono text-[10px] leading-snug tracking-[0.06em] text-white/35">{r.camBy}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <figcaption className="mt-6 max-w-3xl text-[12px] leading-[1.6] text-white/35">
        Filters {domain.channels.join(", ")} of one EfficientNet-B0 layer, identical for both images; the Trainer offers this network
        for transfer learning. The MRI Grad-CAM shows the method on an ImageNet model, not a diagnosis. MRI: MNI ICBM152 template, an
        average of 152 brains. {domain.mri.copyright}
      </figcaption>
      <ProvenanceTag kind="real" detail="Computed on these two images" className="mt-4" />
    </figure>
  );
}
