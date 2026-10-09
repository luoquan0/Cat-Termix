/** Shared wire types. Counts are estimates, never presented as model tokenization. */
export interface ContextPolicy {
  autoCompact: boolean;
  contextWindow: number;
  outputReserve: number;
  threshold: number;
  keepRecentTurns: number;
}
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  autoCompact: true,
  contextWindow: 32768,
  outputReserve: 4096,
  threshold: 75,
  keepRecentTurns: 4,
};
export interface ContextUsage {
  inputTokens: number;
  contextWindow: number;
  outputReserve: number;
  percent: number;
  estimated: true;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  compactions: number;
  state: "ready" | "compacting" | "error";
}
export interface ContextCheckpoint {
  version: 1;
  throughId: number;
  summary: string;
  compactions: number;
  policy: ContextPolicy;
  usage?: ContextUsage;
}
export function contextPolicy(value: unknown): ContextPolicy {
  if (value === undefined || value === null)
    return { ...DEFAULT_CONTEXT_POLICY };
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid context settings");
  const p = { ...DEFAULT_CONTEXT_POLICY, ...value } as ContextPolicy;
  if (
    typeof p.autoCompact !== "boolean" ||
    !Number.isSafeInteger(p.contextWindow) ||
    p.contextWindow < 8192 ||
    p.contextWindow > 2000000 ||
    !Number.isSafeInteger(p.outputReserve) ||
    p.outputReserve < 512 ||
    p.outputReserve > Math.min(65536, p.contextWindow / 2) ||
    !Number.isSafeInteger(p.threshold) ||
    p.threshold < 50 ||
    p.threshold > 90 ||
    !Number.isSafeInteger(p.keepRecentTurns) ||
    p.keepRecentTurns < 1 ||
    p.keepRecentTurns > 20
  ) {
    throw new Error(
      "Context window: 8192-2000000; output reserve: 512-half window (max 65536); threshold: 50-90%; recent turns: 1-20",
    );
  }
  return {
    autoCompact: p.autoCompact,
    contextWindow: p.contextWindow,
    outputReserve: p.outputReserve,
    threshold: p.threshold,
    keepRecentTurns: p.keepRecentTurns,
  };
}
/** Intentionally conservative heuristic for mixed code/CJK, not a tokenizer. */
export function estimateTextTokens(text: string): number {
  let ascii = 0,
    other = 0;
  for (const char of text) {
    if (char.codePointAt(0)! < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 3 + other * 2);
}
export function readCheckpoint(raw: unknown): ContextCheckpoint | null {
  try {
    const c = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (
      !c ||
      c.version !== 1 ||
      !Number.isSafeInteger(c.throughId) ||
      c.throughId < 0 ||
      typeof c.summary !== "string" ||
      c.summary.length > 32000 ||
      !Number.isSafeInteger(c.compactions) ||
      c.compactions < 0
    )
      return null;
    return { ...c, policy: contextPolicy(c.policy) };
  } catch {
    return null;
  }
}
