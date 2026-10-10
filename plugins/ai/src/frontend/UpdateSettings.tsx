import { useEffect, useState } from "react";
import { useTranslation } from "@termix/plugin-sdk/frontend";
import { Button, Input } from "@termix/plugin-sdk/ui";
import { ChevronDown, RefreshCw } from "lucide-react";
import { aiApp } from "./app-ref";
import type { UpdateInfo } from "../shared/update-policy";

export function UpdateSettings() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hours, setHours] = useState(6);
  const [proxy, setProxy] = useState("");
  const [proxyChanged, setProxyChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    const response = await aiApp().api.get<UpdateInfo>("/updates");
    setInfo(response.data);
    return response.data;
  };
  useEffect(() => {
    let live = true;
    aiApp()
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
    const timer = setInterval(() => {
      if (live) void refresh().catch(() => undefined);
    }, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [t]);
  const action = async (name: "save" | "check" | "apply") => {
    setBusy(true);
    setError(null);
    try {
      await aiApp().api.put("/updates", {
        enabled,
        intervalHours: hours,
        proxyUrl: proxy,
        keepProxy: !proxyChanged,
      });
      if (name !== "save")
        await aiApp().api.post(`/updates/${name}`, {
          confirmRestart: name === "apply",
        });
      setConfirm(false);
      setProxyChanged(false);
      await refresh();
    } catch {
      setError(t("ai.updateActionError"));
    } finally {
      setBusy(false);
    }
  };
  // Only show the section after the server confirms both administrator
  // settings permission and the scoped update-management permission.
  if (!info?.canManage) return null;
  return (
    <details
      data-testid="system-software-updates"
      className="group shrink-0 overflow-hidden border border-border bg-card"
    >
      <summary className="flex w-full cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
        <RefreshCw size={14} className="shrink-0 text-muted-foreground" />
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
        {!info?.installed && <p role="status">{t("ai.updateInstallHint")}</p>}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(e) => setEnabled(e.target.checked)}
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
            disabled={busy}
            onChange={(e) =>
              setHours(Math.min(168, Math.max(1, Number(e.target.value) || 6)))
            }
          />
        </label>
        <label className="block space-y-1">
          {t("ai.updateProxy")}
          <Input
            value={proxy}
            disabled={busy}
            placeholder="http://192.168.1.2:7890"
            autoComplete="off"
            onChange={(e) => {
              setProxy(e.target.value);
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
            disabled={busy || !info?.canManage}
            onClick={() => void action("save")}
          >
            {t("common.save")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !info?.installed}
            onClick={() => void action("check")}
          >
            {t("ai.updateCheck")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !info?.installed}
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
              disabled={busy}
              onClick={() => void action("apply")}
            >
              {t("ai.updateConfirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        )}
        {info?.status && (
          <p role="status" className="break-words text-[11px]">
            {info.status.phase} {info.status.message}
            <br />
            {t("ai.updateCurrent")}:{" "}
            {info.status.currentRevision?.slice(0, 12) ?? "-"}
            <br />
            {t("ai.updateAvailable")}:{" "}
            {info.status.availableRevision?.slice(0, 12) ?? "-"}
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
