import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { asset, grid } from "../data";
import { Container, Kicker, ProvenanceTag, fmtDate, useMediaQuery } from "../ui";

const COLS = 9;
const LABEL_AT: [number, number] = [0.6, 0.7];
const rule = `+${grid.tp * 100}% before −${grid.sl * 100}% within ${grid.horizon} bars`;
const hits = grid.tiles.filter((t) => t.label === 1).length;

function Tile({ i, p }: { i: number; p: MotionValue<number> }) {
  const t = grid.tiles[i];
  const a = i * 2.399963;
  const r = 520 + ((i * 97) % 380);
  const s = (i / grid.tiles.length) * 0.26;
  const x = useTransform(p, [s, s + 0.3], [Math.cos(a) * r, 0]);
  const y = useTransform(p, [s, s + 0.3], [Math.sin(a) * r * 0.62, 0]);
  const rotate = useTransform(p, [s, s + 0.3], [((i * 53) % 70) - 35, 0]);
  const scale = useTransform(p, [s, s + 0.3], [0.45, 1]);
  const opacity = useTransform(p, [s, s + 0.1, LABEL_AT[0], LABEL_AT[1]], [0, 1, 1, t.label ? 1 : 0.32]);
  const ring = useTransform(p, LABEL_AT, [0, t.label ? 1 : 0]);
  return (
    <motion.div className="relative aspect-square" style={{ x, y, rotate, scale, opacity }}>
      <img src={asset(t.file)} alt="" className="h-full w-full rounded-[5px] border border-white/[0.12] bg-[#050506]" draggable={false} />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute -inset-[3px] rounded-[7px] border-[1.5px] border-white/80"
        style={{ opacity: ring }}
      />
    </motion.div>
  );
}

function Headline({ p, range, out, lines, sub }: { p: MotionValue<number>; range: [number, number]; out?: boolean; lines: [string, string]; sub: string }) {
  const opacity = useTransform(p, range, out ? [1, 0] : [0, 1]);
  const y = useTransform(p, range, out ? [0, -24] : [24, 0]);
  return (
    <motion.div className="[grid-area:1/1]" style={{ opacity, y }}>
      <h2 className="text-[clamp(1.9rem,2.7vw,3rem)] font-normal leading-[1.08] tracking-[-0.032em] text-white">
        {lines[0]}
        <br />
        <span className="text-white/40">{lines[1]}</span>
      </h2>
      <p className="mt-6 max-w-sm text-[16px] leading-relaxed text-white/50">{sub}</p>
    </motion.div>
  );
}

function Pinned() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const count = useTransform(p, [0.02, 0.56], [0, grid.count]);
  const countText = useTransform(count, (v) => Math.round(v).toLocaleString("en-US"));
  const ruleOpacity = useTransform(p, LABEL_AT, [0, 1]);
  const mosaicScale = useTransform(p, [0.86, 1], [1, 0.94]);
  const bar = useTransform(p, [0, 1], [0, 1]);
  return (
    <div ref={ref} className="relative h-[280vh]">
      <div className="sticky top-[80px] flex h-[calc(100svh-80px)] items-center overflow-hidden">
        <Container className="relative grid grid-cols-12 items-center gap-12">
          <div className="relative z-10 col-span-4 flex flex-col">
            <Kicker>From prices to a dataset</Kicker>
            <div className="mt-8 grid">
              <Headline p={p} range={[0.48, 0.56]} out lines={["Every price window", "becomes an image."]} sub="Six months of real MSFT prices, rendered as the exact 224 × 224 picture the network reads." />
              <Headline p={p} range={[0.56, 0.64]} lines={["Labelled by", "what happened next."]} sub="A chart is a positive when the take-profit is reached before the stop-loss." />
            </div>
            <div className="mt-10 border-t border-white/[0.1] pt-6">
              <div className="flex items-baseline gap-3">
                <motion.span className="text-[clamp(2.4rem,3.4vw,3.6rem)] font-light tabular-nums tracking-[-0.04em] text-white">{countText}</motion.span>
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">chart images</span>
              </div>
              <motion.div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px]" style={{ opacity: ruleOpacity }}>
                <span className="rounded-full border border-white/25 px-2.5 py-1 text-white/85">{rule}</span>
                <span className="text-white/40">
                  {hits} of the {grid.tiles.length} shown hit take-profit
                </span>
              </motion.div>
            </div>
          </div>
          <div className="col-span-8">
            <motion.div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, scale: mosaicScale }}>
              {grid.tiles.map((t, i) => (
                <Tile key={t.file} i={i} p={p} />
              ))}
            </motion.div>
            <div className="mt-5 flex items-center justify-between gap-4">
              <ProvenanceTag kind="real" detail={`dataset ${grid.symbol} · ${fmtDate(grid.tiles[0].start, { year: "numeric" })} onward · ${grid.size} px`} />
              <span className="h-px w-40 bg-white/[0.1]">
                <motion.span className="block h-full origin-left bg-white/70" style={{ scaleX: bar }} />
              </span>
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
}

function Static() {
  return (
    <Container className="py-20">
      <Kicker>From prices to a dataset</Kicker>
      <h2 className="mt-6 text-[clamp(1.9rem,7vw,3rem)] font-normal leading-[1.08] tracking-[-0.032em] text-white">
        Every price window <span className="text-white/40">becomes a labelled image.</span>
      </h2>
      <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-white/50">
        {grid.count.toLocaleString("en-US")} real MSFT chart images. Outlined: {rule}.
      </p>
      <div className="mt-8 grid grid-cols-6 gap-1.5 sm:grid-cols-9">
        {grid.tiles.map((t) => (
          <img
            key={t.file}
            src={asset(t.file)}
            alt=""
            className={`aspect-square w-full rounded-[4px] border bg-[#050506] ${t.label ? "border-[#a6ecc8]/60" : "border-white/[0.1] opacity-50"}`}
          />
        ))}
      </div>
    </Container>
  );
}

/** Scroll-pinned: real dataset tiles fly in, assemble into the dataset, then reveal their labels. */
export function DatasetAssembly() {
  const lg = useMediaQuery("(min-width: 1024px)");
  const reduce = useReducedMotion();
  return lg && !reduce ? <Pinned /> : <Static />;
}
