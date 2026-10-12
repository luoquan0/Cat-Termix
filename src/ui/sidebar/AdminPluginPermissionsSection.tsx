import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { getCapabilityInfo } from "@termix/plugin-sdk/capabilities";
import {
  getPlugins,
  grantPluginCapability,
  revokePluginCapability,
  type PluginSummary,
} from "@/api/plugins-api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/alert-dialog";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { AccordionSection } from "./AdminSettingsShared";

type CriticalApproval = { pluginId: string; name: string; capability: string };

export function AdminPluginPermissionsSection({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [approval, setApproval] = useState<CriticalApproval | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPlugins(await getPlugins());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
      toast.error(t("admin.pluginCapabilities.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  async function changeGrant(
    pluginId: string,
    capability: string,
    shouldGrant: boolean,
  ) {
    const key = pluginId + ":" + capability;
    setBusy(key);
    try {
      if (shouldGrant) await grantPluginCapability(pluginId, capability);
      else await revokePluginCapability(pluginId, capability);

      // Read back what core persisted. Do not optimistically display a root grant.
      const fresh = await getPlugins();
      const updated = fresh.find((plugin) => plugin.id === pluginId);
      if (
        !updated?.grantedCapabilities ||
        updated.grantedCapabilities.includes(capability) !== shouldGrant
      ) {
        throw new Error("Plugin capability grant was not confirmed");
      }
      setPlugins(fresh);
      setLoadFailed(false);
      toast.success(
        t(
          shouldGrant
            ? "admin.pluginCapabilities.approved"
            : "admin.pluginCapabilities.revoked",
        ),
      );
    } catch {
      setLoadFailed(true);
      toast.error(t("admin.pluginCapabilities.saveError"));
    } finally {
      setBusy(null);
    }
  }

  const visible = plugins.filter(
    (plugin) =>
      plugin.capabilities?.length &&
      plugin.grantedCapabilities &&
      (plugin.name.toLowerCase().includes(search.toLowerCase()) ||
        plugin.id.toLowerCase().includes(search.toLowerCase()) ||
        plugin.capabilities.some((capability) =>
          capability.toLowerCase().includes(search.toLowerCase()),
        )),
  );

  return (
    <>
      <AccordionSection
        label={t("admin.pluginCapabilities.section")}
        icon={<ShieldCheck className="size-3.5" />}
        open={open}
        onToggle={onToggle}
      >
        <div className="flex flex-col gap-3 pt-3">
          <p className="text-xs text-muted-foreground">
            {t("admin.pluginCapabilities.description")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("admin.pluginCapabilities.search")}
              aria-label={t("admin.pluginCapabilities.search")}
              className="min-w-0 flex-1 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={loading || busy !== null}
              onClick={() => void reload()}
            >
              {loading && <Loader2 className="size-3.5 animate-spin" />}
              {t("admin.pluginCapabilities.refresh")}
            </Button>
          </div>
          {loadFailed && (
            <p role="alert" className="text-xs text-destructive">
              {t("admin.pluginCapabilities.loadOrSaveError")}
            </p>
          )}
          {!loading && visible.length === 0 && (
            <p className="py-2 text-xs text-muted-foreground">
              {t("admin.pluginCapabilities.empty")}
            </p>
          )}
          {visible.map((plugin) => {
            const granted = plugin.grantedCapabilities ?? [];
            return (
              <details
                key={plugin.id}
                open={plugin.id === "agent" ? true : undefined}
                className="border border-border bg-card"
              >
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">
                  {plugin.name} ({granted.length}/
                  {plugin.capabilities?.length ?? 0})
                  {!plugin.enabled && (
                    <span className="ml-2 text-muted-foreground">
                      {t("admin.pluginCapabilities.disabled")}
                    </span>
                  )}
                </summary>
                <div className="border-t border-border px-3">
                  {plugin.capabilities?.map((capability) => {
                    const info = getCapabilityInfo(capability);
                    const isGranted = granted.includes(capability);
                    const isCritical = info?.risk === "critical";
                    const key = plugin.id + ":" + capability;
                    return (
                      <div
                        key={capability}
                        className="flex flex-col gap-2 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                            <span>{info ? t(info.titleKey) : capability}</span>
                            {isCritical && (
                              <span className="flex items-center gap-1 border border-destructive/50 px-1 text-destructive">
                                <AlertTriangle className="size-3" />
                                {t("admin.pluginCapabilities.critical")}
                              </span>
                            )}
                          </div>
                          <p className="break-all font-mono text-[11px] text-muted-foreground">
                            {capability}
                          </p>
                          {info && (
                            <p className="text-xs text-muted-foreground">
                              {t(info.consequenceKey)}
                            </p>
                          )}
                          <p className="text-[11px] text-muted-foreground">
                            {t(
                              isGranted
                                ? "admin.pluginCapabilities.granted"
                                : "admin.pluginCapabilities.notGranted",
                            )}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            busy !== null ||
                            loading ||
                            (!plugin.enabled && !isGranted)
                          }
                          onClick={() => {
                            if (isGranted) {
                              void changeGrant(plugin.id, capability, false);
                            } else if (isCritical) {
                              setApproval({
                                pluginId: plugin.id,
                                name: plugin.name,
                                capability,
                              });
                            } else {
                              void changeGrant(plugin.id, capability, true);
                            }
                          }}
                        >
                          {busy === key && (
                            <Loader2 className="size-3.5 animate-spin" />
                          )}
                          {t(
                            isGranted
                              ? "admin.pluginCapabilities.revoke"
                              : "admin.pluginCapabilities.grant",
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </AccordionSection>
      <AlertDialog
        open={approval !== null}
        onOpenChange={(next) => {
          if (!next) setApproval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.pluginCapabilities.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.pluginCapabilities.confirmDescription", {
                plugin: approval?.name ?? "",
                capability: approval?.capability ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={() => {
                if (!approval) return;
                void changeGrant(approval.pluginId, approval.capability, true);
              }}
            >
              {t("admin.pluginCapabilities.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
