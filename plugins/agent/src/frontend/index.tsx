import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Bot } from "lucide-react";
import type { PanelProps, TabProps, TermixApp } from "@termix/plugin-sdk/frontend";
import { useTranslation } from "@termix/plugin-sdk/frontend";

let current: TermixApp | null = null;
function app(): TermixApp {
  if (!current) throw new Error("Local Agent is not active");
  return current;
}
function errorMessage(error: unknown): string {
  const value = error as {
    response?: { data?: { error?: string } };
    message?: string;
  };
  return value?.response?.data?.error ?? value?.message ?? "Request failed";
}
function Action({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
const scopeChoices = [
  "sessions:create",
  "sessions:read",
  "sessions:write",
  "sessions:close",
  "jobs:execute",
  "servers:create",
  "quick-connections:create",
  "files:read",
  "files:write",
];
type ManagedDevice = {
  id: string;
  name: string;
  fingerprint: string;
  accessMode: string;
  scopes: string[];
  revokedAt: string | null;
};
type Project = { id: string; name: string; hostIds: number[] };
type Lookup = { requestId: string; deviceName: string; fingerprint: string };
type Policy = {
  allowHttp: boolean;
  allowedCidrs: string[];
  locked: boolean;
  sourceAddress: string;
  canConfigure: boolean;
};
function LocalAgentPanel(_props: TabProps) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [accessMode, setAccessMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>(
    scopeChoices.filter((x) => x !== "files:write"),
  );
  const [maxSessions, setMaxSessions] = useState(1);
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function refresh() {
    const [deviceList, projectList] = await Promise.all([
      app().api.get<{ devices: ManagedDevice[] }>("/admin/devices"),
      app().api.get<{ projects: Project[] }>("/admin/projects"),
    ]);
    setDevices(deviceList.data.devices);
    setProjects(projectList.data.projects);
  }
  useEffect(() => {
    void refresh().catch((err) => setError(errorMessage(err)));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const http =
    window.location.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const skill =
    "https://github.com/luoquan0/Cat-Termix/tree/Cat-Termix/skills/cloudssh-agent";
  const script = navigator.userAgent.includes("Windows")
    ? "$env:USERPROFILE\\.agents\\skills\\cloudssh-agent\\scripts\\cloudssh.mjs"
    : "$HOME/.agents/skills/cloudssh-agent/scripts/cloudssh.mjs";
  const login =
    'node "' +
    script +
    '" auth login --url ' +
    window.location.origin +
    (http ? " --allow-http" : "");
  return (
    <div className="h-full overflow-y-auto p-4 space-y-5 text-sm">
      <div>
        <h2 className="text-xl font-semibold">{t("agent.title")}</h2>
        <p className="mt-1 text-muted-foreground">{t("agent.description")}</p>
      </div>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-green-600">
          {notice}
        </p>
      )}
      <section className="rounded-lg border p-4 space-y-3">
        <h3 className="font-semibold">{t("agent.howto")}</h3>
        <a
          href={skill}
          target="_blank"
          rel="noreferrer"
          className="break-all underline"
        >
          {skill}
        </a>
        <div className="flex gap-2 items-center">
          <code className="flex-1 break-all rounded bg-muted p-2">{login}</code>
          <Action onClick={() => void navigator.clipboard.writeText(login)}>
            {t("agent.copy")}
          </Action>
        </div>
        {http && <p className="text-amber-600">{t("agent.httpHelp")}</p>}
      </section>
      <section className="rounded-lg border p-4 space-y-3">
        <h3 className="font-semibold">{t("agent.verify")}</h3>
        <div className="flex flex-wrap gap-2">
          <input
            aria-label={t("agent.code")}
            value={code}
            maxLength={10}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            className="h-9 rounded-md border bg-background px-3 font-mono"
            placeholder="ABCD-1234"
          />
          <Action
            disabled={busy || code.replace(/\W/g, "").length !== 8}
            onClick={() =>
              void run(async () => {
                const result = await app().api.post<Lookup>(
                  "/admin/requests/resolve",
                  { code },
                );
                setLookup(result.data);
              })
            }
          >
            {t("agent.verify")}
          </Action>
        </div>
        {lookup && (
          <div className="space-y-3 border-t pt-3">
            <p className="font-semibold">{lookup.deviceName}</p>
            <p className="break-all font-mono text-xs">
              {t("agent.fingerprint")}: {lookup.fingerprint}
            </p>
            <fieldset>
              <legend className="font-semibold">{t("agent.scopes")}</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {scopeChoices.map((scope) => (
                  <label key={scope} className="flex gap-2 items-center">
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={(event) =>
                        setScopes((prev) =>
                          event.target.checked
                            ? [...prev, scope]
                            : prev.filter((x) => x !== scope),
                        )
                      }
                    />
                    <span className="font-mono text-xs">{scope}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-amber-600">{t("agent.scopeWrite")}</p>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="font-semibold">{t("agent.projects")}</legend>
              <label className="flex gap-2 items-center">
                <input
                  type="radio"
                  checked={accessMode === "all"}
                  onChange={() => setAccessMode("all")}
                />
                {t("agent.all")}
              </label>
              <label className="flex gap-2 items-center">
                <input
                  type="radio"
                  checked={accessMode === "selected"}
                  onChange={() => setAccessMode("selected")}
                />
                {t("agent.selected")}
              </label>
              {accessMode === "selected" &&
                projects.map((project) => (
                  <label key={project.id} className="flex gap-2 items-center">
                    <input
                      type="checkbox"
                      checked={selected.includes(project.id)}
                      onChange={(event) =>
                        setSelected((prev) =>
                          event.target.checked
                            ? [...prev, project.id]
                            : prev.filter((x) => x !== project.id),
                        )
                      }
                    />
                    {project.name} ({project.hostIds.length})
                  </label>
                ))}
            </fieldset>
            <label className="flex gap-2 items-center">
              {t("agent.maxSessions")}
              <input
                className="w-16 rounded border p-1"
                type="number"
                min={1}
                max={20}
                value={maxSessions}
                onChange={(event) => setMaxSessions(Number(event.target.value))}
              />
            </label>
            <label className="flex gap-2 items-center">
              {t("agent.expires")}
              <input
                className="rounded border p-1"
                type="datetime-local"
                value={expires}
                onChange={(event) => setExpires(event.target.value)}
              />
            </label>
            <div className="flex gap-2">
              <Action
                disabled={
                  busy ||
                  !scopes.length ||
                  (accessMode === "selected" && !selected.length)
                }
                onClick={() =>
                  void run(async () => {
                    await app().api.post(
                      "/admin/requests/" + lookup.requestId + "/approve",
                      {
                        code,
                        scopes,
                        accessMode,
                        projectIds: selected,
                        maxConcurrentSessions: maxSessions,
                        expiresAt: expires
                          ? new Date(expires).toISOString()
                          : null,
                      },
                    );
                    setLookup(null);
                    setCode("");
                    await refresh();
                    setNotice(t("agent.success"));
                  })
                }
              >
                {t("agent.approve")}
              </Action>
              <Action
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await app().api.post(
                      "/admin/requests/" + lookup.requestId + "/deny",
                      { code },
                    );
                    setLookup(null);
                    setCode("");
                  })
                }
              >
                {t("agent.deny")}
              </Action>
            </div>
          </div>
        )}
      </section>
      <section className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{t("agent.devices")}</h3>
          <Action disabled={busy} onClick={() => void run(refresh)}>
            {t("agent.refresh")}
          </Action>
        </div>
        {!devices.length && (
          <p className="text-muted-foreground">{t("agent.none")}</p>
        )}
        {devices.map((device) => (
          <div
            key={device.id}
            className="flex gap-3 justify-between border-t pt-3"
          >
            <div className="min-w-0">
              <p className="font-semibold">
                {device.name} {device.revokedAt ? "（已撤销）" : ""}
              </p>
              <p className="break-all font-mono text-xs">
                {device.fingerprint}
              </p>
              <p className="text-xs text-muted-foreground">
                {device.scopes.join(" · ")}
              </p>
            </div>
            {!device.revokedAt && (
              <Action
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("agent.confirmRevoke")))
                    void run(async () => {
                      await app().api.delete("/admin/devices/" + device.id);
                      await refresh();
                    });
                }}
              >
                {t("agent.revoke")}
              </Action>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
function AdminHttpSection() {
  const { t } = useTranslation();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [cidrs, setCidrs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function refresh() {
    const response = (await app().api.get<Policy>("/admin/transport-policy"))
      .data;
    setPolicy(response);
    setEnabled(response.allowHttp);
    setCidrs(response.allowedCidrs.join("\n"));
  }
  useEffect(() => {
    void refresh().catch((err) => setError(errorMessage(err)));
  }, []);
  async function save() {
    const selected = cidrs
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (enabled && !selected.length) {
      setError(t("agent.cidrs"));
      return;
    }
    if (!window.confirm(t("agent.notice"))) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await app().api.post("/admin/transport-policy", {
        allowHttp: enabled,
        allowedCidrs: selected,
      });
      await refresh();
      setNotice(t("agent.success"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-lg border p-3 space-y-3">
      <h3 className="font-semibold">{t("agent.httpTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("agent.notice")}</p>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-green-600">
          {notice}
        </p>
      )}
      {policy && (
        <>
          <p className="text-xs">
            {t("agent.status")}: {policy.sourceAddress}
          </p>
          <label className="flex gap-2 items-center">
            <input
              type="checkbox"
              role="switch"
              checked={enabled}
              disabled={busy || policy.locked || !policy.canConfigure}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            {t("agent.httpToggle")}
          </label>
          <label className="block">
            {t("agent.cidrs")}
            <textarea
              className="mt-2 w-full min-h-20 rounded-md border bg-background p-2 font-mono text-xs"
              disabled={busy || policy.locked || !policy.canConfigure}
              value={cidrs}
              onChange={(event) => setCidrs(event.target.value)}
            />
          </label>
          {policy.locked && (
            <p className="text-amber-600">{t("agent.locked")}</p>
          )}
          {!policy.canConfigure && (
            <p className="text-amber-600">{t("agent.onlyPrivate")}</p>
          )}
          <div className="flex gap-2">
            <Action
              disabled={busy || policy.locked || !policy.canConfigure}
              onClick={() => void save()}
            >
              {t("agent.save")}
            </Action>
            <Action
              disabled={busy}
              onClick={() =>
                void refresh().catch((err) => setError(errorMessage(err)))
              }
            >
              {t("agent.refresh")}
            </Action>
          </div>
        </>
      )}
    </section>
  );
}
export function activate(instance: TermixApp): void {
  current = instance;
  instance.onDispose(() => {
    current = null;
  });
  instance.registerRailItem({
    id: "agent",
    icon: Bot,
    titleKey: "nav.agent",
    order: 43,
    promotable: true,
    rightDockable: false,
    after: "ai",
  });
  // Rail items open sidebar panels; the tab registration alone cannot render
  // this view when its icon is clicked in the left navigation.
  instance.registerPanel("agent", LocalAgentPanel as ComponentType<PanelProps>);
  instance.registerTab("agent", LocalAgentPanel as ComponentType<TabProps>, {
    icon: Bot,
    titleKey: "nav.agent",
    singleton: true,
    hostless: true,
    panelFrame: true,
  });
  instance.registerExtension("system.adminSettings.sections", {
    id: "agent-lan-http",
    components: { section: AdminHttpSection },
  });
}
