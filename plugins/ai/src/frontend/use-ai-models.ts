import { useEffect, useRef, useState } from "react";
import { getAiProviderModels } from "./ai-api";

/** Kept in the chat, not in its unmounted settings dialog. */
export function useAiModels(
  providerId: number | null,
  defaultModel: string,
  model: string,
  onModelChange: (model: string) => void,
  enabled = true,
) {
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const modelRef = useRef(model);
  modelRef.current = model;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setModels(defaultModel ? [defaultModel] : []);
    setLoadingModels(Boolean(providerId));
    setModelError(false);
    if (!modelRef.current.trim() && defaultModel) onModelChange(defaultModel);
    if (!providerId) return;
    getAiProviderModels(providerId)
      .then((upstream) => {
        if (cancelled) return;
        const choices = [
          ...new Set([defaultModel, ...upstream].filter(Boolean)),
        ];
        setModels(choices);
        if (!modelRef.current.trim() && choices.length)
          onModelChange(choices[0]);
        setModelError(upstream.length === 0);
      })
      .catch(() => {
        if (!cancelled) setModelError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, defaultModel, enabled, onModelChange, refreshIndex]);
  return {
    models,
    loadingModels,
    modelError,
    refresh: () => setRefreshIndex((i) => i + 1),
  };
}
export type ModelDiscovery = ReturnType<typeof useAiModels>;
