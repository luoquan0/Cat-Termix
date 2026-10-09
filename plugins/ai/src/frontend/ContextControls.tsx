import { useEffect, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, Input } from "@termix/plugin-sdk/ui";
import { Loader2 } from "lucide-react";
import {
  estimateTextTokens,
  type ContextPolicy,
  type ContextUsage,
} from "../shared/context-policy";

export function ContextStatus({
  usage,
  policy,
  draft,
  onClick,
}: {
  usage: ContextUsage | null;
  policy: ContextPolicy;
  draft: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const tokens = (usage?.inputTokens ?? 0) + estimateTextTokens(draft);
  const percent = Math.round(
    ((tokens + policy.outputReserve) * 100) / policy.contextWindow,
  );
  const busy = usage?.state === "compacting";
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={`h-7 shrink-0 px-1 text-[10px] ${percent >= policy.threshold ? "text-destructive" : "text-muted-foreground"}`}
      aria-label={t("ai.contextUsage")}
      title={t("ai.contextUsageDetail", {
        tokens,
        reserve: policy.outputReserve,
        capacity: policy.contextWindow,
        count: usage?.compactions ?? 0,
        actual: usage?.actualInputTokens ?? "-",
      })}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : null}
      {busy
        ? t("ai.contextCompacting")
        : usage
          ? `${t("ai.contextShort")} ~${percent}%`
          : t("ai.contextPending")}
    </Button>
  );
}
export function ContextControls({
  value,
  onChange,
  disabled,
}: {
  value: ContextPolicy;
  onChange: (value: ContextPolicy) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="space-y-3 border-t border-border p-3"
      aria-label={t("ai.contextSettings")}
    >
      <h3 className="text-xs font-medium">{t("ai.contextSettings")}</h3>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value.autoCompact}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, autoCompact: e.target.checked })
          }
        />
        {t("ai.contextAutomatic")}
      </label>
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ["contextWindow", "ai.contextCapacity", 8192, 2000000, 1024],
            [
              "outputReserve",
              "ai.contextReserve",
              512,
              Math.min(65536, Math.floor(value.contextWindow / 2)),
              512,
            ],
            ["threshold", "ai.contextThreshold", 50, 90, 1],
            ["keepRecentTurns", "ai.contextRecent", 1, 20, 1],
          ] as const
        ).map(([key, label, min, max, step]) => (
          <label key={key} className="space-y-1 text-[11px]">
            <span>{t(label)}</span>
            <ContextNumber
              label={t(label)}
              value={value[key]}
              min={min}
              max={max}
              step={step}
              disabled={disabled}
              onChange={(n) => {
                const next = {
                  ...value,
                  [key]: Math.min(max, Math.max(min, n)),
                };
                next.outputReserve = Math.min(
                  next.outputReserve,
                  Math.floor(next.contextWindow / 2),
                );
                onChange(next);
              }}
            />
          </label>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("ai.contextExplanation")}
      </p>
    </section>
  );
}

function ContextNumber({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <Input
      type="number"
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      step={step}
      className="h-8"
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft);
        if (!Number.isSafeInteger(n)) {
          setDraft(String(value));
          return;
        }
        const next = Math.min(max, Math.max(min, n));
        setDraft(String(next));
        onChange(next);
      }}
    />
  );
}
