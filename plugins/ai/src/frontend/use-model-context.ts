import { useEffect, useState } from "react";
import {
  getAiModelContext,
  saveAiModelContextOverride,
  type AiModelContext,
} from "./ai-api";

/**
 * Model-scoped context detection remains mounted when the settings dialog
 * closes. Stale responses from another model are never applied.
 */
export function useModelContext(
  providerId: number | null,
  model: string,
  onCapacity: (window: number) => void,
) {
  const [info, setInfo] = useState<AiModelContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const selected = model.trim();
    setInfo(null);
    setError(null);
    // Unknown/new models start with a conservative budget while discovery is
    // in flight. Never carry a previous model's large window across switches.
    onCapacity(32768);
    if (!providerId || !selected) {
      setLoading(false);
      return;
    }
    setLoading(true);
    // Typing a custom model ID must not flood the upstream /models endpoint.
    const timer = setTimeout(() => {
      void getAiModelContext(providerId, selected)
        .then((next) => {
          if (cancelled) return;
          setInfo(next);
          onCapacity(next.contextWindow);
        })
        .catch((failure: unknown) => {
          if (!cancelled) {
            setError(
              failure instanceof Error ? failure.message : "Model context lookup failed",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [providerId, model, onCapacity, revision]);

  const saveOverride = async (contextWindow: number | null): Promise<void> => {
    const selected = model.trim();
    if (!providerId || !selected) throw new Error("Select a model first");
    await saveAiModelContextOverride(providerId, selected, contextWindow);
    // Re-query from the server: this also refreshes the detected fallback.
    setRevision((previous) => previous + 1);
  };

  return {
    info,
    loading,
    error,
    saveOverride,
    refresh: () => setRevision((previous) => previous + 1),
  };
}
