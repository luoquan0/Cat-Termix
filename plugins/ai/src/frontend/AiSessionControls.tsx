import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@termix/plugin-sdk/ui";
import { AiEnabledModels } from "./AiEnabledModels";
import { getAiProviderModels, updateAiProvider, type AiProvider } from "./ai-api";
import { providerModelOptions } from "../shared/model-selection";

export type ApprovalMode = "review" | "auto";
export type ExecutionMode = "isolated" | "shared";

interface Props {
  providers: AiProvider[];
  providerId: number | null;
  onProviderChange: (id: number) => void;
  model: string;
  onModelChange: (model: string) => void;
  onProviderUpdated?: (provider: AiProvider) => void;
  disabled: boolean;
  executionMode?: ExecutionMode;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
}

/** Configure a channel's available models here; choose one for each message in the composer. */
export function AiSessionControls({
  providers,
  providerId,
  onProviderChange,
  model,
  onModelChange,
  onProviderUpdated,
  disabled,
  executionMode = "isolated",
  onExecutionModeChange,
}: Props) {
  const { t } = useTranslation();
  const provider = providers.find((item) => item.id === providerId);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [draft, setDraft] = useState<{
    providerId: number;
    models: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDiscovered([]);
    setModelError(false);
    if (!providerId) {
      setLoadingModels(false);
      return;
    }
    setLoadingModels(true);
    void getAiProviderModels(providerId)
      .then((models) => {
        if (!cancelled) setDiscovered(models);
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
  }, [providerId, refreshIndex]);

  const dirty = draft?.providerId === providerId;
  const selected = dirty
    ? draft.models
    : provider
      ? providerModelOptions(provider, discovered, model)
      : [];

  const saveModels = async () => {
    if (!provider || !dirty || disabled || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // Persist through the same user-scoped channel settings as the provider editor.
      // The backend updates the default model if the previous one was unchecked.
      const updated = await updateAiProvider(provider.id, {
        enabledModels: selected,
      });
      onProviderUpdated?.(updated);
      if (!selected.includes(model))
        onModelChange(updated.defaultModel ?? selected[0] ?? "");
      setDraft(null);
      setSaved(true);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : t("ai.providerSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-w-0 space-y-3 px-3 pb-3">
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">
            {t("ai.selectProvider")}
          </p>
          <Select
            value={providerId ? String(providerId) : undefined}
            onValueChange={(value) => {
              setDraft(null);
              setSaveError(null);
              setSaved(false);
              onModelChange("");
              onProviderChange(Number(value));
            }}
            disabled={disabled || saving}
          >
            <SelectTrigger
              className="h-9 w-full min-w-0 rounded-md text-sm"
              aria-label={t("ai.selectProvider")}
            >
              <SelectValue placeholder={t("ai.selectProvider")} />
            </SelectTrigger>
            <SelectContent className="z-[300]">
              {providers.map((item) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
          <span className="text-xs text-muted-foreground">
            {t("ai.enabledModelsCount", { count: selected.length })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 shrink-0"
            title={t("ai.modelRefresh")}
            aria-label={t("ai.modelRefresh")}
            disabled={disabled || saving || !providerId || loadingModels}
            onClick={() => setRefreshIndex((value) => value + 1)}
          >
            <RefreshCw
              size={14}
              className={loadingModels ? "animate-spin" : ""}
            />
          </Button>
        </div>
      </div>
      {provider && (
        <>
          <p className="break-words text-xs text-muted-foreground">
            {t("ai.chatModelSelectionHint")}
          </p>
          <AiEnabledModels
            models={discovered}
            selected={selected}
            disabled={disabled || saving}
            onChange={(models) => {
              setDraft({ providerId: provider.id, models });
              setSaveError(null);
              setSaved(false);
            }}
          />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={disabled || saving || !dirty}
              onClick={() => void saveModels()}
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {t("ai.save")}
            </Button>
            {saved && (
              <span role="status" className="text-xs text-muted-foreground">
                {t("ai.providerUpdated")}
              </span>
            )}
          </div>
        </>
      )}
      {modelError && (
        <p className="break-words text-xs text-muted-foreground">
          {t("ai.modelDiscoveryFallback")}
        </p>
      )}
      {saveError && (
        <p role="alert" className="break-words text-xs text-destructive">
          {saveError}
        </p>
      )}
      {onExecutionModeChange && (
        <div className="min-w-0 space-y-1">
          <Select
            value={executionMode}
            disabled={disabled || saving}
            onValueChange={(value) =>
              onExecutionModeChange(value as ExecutionMode)
            }
          >
            <SelectTrigger
              className="h-9 w-full min-w-0 text-sm"
              aria-label={t("ai.executionMode")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[300]">
              <SelectItem value="isolated">
                {t("ai.executionIsolated")}
              </SelectItem>
              <SelectItem value="shared">{t("ai.executionShared")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="break-words text-[11px] text-muted-foreground">
            {t(
              executionMode === "shared"
                ? "ai.sharedExecutionHint"
                : "ai.isolatedExecutionHint",
            )}
          </p>
        </div>
      )}
      {provider && selected.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t("ai.noEnabledModels")}
        </p>
      )}
    </div>
  );
}
