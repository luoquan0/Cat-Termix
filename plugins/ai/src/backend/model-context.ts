import type { ProviderConfig, AiProviderType } from "./providers/types.js";
import { assertOk, joinUrl } from "./providers/http.js";

/** Exact first-party documented IDs only. Never guess custom aliases. */
const VERIFIED_MODELS: Partial<Record<AiProviderType, Record<string, { contextWindow: number; maxOutputTokens?: number; referenceUrl: string }>>> = {
  openai: {
    "gpt-4.1": { contextWindow: 1047576, maxOutputTokens: 32768, referenceUrl: "https://developers.openai.com/api/docs/models/gpt-4.1" },
    "gpt-5": { contextWindow: 400000, referenceUrl: "https://developers.openai.com/api/docs/models/gpt-5" },
    "o4-mini": { contextWindow: 200000, referenceUrl: "https://developers.openai.com/api/docs/models/o4-mini" },
  },
  gemini: {
    "gemini-2.5-pro": { contextWindow: 1048576, maxOutputTokens: 65536, referenceUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro" },
  },
};
export type ContextSource = "upstream" | "catalog" | "unknown" | "manual";
export interface DetectedContext {
  contextWindow: number | null;
  maxOutputTokens: number | null;
  source: Exclude<ContextSource, "manual">;
  referenceUrl: string | null;
  detail: string | null;
}
export function capacityNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value :
    typeof value === "string" && /^\d{4,7}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isSafeInteger(numeric) && numeric >= 8192 && numeric <= 2000000 ? numeric : null;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function contextFromCompatibleEntry(value: unknown): {
  contextWindow: number | null; maxOutputTokens: number | null;
} {
  const entry = record(value), info = record(entry.model_info), metadata = record(entry.metadata);
  const top = record(entry.top_provider), limits = record(entry.limits), capabilities = record(entry.capabilities);
  // max_tokens often means the reply budget. Never infer context from it.
  const candidates = [entry.context_length, entry.context_window, entry.max_context_tokens,
    entry.max_model_len, entry.context_size, info.context_length, info.context_window,
    info.max_model_len, metadata.context_length, metadata.context_window,
    top.context_length, limits.context_window, capabilities.context_window];
  let window: number | null = null;
  for (const candidate of candidates) {
    window = capacityNumber(candidate);
    if (window !== null) break;
  }
  return {
    contextWindow: window,
    maxOutputTokens: capacityNumber(entry.max_output_tokens ?? top.max_completion_tokens ??
      limits.max_output_tokens ?? metadata.max_output_tokens),
  };
}
async function fromUpstream(config: ProviderConfig, model: string): Promise<DetectedContext | null> {
  if (config.providerType === "ollama") {
    const response = await config.fetch(joinUrl(config.baseUrl?.trim() || "http://localhost:11434", "api/show"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }),
    });
    await assertOk(response, "Ollama model details");
    const body = record(await response.json()), info = record(body.model_info);
    const parameters = typeof body.parameters === "string" ? body.parameters : "";
    const configured = /(?:^|\n)num_ctx\s+(\d+)(?:\s|$)/.exec(parameters);
    const runtime = configured ? capacityNumber(configured[1]) : null;
    const advertised = Object.entries(info)
      .filter(([key]) => /(?:^|\.)context_length$/.test(key))
      .map(([, value]) => capacityNumber(value))
      .find((value) => value !== null) ?? null;
    const window = runtime ?? advertised;
    return window === null ? null : {
      contextWindow: window, maxOutputTokens: null, source: "upstream", referenceUrl: null,
      detail: runtime !== null ? "Ollama configured num_ctx (runtime may differ)" :
        "Ollama model context; runtime num_ctx can be lower",
    };
  }
  if (config.providerType === "gemini") {
    if (!config.apiKey) return null;
    const base = config.baseUrl?.trim() || "https://generativelanguage.googleapis.com/v1beta";
    const response = await config.fetch(base.replace(/\/+$/, "") + "/models/" + encodeURIComponent(model), {
      method: "GET", headers: { "x-goog-api-key": config.apiKey },
    });
    await assertOk(response, "Gemini model details");
    const body = record(await response.json());
    const inputLimit = capacityNumber(body.inputTokenLimit);
    if (inputLimit === null) return null;
    return {
      contextWindow: inputLimit, maxOutputTokens: capacityNumber(body.outputTokenLimit),
      source: "upstream", referenceUrl: null,
      detail: "Gemini inputTokenLimit (reply reserve subtracted conservatively)",
    };
  }
  if (config.providerType === "openai" || config.providerType === "openai_compatible") {
    const raw = config.baseUrl?.trim() ||
      (config.providerType === "openai" ? "https://api.openai.com/v1" : "");
    if (!raw) return null;
    const base = raw.replace(/\/(?:chat\/completions|responses|models)\/?$/i, "")
      .replace(/\/+$/, "");
    const headers: Record<string, string> = {};
    if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
    const response = await config.fetch(joinUrl(base, "models"), { method: "GET", headers });
    await assertOk(response, "Model context lookup");
    const body = record(await response.json());
    const entries = Array.isArray(body.data) ? body.data : [];
    const entry = entries.find((item) => record(item).id === model);
    if (!entry) return null;
    const limits = contextFromCompatibleEntry(entry);
    if (limits.contextWindow === null) return null;
    return { ...limits, source: "upstream", referenceUrl: null,
      detail: "Context advertised by provider; gateway limits may be lower" };
  }
  return null;
}
/** Live metadata wins. Catalog is exact first-party only. */
export async function detectModelContext(config: ProviderConfig, model: string): Promise<DetectedContext> {
  try {
    const live = await fromUpstream(config, model);
    if (live) return live;
  } catch {
    // Best-effort: a broken metadata endpoint should not break chat.
  }
  const official = VERIFIED_MODELS[config.providerType]?.[model];
  if (official) return {
    contextWindow: official.contextWindow, maxOutputTokens: official.maxOutputTokens ?? null,
    source: "catalog", referenceUrl: official.referenceUrl,
    detail: "Official specification; proxy/account caps may differ",
  };
  return { contextWindow: null, maxOutputTokens: null, source: "unknown", referenceUrl: null, detail: null };
}
