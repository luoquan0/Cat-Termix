import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button } from "@termix/plugin-sdk/ui";
import type { ApprovalMode } from "./AiSessionControls";

/** An explicit, session-only one-click switch. RBAC and audit logging remain enabled. */
export function ApprovalToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={`h-7 shrink-0 text-[11px] ${mode === "auto" ? "border-destructive text-destructive" : ""}`}
      aria-pressed={mode === "auto"}
      disabled={disabled}
      aria-label={t(mode === "auto" ? "ai.autoModeCompact" : "ai.reviewMode")}
      title={t(mode === "auto" ? "ai.disableAutoHint" : "ai.enableAutoHint")}
      onClick={() => onChange(mode === "auto" ? "review" : "auto")}
    >
      {mode === "auto" ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
      {t(mode === "auto" ? "ai.autoModeCompact" : "ai.reviewMode")}
    </Button>
  );
}
