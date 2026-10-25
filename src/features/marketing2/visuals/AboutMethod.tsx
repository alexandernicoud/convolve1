import type { ReactNode } from "react";
import { training } from "../data";
import { int, runFigures } from "../figures";
import { Container, Kicker, Reveal, TYPE } from "../ui";
import { DatasetAssembly } from "./DatasetAssembly";
import { GradientLandscape } from "./GradientLandscape";
import { Frac, I, Sum } from "./math";
import { ConvScan } from "./ModelLab";

const RUN = runFigures(training, [224, 224, 3], 16);
const convs = training.arch.filter((l) => l.kind === "Conv2D");
const flat = training.arch.find((l) => l.kind === "Flatten");
const dense = training.arch.find((l) => l.kind === "Dense");
const lastMap = training.arch.filter((l) => l.kind === "MaxPooling2D").at(-1)?.out ?? [26, 26, 128];

function Movement({ step, title, children }: { step: string; title: ReactNode; children?: ReactNode }) {
  return (
    <Reveal>
      <Kicker>{step}</Kicker>
      <h3 className={`mt-4 max-w-2xl ${TYPE.h3Editorial}`}>{title}</h3>
      {children}
    </Reveal>
  );
}

function Op({ name, eq, children }: { name: string; eq?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-white/[0.1] pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="text-[16px] text-white">{name}</span>
        {eq ? <span className="text-[18px] font-light text-white/85">{eq}</span> : null}
      </div>
      <p className="mt-2.5 text-[15.5px] leading-[1.65] text-white/55">{children}</p>
    </div>
  );
}

/** How Convolve turns price history into a tested probability, told along the actual computation. */
export function AboutMethod({ label }: { label: ReactNode }) {
  return (
    <section id="method" className="scroll-mt-20">
      <DatasetAssembly label={label} />

      <Container>
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-6">
            <Movement step="Convolution · features · prediction" title={<>What the network computes on one chart.</>}>
              <p className={`mt-5 ${TYPE.body}`}>
                The image arrives as {int(224 * 224 * 3)} numbers. Three blocks of convolution, ReLU and pooling reduce them to {lastMap[0]} ×{" "}
                {lastMap[1]} × {lastMap[2]} feature maps; a dense layer of {dense?.out[0] ?? 128} units and one output turn those into a
                probability.
              </p>
              <div className="mt-8 space-y-6">
                <Op
                  name="Convolution"
                  eq={
                    <>
                      <I>z</I> = <I>b</I> + <Sum sub="u,v" />
                      <I>W</I>(<I>u</I>,<I>v</I>) <I>a</I>(<I>i</I>+<I>u</I>, <I>j</I>+<I>v</I>)
                    </>
                  }
                >
                  A 3 × 3 filter of learned weights <I>W</I> slides over the image and, at each position, sums the pixels beneath it. The same
                  nine weights are reused everywhere, so a pattern is recognised wherever it appears on the chart. The first layer applies{" "}
                  {convs[0]?.filters ?? 32} such filters, the last {convs.at(-1)?.filters ?? 128}.
                </Op>
                <Op name="ReLU" eq={<>ReLU(<I>x</I>) = max(0, <I>x</I>)</>}>
                  Every response below zero is set to zero. Without this bend, stacked layers would collapse into one linear function and could
                  never express “this shape matters only next to that one”.
                </Op>
                <Op name="Feature maps">
                  Each filter outputs a map of where its pattern occurred. Pooling halves the resolution after every block, so deeper maps see
                  larger regions: early ones respond to wicks and edges, later ones to formations built from them.
                </Op>
                <Op name="Prediction" eq={<><I>p</I> = σ(<I>z</I>) = <Frac n="1" d={<>1 + <I>e</I><sup>−<I>z</I></sup></>} /></>}>
                  The {int(flat?.out[0] ?? 86528)} feature values pass through the dense layer to one score <I>z</I>; the sigmoid maps it to{" "}
                  <I>p</I> between 0 and 1, the model&apos;s estimate that this chart carries label 1.
                </Op>
                <Op name="Architecture as a research variable">
                  This is the original Convolve CNN, one of seven networks in the Trainer. Each encodes a different assumption about where the
                  signal sits: a dense head that keeps position or global pooling that discards it, residual depth, or ImageNet features reused
                  by transfer. Optimiser, learning-rate schedule, dropout, L2 and augmentation are chosen per run as well. Trained on the same
                  split, the variants are compared on validation and test data; a larger network is not presumed better.
                </Op>
              </div>
            </Movement>
          </div>
          <Reveal className="lg:col-span-6" delay={0.08}>
            <div className="lg:sticky lg:top-[14vh] lg:pt-12">
              <ConvScan />
              <p className="mt-4 font-mono text-[11px] text-white/40">One 3 × 3 filter on a real test chart, and the feature map it produces.</p>
            </div>
          </Reveal>
        </div>

        <div className="mt-24 grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Movement step="Training" title={<>Learning is a descent on the loss.</>} />
          </div>
          <Reveal className="space-y-6 lg:col-span-7" delay={0.06}>
            <Op name="Loss" eq={<><I>L</I> = −[<I>y</I> log <I>p</I> + (1−<I>y</I>) log(1−<I>p</I>)]</>}>
              Binary cross-entropy compares each probability with the true label <I>y</I>. It is small when the model is confidently right and
              grows without bound when it is confidently wrong, which is exactly the behaviour a probability should be punished for.
            </Op>
            <Op name="Backpropagation and gradient descent" eq={<><I>θ</I> ← <I>θ</I> − <I>η</I> ∇<sub><I>θ</I></sub><I>L</I></>}>
              After each batch, the chain rule runs backwards through the layers to get the gradient: how much each weight contributed to the
              loss. The optimiser then moves all weights a step of size <I>η</I> downhill. Training the original Convolve CNN on{" "}
              {int(training.train_samples)} charts took {int(RUN.optimizerSteps)} such steps, each adjusting all {int(RUN.params)} weights.
            </Op>
          </Reveal>
        </div>
      </Container>

      <Container className="mt-12">
        <Reveal>
          <GradientLandscape />
        </Reveal>
      </Container>

      <Container>
        <div className="mt-24 grid gap-12 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-5">
            <Movement step="Evaluation" title={<>A model counts only on data it has never seen.</>} />
          </div>
          <Reveal className="space-y-6 lg:col-span-7" delay={0.06}>
            <Op name="Validation">
              A later stretch of history is held out from fitting. It decides which epoch is kept and where the decision threshold sits, before
              any test result is looked at.
            </Op>
            <Op name="Backtesting">
              The locked model then trades the test period once, after costs, next to buy-and-hold and a passive mix with the same exposure.
              Classification accuracy and trading return are measured separately, because they can disagree.
            </Op>
            <Op name="Interpretability">
              Grad-CAM, saliency and occlusion show which pixels moved a prediction, so a learned price formation can be told apart from an
              artefact of how the chart was drawn.
            </Op>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
