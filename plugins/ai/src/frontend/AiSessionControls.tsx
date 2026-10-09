import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@termix/plugin-sdk/ui";
import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { getAiProviderModels, type AiProvider } from "./ai-api";

export type ApprovalMode = "review" | "auto";

interface Props {
  providers: AiProvider[];
  providerId: number | null;
  onProviderChange: (id: number) => void;
  model: string;
  onModelChange: (model: string) => void;
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  disabled: boolean;
}

/** Visible provider/model picker, with upstream discovery and a custom ID escape hatch. */
export function AiSessionControls({
  providers,
  providerId,
  onProviderChange,
  model,
  onModelChange,
  approvalMode,
  onApprovalModeChange,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const modelRef = useRef(model);
  modelRef.current = model;

  const provider = providers.find((item) => item.id === providerId);
  const defaultModel = provider?.defaultModel ?? "";

  useEffect(() => {
    let cancelled = false;
    setModelError(false);
    setModels(defaultModel ? [defaultModel] : []);
    setLoadingModels(Boolean(providerId));
    if (!modelRef.current.trim() && defaultModel) onModelChange(defaultModel);
    if (!providerId) return;

    getAiProviderModels(providerId)
      .then((upstream) => {
        if (cancelled) return;
        const choices = [...new Set([defaultModel, ...upstream].filter(Boolean))];
        setModels(choices);
        if (!modelRef.current.trim() && choices.length) {
          // A typed/custom model is never overwritten by slow discovery.
          onModelChange(choices[0]);
        }
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
  }, [providerId, defaultModel, onModelChange, refreshIndex]);

  const useCustomInput = customModel ||
    (Boolean(model) && !models.includes(model));

  return (
    <div className="space-y-2 px-3 pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={providerId ? String(providerId) : undefined}
          onValueChange={(value) => {
            setCustomModel(false);
            onModelChange("");
            onProviderChange(Number(value));
          }}
          disabled={disabled}
        >
          <SelectTrigger
            className="h-8 min-w-0 flex-1 rounded-none text-xs"
            aria-label={t("ai.selectProvider")}
          >
            <SelectValue placeholder={t("ai.selectProvider")} />
          </SelectTrigger>
          <SelectContent className="z-[200]">
            {providers.map((item) => (
              <SelectItem key={item.id} value={String(item.id)}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {models.length > 0 ? (
          <Select
            value={useCustomInput ? "__custom__" : model || undefined}
            onValueChange={(value) => {
              if (value === "__custom__") {
                setCustomModel(true);
                if (models.includes(model)) onModelChange("");
              } else {
                setCustomModel(false);
                onModelChange(value);
              }
            }}
            disabled={disabled || !providerId}
          >
            <SelectTrigger
              className="h-8 min-w-0 flex-1 rounded-none text-xs"
              aria-label={t("ai.modelPicker")}
            >
              <SelectValue placeholder={t("ai.modelPlaceholder")} />
            </SelectTrigger>
            <SelectContent className="z-[200]">
              {models.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
              <SelectItem value="__custom__">{t("ai.modelCustom")}</SelectItem>
            </SelectContent>
          </Select>
        ) : null}
        {(!models.length || useCustomInput) && (
          <Input
            className="h-8 min-w-0 flex-1 rounded-none text-xs"
            value={model}
            onChange={(event) => {
              setCustomModel(true);
              onModelChange(event.target.value);
            }}
            placeholder={t("ai.modelPlaceholder")}
            aria-label={models.length ? t("ai.modelCustomInput") : t("ai.modelPicker")}
            disabled={disabled || !providerId}
            autoComplete="off"
          />
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 shrink-0"
          title={t("ai.modelRefresh")}
          aria-label={t("ai.modelRefresh")}
          disabled={disabled || !providerId || loadingModels}
          onClick={() => setRefreshIndex((index) => index + 1)}
        >
          <RefreshCw size={14} className={loadingModels ? "animate-spin" : ""} />
        </Button>
      </div>
      {modelError && (
        <p className="text-[11px] text-muted-foreground">
          {t("ai.modelDiscoveryFallback")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={disabled}
          aria-pressed={approvalMode === "auto"}
          onClick={() => {
            if (approvalMode === "auto") {
              onApprovalModeChange("review");
              setConfirmAuto(false);
            } else setConfirmAuto((open) => !open);
          }}
        >
          {approvalMode === "auto" ? (
            <ShieldAlert size={13} />
          ) : (
            <ShieldCheck size={13} />
          )}
          {t(approvalMode === "auto" ? "ai.autoMode" : "ai.reviewMode")}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {t("ai.sessionModeHint")}
        </span>
      </div>
      {confirmAuto && (
        <div
          role="alert"
          className="space-y-2 border border-destructive/40 bg-destructive/10 p-2 text-xs"
        >
          <p>{t("ai.autoModeWarning")}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={disabled}
              onClick={() => {
                onApprovalModeChange("auto");
                setConfirmAuto(false);
              }}
            >
              {t("ai.enableAutoMode")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmAuto(false)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {approvalMode === "auto" && (
        <p role="status" className="text-[11px] text-destructive">
          {t("ai.autoModeActive")}
        </p>
      )}
    </div>
  );
}
