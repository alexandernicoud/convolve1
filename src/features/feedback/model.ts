export type FeedbackOption = { id: string; label: string };
export type FeedbackQuestion = {
  id: string;
  type: "rating" | "choice" | "text";
  prompt: string;
  min?: number;
  max?: number;
  min_length?: number;
  optional?: boolean;
  options?: FeedbackOption[];
};
export type FeedbackReward = {
  credits: number;
  remaining: number;
  /** False while credits are switched off (free beta): stored for the full launch. */
  usable_now: boolean;
  granted_at: string | null;
};
export type FeedbackGate = { threshold: number; completed_experiments: number; required: boolean };
export type FeedbackStatus = {
  completed: boolean;
  completed_at: string | null;
  credits_granted: number;
  version: string;
  bonus_credits: number;
  questions: FeedbackQuestion[];
  reward?: FeedbackReward | null;
  gate?: FeedbackGate;
};
export type FeedbackAnswers = Record<string, string | number>;

/** Mirrors the server's TEXT_MAX; the server validates again. */
export const TEXT_MAX = 2000;

export function isComplete(questions: FeedbackQuestion[], answers: FeedbackAnswers): boolean {
  return questions.every((q) => {
    const v = answers[q.id];
    if (q.type === "text") {
      const text = typeof v === "string" ? v.trim() : "";
      if (q.optional && !text) return true;
      return text.length >= (q.min_length ?? 2) && typeof v === "string" && v.length <= TEXT_MAX;
    }
    if (q.type === "rating") return typeof v === "number" && v >= (q.min ?? 1) && v <= (q.max ?? 5);
    return typeof v === "string" && (q.options ?? []).some((o) => o.id === v);
  });
}

/** Answers to send: blank optional text is left out. */
export function cleanAnswers(questions: FeedbackQuestion[], answers: FeedbackAnswers): FeedbackAnswers {
  const out: FeedbackAnswers = {};
  for (const q of questions) {
    const v = answers[q.id];
    if (v === undefined) continue;
    if (q.type === "text" && typeof v === "string" && !v.trim()) continue;
    out[q.id] = v;
  }
  return out;
}

export function rewardLine(reward: FeedbackReward | null | undefined): string | null {
  if (!reward) return null;
  return reward.usable_now
    ? `${reward.credits} bonus credits were added to your balance.`
    : `${reward.credits} bonus credits are saved to your account for the full launch. Credits are not used during the free beta.`;
}
