import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, Input } from "@termix/plugin-sdk/ui";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { aiApp } from "./app-ref";
import type { UpdateInfo } from "../shared/update-policy";

const activePhases = new Set([
  "checking",
  "downloading",
  "backing_up",
  "verifying",
  "rolling_back",
]);

export function UpdateSettings() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hours, setHours] = useState(6);
  const [proxy, setProxy] = useState("");
  const [proxyChanged, setProxyChanged] = useState(false);
  const [busyAction, setBusyAction] = useState<
    "save" | "check" | "apply" | null
  >(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false);

  const refresh = useCallback(async () => {
    const response = await aiApp().api.get<UpdateInfo>("/updates");
    setInfo(response.data);
    setPollError(false);
    return response.data;
  }, []);

  useEffect(() => {
    let live = true;
    void aiApp()
      .api.get<UpdateInfo>("/updates")
      .then(({ data }) => {
        if (!live) return;
        setInfo(data);
        if (data.canManage) {
          setEnabled(data.policy.enabled);
          setHours(data.policy.intervalHours);
          setProxy(data.policy.proxyUrl);
        }
      })
      .catch(() => {
        if (live) setError(t("ai.updateLoadError"));
      });
    return () => {
      live = false;
    };
  }, [t]);

  const requestActive =
    info?.request?.state === "queued" || info?.request?.state === "running";
  const phaseActive =
    Boolean(info?.installed) && activePhases.has(info?.status?.phase ?? "");
  const isWorking = busyAction !== null || requestActive || phaseActive;

  // The helper polls for manual requests every 15 seconds. Poll the
  // authenticated state quickly while busy, then return to low-rate polling.
  // This also restores correct progress if the settings page is reopened.
  useEffect(() => {
    if (!info?.canManage) return;
    const timer = setInterval(
      () => {
        void refresh().catch(() => setPollError(true));
      },
      requestActive || phaseActive ? 2000 : 10000,
    );
    return () => clearInterval(timer);
  }, [info?.canManage, requestActive, phaseActive, refresh]);

  const action = async (name: "save" | "check" | "apply") => {
    setBusyAction(name);
    setError(null);
    try {
      await aiApp().api.put("/updates", {
        enabled,
        intervalHours: hours,
        proxyUrl: proxy,
        keepProxy: !proxyChanged,
      });
      if (name !== "save") {
        // The response is HTTP 202 (queued), not proof that the check is done.
        await aiApp().api.post("/updates/" + name, {
          confirmRestart: name === "apply",
        });
      }
      setConfirm(false);
      setProxyChanged(false);
      await refresh();
    } catch {
      setError(t("ai.updateActionError"));
    } finally {
      setBusyAction(null);
    }
  };

  const request = info?.request;
  const phase = info?.status?.phase;
  let feedback = t("ai.updateIdle");
  if (busyAction === "check") {
    feedback = t("ai.updateSubmittingCheck");
  } else if (busyAction === "apply") {
    feedback = t("ai.updateSubmittingApply");
  } else if (busyAction === "save") {
    feedback = t("ai.updateSaving");
  } else if (request?.state === "queued") {
    feedback = t("ai.updateQueued");
  } else if (request?.state === "running") {
    feedback =
      request.action === "check"
        ? t("ai.updateCheckingUpstream")
        : phase === "downloading"
          ? t("ai.updateDownloading")
          : phase === "backing_up"
            ? t("ai.updateBackingUp")
            : phase === "verifying"
              ? t("ai.updateVerifying")
              : phase === "rolling_back"
                ? t("ai.updateRollingBack")
                : t("ai.updateApplying");
  } else if (request?.state === "timed_out") {
    feedback = t("ai.updateCheckTimedOut");
  } else if (request?.state === "failed") {
    feedback = t("ai.updateCheckFailed");
  } else if (request?.state === "completed") {
    feedback =
      request.action === "check"
        ? phase === "available"
          ? t("ai.updateFound")
          : t("ai.updateLatest")
        : phase === "deferred"
          ? t("ai.updateDeferred")
          : phase === "current"
            ? t("ai.updateLatest")
            : t("ai.updateApplied");
  } else if (phase === "error") {
    feedback = t("ai.updateCheckFailed");
  } else if (phase === "checking") {
    feedback = t("ai.updateCheckingUpstream");
  } else if (phase === "downloading") {
    feedback = t("ai.updateDownloading");
  } else if (phase === "backing_up") {
    feedback = t("ai.updateBackingUp");
  } else if (phase === "verifying") {
    feedback = t("ai.updateVerifying");
  } else if (phase === "rolling_back") {
    feedback = t("ai.updateRollingBack");
  } else if (phase === "available") {
    feedback = t("ai.updateFound");
  } else if (phase === "current") {
    feedback = t("ai.updateLatest");
  } else if (phase === "updated") {
    feedback = t("ai.updateApplied");
  } else if (phase === "deferred") {
    feedback = t("ai.updateDeferred");
  }
  const failed =
    request?.state === "failed" ||
    request?.state === "timed_out" ||
    (!request && phase === "error");
  const lastCheckAt = info?.status?.lastCheckAt;
  const lastCheck =
    lastCheckAt && Number.isFinite(Date.parse(lastCheckAt))
      ? new Date(lastCheckAt).toLocaleString()
      : null;

  // Only show administrator controls after the server confirms both grants.
  if (!info?.canManage) return null;
  return (
    <details
      data-testid="system-software-updates"
      className="group shrink-0 overflow-hidden border border-border bg-card"
    >
      <summary className="flex w-full cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <RefreshCw
          size={14}
          className={
            isWorking
              ? "shrink-0 animate-spin text-primary"
              : "shrink-0 text-muted-foreground"
          }
          aria-hidden="true"
        />
        <span className="flex-1 text-xs font-bold uppercase tracking-widest text-foreground">
          {t("ai.updateSettings")}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 text-xs">
        <p className="text-muted-foreground">{t("ai.updateScope")}</p>
        {!info.installed && <p role="alert">{t("ai.updateInstallHint")}</p>}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={isWorking}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          {t("ai.updateAutomatic")}
        </label>
        <p className="text-destructive">{t("ai.updateRestartWarning")}</p>
        <label className="block space-y-1">
          {t("ai.updateInterval")}
          <Input
            type="number"
            min={1}
            max={168}
            value={hours}
            disabled={isWorking}
            onChange={(event) =>
              setHours(
                Math.min(168, Math.max(1, Number(event.target.value) || 6)),
              )
            }
          />
        </label>
        <label className="block space-y-1">
          {t("ai.updateProxy")}
          <Input
            value={proxy}
            disabled={isWorking}
            placeholder="http://192.168.1.2:7890"
            autoComplete="off"
            onChange={(event) => {
              setProxy(event.target.value);
              setProxyChanged(true);
            }}
          />
        </label>
        <p className="text-[11px] text-muted-foreground">
          {t("ai.updateProxyHint")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={isWorking}
            onClick={() => void action("save")}
          >
            {t("common.save")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isWorking || !info.installed}
            onClick={() => void action("check")}
          >
            {(busyAction === "check" ||
              (request?.action === "check" && requestActive) ||
              phase === "checking") && (
              <Loader2
                size={14}
                className="mr-1 inline animate-spin"
                aria-hidden="true"
              />
            )}
            {busyAction === "check" ||
            (request?.action === "check" && requestActive)
              ? t("ai.updateChecking")
              : t("ai.updateCheck")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isWorking || !info.installed}
            onClick={() => setConfirm(true)}
          >
            {t("ai.updateApply")}
          </Button>
        </div>
        {confirm && (
          <div role="alert" className="space-y-2 border border-destructive p-2">
            <p>{t("ai.updateRestartWarning")}</p>
            <Button
              size="sm"
              variant="destructive"
              disabled={isWorking}
              onClick={() => void action("apply")}
            >
              {t("ai.updateConfirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        )}
        <div
          data-testid="updater-progress"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="space-y-1.5 rounded-md border border-border p-2 text-[11px]"
        >
          <div className="flex items-center gap-2">
            {isWorking ? (
              <Loader2
                size={14}
                className="shrink-0 animate-spin text-primary"
                aria-hidden="true"
              />
            ) : failed ? (
              <AlertCircle
                size={14}
                className="shrink-0 text-destructive"
                aria-hidden="true"
              />
            ) : request?.state === "completed" ||
              phase === "current" ||
              phase === "available" ||
              phase === "updated" ? (
              <CheckCircle2
                size={14}
                className="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <Clock3
                size={14}
                className="shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span className={failed ? "text-destructive" : "font-medium"}>
              {feedback}
            </span>
          </div>
          {info.status?.message && (failed || phase === "deferred") && (
            <p className="break-words text-muted-foreground">
              {info.status.message}
            </p>
          )}
          {lastCheck && (
            <p className="text-muted-foreground">
              {t("ai.updateLastCheck")}: {lastCheck}
            </p>
          )}
          <p className="break-words font-mono">
            {t("ai.updateCurrent")}:{" "}
            {info.status?.currentRevision?.slice(0, 12) ?? "-"}
          </p>
          <p className="break-words font-mono">
            {t("ai.updateAvailable")}:{" "}
            {info.status?.availableRevision?.slice(0, 12) ?? "-"}
          </p>
        </div>
        {pollError && (
          <p role="alert" className="text-destructive">
            {t("ai.updateRefreshError")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
