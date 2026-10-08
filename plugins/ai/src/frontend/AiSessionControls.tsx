import { useEffect, useId, useState } from "react";
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
import { ShieldAlert, ShieldCheck } from "lucide-react";
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

/** The same provider/model and execution controls in standalone and SSH chat. */
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
  const listId = useId();
  const [models, setModels] = useState<string[]>([]);
  const [modelError, setModelError] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const provider = providers.find((item) => item.id === providerId);
  const defaultModel = provider?.defaultModel ?? "";

  useEffect(() => {
    let cancelled = false;
    setModels(defaultModel ? [defaultModel] : []);
    setModelError(false);
    onModelChange(defaultModel);
    if (!providerId) return;
    getAiProviderModels(providerId)
      .then((list) => {
        if (cancelled) return;
        const choices = [...new Set([defaultModel, ...list].filter(Boolean))];
        setModels(choices);
        // Do not overwrite a model the user typed while discovery was in flight.
      })
      .catch(() => {
        if (!cancelled) setModelError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, defaultModel, onModelChange]);

  return (
    <div className="space-y-2 px-3 pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={providerId ? String(providerId) : undefined}
          onValueChange={(value) => onProviderChange(Number(value))}
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
        <Input
          className="h-8 min-w-0 flex-1 rounded-none text-xs"
          list={listId}
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          placeholder={t("ai.modelPlaceholder")}
          aria-label={t("ai.modelPicker")}
          disabled={disabled || !providerId}
          autoComplete="off"
        />
        <datalist id={listId}>
          {models.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
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
