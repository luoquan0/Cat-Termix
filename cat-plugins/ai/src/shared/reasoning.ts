import { parseEnabledModels } from "./model-selection.js";

/** Portable request-level reasoning settings. "auto" leaves the provider's
 * existing behavior untouched; unsupported modes are never guessed. */
export const REASONING_EFFORTS = [
  "auto",
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  typeof value === "string" &&
  (REASONING_EFFORTS as readonly string[]).includes(value);

export interface AiChatPreferences {
  providerId: number | null;
  model: string;
  approvalMode: "review" | "auto";
  reasoningEffort: ReasoningEffort;
  /** Shared execution is a user default, never a terminal-session ID. */
  executionMode?: "isolated" | "shared";
  /** Last opened conversation per host; "global" is the hostless assistant. */
  activeConversations?: Record<string, number>;
  /** User-owned default effort per configured provider ID. */
  providerEfforts: Record<string, ReasoningEffort>;
  /** Missing channel keys retain legacy discovery. [] explicitly disables all models. */
  providerModels?: Record<string, string[]>;
}

export const DEFAULT_AI_PREFERENCES: AiChatPreferences = {
  providerId: null,
  model: "",
  approvalMode: "review",
  reasoningEffort: "auto",
  executionMode: "isolated",
  activeConversations: {},
  providerEfforts: {},
  providerModels: {},
};

export function normalizeAiPreferences(input: unknown): AiChatPreferences {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return {
      ...DEFAULT_AI_PREFERENCES,
      providerEfforts: {},
      providerModels: {},
    };
  const obj = input as Record<string, unknown>;
  const effortEntries = Object.entries(
    obj.providerEfforts &&
      typeof obj.providerEfforts === "object" &&
      !Array.isArray(obj.providerEfforts)
      ? obj.providerEfforts
      : {},
  ).filter(([id, effort]) => /^\d+$/.test(id) && isReasoningEffort(effort));
  const activeEntries = Object.entries(
    obj.activeConversations &&
      typeof obj.activeConversations === "object" &&
      !Array.isArray(obj.activeConversations)
      ? obj.activeConversations
      : {},
  )
    .filter(
      ([key, id]) =>
        (key === "global" || /^[1-9]\d*$/.test(key)) &&
        Number.isSafeInteger(id) &&
        (id as number) > 0,
    )
    .slice(0, 100);
  const modelEntries = Object.entries(
    obj.providerModels &&
      typeof obj.providerModels === "object" &&
      !Array.isArray(obj.providerModels)
      ? obj.providerModels
      : {},
  )
    .filter(([id]) => /^[1-9]\d*$/.test(id))
    .map(([id, models]) => {
      try {
        return [id, parseEnabledModels(models)];
      } catch {
        return [id, []];
      } // Corrupt saved restrictions fail closed.
    });
  return {
    providerId:
      typeof obj.providerId === "number" &&
      Number.isSafeInteger(obj.providerId) &&
      obj.providerId > 0
        ? obj.providerId
        : null,
    model: typeof obj.model === "string" ? obj.model.slice(0, 200) : "",
    approvalMode: obj.approvalMode === "auto" ? "auto" : "review",
    reasoningEffort: isReasoningEffort(obj.reasoningEffort)
      ? obj.reasoningEffort
      : "auto",
    executionMode: obj.executionMode === "shared" ? "shared" : "isolated",
    activeConversations: Object.fromEntries(activeEntries),
    providerEfforts: Object.fromEntries(effortEntries),
    providerModels: Object.fromEntries(modelEntries),
  };
}
