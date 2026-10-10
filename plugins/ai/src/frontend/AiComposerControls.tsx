import { useEffect, useState } from "react";
import { BrainCircuit, Layers3 } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@termix/plugin-sdk/ui";
import { getAiProviderModels, type AiProvider } from "./ai-api";
import { REASONING_EFFORTS, type ReasoningEffort } from "../shared/reasoning";

interface Props {
  providers: AiProvider[];
  providerId: number | null;
  model: string;
  reasoningEffort: ReasoningEffort;
  disabled: boolean;
  onChooseModel: (providerId: number, model: string) => void;
  onReasoningChange: (effort: ReasoningEffort) => void;
}

/** A provider-scoped selection key: the same model ID may exist at two URLs. */
export function AiComposerControls({
  providers,
  providerId,
  model,
  reasoningEffort,
  disabled,
  onChooseModel,
  onReasoningChange,
}: Props) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<Record<number, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      providers.map(async (provider) => {
        try {
          return [provider.id, await getAiProviderModels(provider.id)] as const;
        } catch {
          return [provider.id, []] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setCatalog(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [providers]);

  const selected = providers.find((p) => p.id === providerId);
  const selectedValue = providerId && model ? `${providerId}:${model}` : undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <Select
        value={selectedValue}
        disabled={disabled || !providers.length}
        onValueChange={(value) => {
          const colon = value.indexOf(":");
          const id = Number(value.slice(0, colon));
          const chosen = value.slice(colon + 1);
          if (colon >= 0 && chosen && providers.some((p) => p.id === id))
            onChooseModel(id, chosen);
        }}
      >
        <SelectTrigger
          aria-label={t("ai.modelPicker")}
          className="h-8 w-auto max-w-[min(75vw,285px)] min-w-[110px] rounded-full border-border/70 bg-muted/70 px-3 text-xs"
        >
          <Layers3 size={13} className="shrink-0" />
          <span className="min-w-0 truncate">{model || t("ai.modelPlaceholder")}</span>
          {selected && (
            <span className="hidden max-w-24 shrink-0 truncate text-muted-foreground sm:inline">
              · {selected.label}
            </span>
          )}
        </SelectTrigger>
        <SelectContent className="z-[300] max-h-[min(65vh,380px)] min-w-[230px]">
          {providers.map((provider) => {
            const options = [...new Set([
              provider.defaultModel,
              ...(catalog[provider.id] ?? []),
              ...(provider.id === providerId ? [model] : []),
            ].filter((value): value is string => Boolean(value)))];
            return (
              <SelectGroup key={provider.id}>
                <SelectLabel>
                  {provider.label}
                  <span className="ml-2 text-[10px] text-muted-foreground">
                    {provider.providerType}
                  </span>
                </SelectLabel>
                {options.map((name) => (
                  <SelectItem key={name} value={`${provider.id}:${name}`}>
                    <span className="flex min-w-0 items-center justify-between gap-3">
                      <span className="truncate">{name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {provider.label}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
      <Select
        value={reasoningEffort}
        onValueChange={(value) => onReasoningChange(value as ReasoningEffort)}
        disabled={disabled || !providerId}
      >
        <SelectTrigger
          aria-label={t("ai.reasoningEffort")}
          className="h-8 w-auto max-w-[130px] rounded-full border-border/70 bg-muted/70 px-3 text-xs"
        >
          <BrainCircuit size={13} className="shrink-0" />
          <span className="truncate">{t(`ai.reasoning.${reasoningEffort}`)}</span>
        </SelectTrigger>
        <SelectContent className="z-[300]">
          {REASONING_EFFORTS.map((effort) => (
            <SelectItem key={effort} value={effort}>
              {t(`ai.reasoning.${effort}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
