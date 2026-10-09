import { useState } from "react";
import { useAiModels, type ModelDiscovery } from "./use-ai-models";
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
import { RefreshCw } from "lucide-react";
import { type AiProvider } from "./ai-api";

export type ApprovalMode = "review" | "auto";
export type ExecutionMode = "isolated" | "shared";

interface Props {
  providers: AiProvider[];
  providerId: number | null;
  onProviderChange: (id: number) => void;
  model: string;
  onModelChange: (model: string) => void;
  discovery?: ModelDiscovery;
  disabled: boolean;
  executionMode?: ExecutionMode;
  onExecutionModeChange?: (mode: ExecutionMode) => void;
}

/** Visible provider/model picker, with upstream discovery and a custom ID escape hatch. */
export function AiSessionControls({
  providers,
  providerId,
  onProviderChange,
  model,
  onModelChange,
  discovery,
  disabled,
  executionMode = "isolated",
  onExecutionModeChange,
}: Props) {
  const { t } = useTranslation();
  const [customModel, setCustomModel] = useState(false);
  const defaultModel =
    providers.find((item) => item.id === providerId)?.defaultModel ?? "";
  const localDiscovery = useAiModels(
    providerId,
    defaultModel,
    model,
    onModelChange,
    !discovery,
  );
  const { models, loadingModels, modelError, refresh } =
    discovery ?? localDiscovery;

  const useCustomInput =
    customModel || (Boolean(model) && !models.includes(model));

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
          <SelectContent className="z-[300]">
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
            <SelectContent className="z-[300]">
              {models.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
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
            aria-label={
              models.length ? t("ai.modelCustomInput") : t("ai.modelPicker")
            }
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
          onClick={() => refresh()}
        >
          <RefreshCw
            size={14}
            className={loadingModels ? "animate-spin" : ""}
          />
        </Button>
      </div>
      {onExecutionModeChange && (
        <div className="space-y-1">
          <Select
            value={executionMode}
            disabled={disabled}
            onValueChange={(value) =>
              onExecutionModeChange(value as ExecutionMode)
            }
          >
            <SelectTrigger
              className="h-8 w-full text-xs"
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
          <p className="text-[11px] text-muted-foreground">
            {t(
              executionMode === "shared"
                ? "ai.sharedExecutionHint"
                : "ai.isolatedExecutionHint",
            )}
          </p>
        </div>
      )}
      {modelError && (
        <p className="text-[11px] text-muted-foreground">
          {t("ai.modelDiscoveryFallback")}
        </p>
      )}
    </div>
  );
}
