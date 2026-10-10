import { toast } from "sonner";
import type { UpdateInfo, UpdateStatus } from "../shared/update-policy.js";

/**
 * The updater runs outside the app container. An accepted update request can
 * close every socket in this page before the app can report its success.
 * Keep the reload intent in tab session storage; a small plugin-level monitor
 * survives closing system settings and can wait for the new backend to return.
 */
export const UPDATE_RESTART_INTENT_KEY = "cat-termix:update-restart-intent";
export const UPDATE_RESTART_SUCCESS_KEY = "cat-termix:update-restart-success";

const MAX_WAIT_MS = 30 * 60 * 1000;
const POLL_MS = 2000;
type RecoveryTrigger = "manual" | "automatic";
export type RecoveryPhase = "idle" | "waiting" | "reconnecting" | "reloading";

export interface UpdateRestartIntent {
  trigger: RecoveryTrigger;
  requestId: string | null;
  previousRevision: string | null;
  previousSuccessAt: string | null;
  startedAt: number;
}

type Notice = "success" | "error" | "info";
type RecoveryOptions = {
  now?: () => number;
  reload?: () => void;
  notify?: (kind: Notice, message: string) => void;
};

let memoryIntent: UpdateRestartIntent | null = null;
let phase: RecoveryPhase = "idle";
const subscribers = new Set<(next: RecoveryPhase) => void>();

function storageGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, data: string): void {
  try {
    window.sessionStorage.setItem(key, data);
  } catch {
    // Private browsing and restrictive browsers may deny sessionStorage.
    // The in-memory intent still works until the page reloads.
  }
}
function storageRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing to remove if session storage is unavailable.
  }
}
function setRecoveryPhase(next: RecoveryPhase): void {
  if (phase === next) return;
  phase = next;
  for (const fn of subscribers) fn(next);
}
export function getUpdateRecoveryPhase(): RecoveryPhase {
  return phase;
}
export function subscribeUpdateRecovery(
  fn: (next: RecoveryPhase) => void,
): () => void {
  subscribers.add(fn);
  fn(phase);
  return () => subscribers.delete(fn);
}
export function readUpdateRestartIntent(): UpdateRestartIntent | null {
  const raw = storageGet(UPDATE_RESTART_INTENT_KEY);
  if (!raw) return memoryIntent;
  try {
    const parsed = JSON.parse(raw) as UpdateRestartIntent;
    if (
      (parsed.trigger === "manual" || parsed.trigger === "automatic") &&
      Number.isFinite(parsed.startedAt) &&
      parsed.startedAt > 0 &&
      (parsed.requestId === null || typeof parsed.requestId === "string") &&
      (parsed.previousRevision === null ||
        typeof parsed.previousRevision === "string") &&
      (parsed.previousSuccessAt === null ||
        typeof parsed.previousSuccessAt === "string")
    ) {
      return parsed;
    }
  } catch {
    // A stale/corrupt browser record must not trigger unexpected reloads.
  }
  storageRemove(UPDATE_RESTART_INTENT_KEY);
  return memoryIntent;
}
export function clearUpdateRestartIntent(): void {
  memoryIntent = null;
  storageRemove(UPDATE_RESTART_INTENT_KEY);
  setRecoveryPhase("idle");
}

export function armUpdateRestart(
  status: UpdateStatus | null | undefined,
  trigger: RecoveryTrigger,
  requestId: string | null,
  now = Date.now(),
): void {
  // Do not overwrite a live manual request with background observations.
  if (trigger === "automatic" && readUpdateRestartIntent()) return;
  const intent: UpdateRestartIntent = {
    trigger,
    requestId,
    previousRevision: status?.currentRevision ?? null,
    previousSuccessAt: status?.lastSuccessAt ?? null,
    startedAt: now,
  };
  memoryIntent = intent;
  storageSet(UPDATE_RESTART_INTENT_KEY, JSON.stringify(intent));
  setRecoveryPhase("waiting");
}

/** Never refresh for checks, old "updated" statuses or unverified restarts. */
/** Compare two authenticated app snapshots to catch scheduled auto-installs. */
export function isObservedAutomaticReplacement(
  before: UpdateInfo | null,
  after: UpdateInfo,
): boolean {
  const previous = before?.status;
  const latest = after.status;
  return Boolean(
    before?.canManage &&
      before.installed &&
      after.canManage &&
      after.installed &&
      previous?.currentRevision &&
      latest?.currentRevision &&
      previous.currentRevision !== latest.currentRevision &&
      latest.phase === "updated" &&
      latest.lastSuccessAt &&
      previous.lastSuccessAt !== latest.lastSuccessAt,
  );
}

export function isVerifiedReplacement(
  intent: UpdateRestartIntent,
  info: UpdateInfo,
): boolean {
  const current = info.status?.currentRevision;
  if (!info.canManage || !info.installed || info.status?.phase !== "updated")
    return false;
  if (!current || !info.status?.lastSuccessAt) return false;
  if (intent.previousRevision && current === intent.previousRevision)
    return false;
  if (
    intent.previousSuccessAt &&
    info.status.lastSuccessAt === intent.previousSuccessAt
  )
    return false;
  if (
    intent.trigger === "manual" &&
    (!intent.requestId || info.status.lastRequest !== intent.requestId)
  )
    return false;
  // The helper only writes phase='updated' AFTER it confirms a healthy
  // replacement container. The new app must respond to the authorized API.
  return true;
}

function displayMessage(kind: Notice, english: string, chinese: string): void {
  const message =
    typeof navigator !== "undefined" &&
    navigator.language.toLowerCase().startsWith("zh")
      ? chinese
      : english;
  if (kind === "success") toast.success(message);
  else if (kind === "error") toast.error(message);
  else toast.info(message);
}
const defaultNotify = (kind: Notice, message: string) => {
  if (kind === "success")
    displayMessage(
      kind,
      "Cat-Termix updated successfully. The page was refreshed.",
      "Cat-Termix 更新成功，页面已自动刷新。",
    );
  else if (kind === "error")
    displayMessage(kind, message, "更新未完成，请检查更新器状态。");
  else displayMessage(kind, message, "Cat-Termix 已是最新版本或更新已延后。");
};

export function consumeUpdateSuccessNotification(
  notify: (kind: Notice, message: string) => void = defaultNotify,
): void {
  const raw = storageGet(UPDATE_RESTART_SUCCESS_KEY);
  if (!raw) return;
  storageRemove(UPDATE_RESTART_SUCCESS_KEY);
  try {
    const saved = JSON.parse(raw) as { completedAt: number; revision: string };
    if (
      typeof saved.revision === "string" &&
      Number.isFinite(saved.completedAt) &&
      Date.now() - saved.completedAt < MAX_WAIT_MS
    ) {
      notify(
        "success",
        "Cat-Termix updated successfully. The page was refreshed.",
      );
    }
  } catch {
    // Ignore invalid session storage.
  }
}

export async function pollUpdateRestartOnce(
  getUpdateInfo: () => Promise<UpdateInfo>,
  options: RecoveryOptions = {},
): Promise<void> {
  const intent = readUpdateRestartIntent();
  if (!intent || phase === "reloading") return;
  const now = options.now?.() ?? Date.now();
  const notify = options.notify ?? defaultNotify;
  if (
    now - intent.startedAt > MAX_WAIT_MS ||
    intent.startedAt > now + MAX_WAIT_MS
  ) {
    clearUpdateRestartIntent();
    notify("error", "Update took too long. Check the updater logs.");
    return;
  }
  let info: UpdateInfo;
  try {
    info = await getUpdateInfo();
  } catch {
    // The old container may be stopping, or the new one may be starting.
    setRecoveryPhase("reconnecting");
    return;
  }
  if (isVerifiedReplacement(intent, info)) {
    clearUpdateRestartIntent();
    storageSet(
      UPDATE_RESTART_SUCCESS_KEY,
      JSON.stringify({
        completedAt: now,
        revision: info.status!.currentRevision!,
      }),
    );
    setRecoveryPhase("reloading");
    (options.reload ?? (() => window.location.reload()))();
    return;
  }

  // Never reload for a failed check, no-op update, or deferred installation.
  if (
    intent.trigger === "manual" &&
    info.request?.id === intent.requestId &&
    ["failed", "timed_out"].includes(info.request.state)
  ) {
    clearUpdateRestartIntent();
    notify("error", info.status?.message ?? "Update failed");
    return;
  }
  if (
    intent.trigger === "manual" &&
    info.request?.id === intent.requestId &&
    info.request.state === "completed" &&
    (info.status?.phase === "current" || info.status?.phase === "deferred")
  ) {
    clearUpdateRestartIntent();
    notify("info", "There is no new build, or the update was deferred.");
    return;
  }
  if (
    info.status?.phase === "error" &&
    (intent.trigger === "automatic" ||
      info.status.lastRequest === intent.requestId)
  ) {
    clearUpdateRestartIntent();
    notify("error", info.status.message ?? "Update failed");
    return;
  }
  setRecoveryPhase("waiting");
}

export function startUpdateRestartMonitor(
  getUpdateInfo: () => Promise<UpdateInfo>,
  options: RecoveryOptions = {},
): () => void {
  consumeUpdateSuccessNotification(options.notify);
  let polling = false;
  let stopped = false;
  let lastIdlePoll = 0;
  let previousInfo: UpdateInfo | null = null;
  const run = async () => {
    if (stopped || polling) return;
    const pending = readUpdateRestartIntent();
    const now = options.now?.() ?? Date.now();
    // Nothing is fetched every 2 seconds when idle. This low-rate baseline
    // catches unattended auto-installs even with the settings drawer closed.
    if (!pending && now - lastIdlePoll < 10000) return;
    polling = true;
    try {
      if (pending) {
        await pollUpdateRestartOnce(getUpdateInfo, options);
        return;
      }
      lastIdlePoll = now;
      let info: UpdateInfo;
      try {
        info = await getUpdateInfo();
      } catch {
        // A brief outage is expected while the updater stops the old app.
        return;
      }
      if (!info.canManage || !info.installed || !info.status) {
        previousInfo = null;
        return;
      }
      if (isObservedAutomaticReplacement(previousInfo, info)) {
        armUpdateRestart(previousInfo?.status, "automatic", null, now);
        await pollUpdateRestartOnce(async () => info, options);
      } else if (
        info.status.phase === "downloading" ||
        info.status.phase === "backing_up" ||
        info.status.phase === "verifying"
      ) {
        armUpdateRestart(info.status, "automatic", null, now);
      }
      previousInfo = info;
    } finally {
      polling = false;
    }
  };
  const timer = window.setInterval(() => void run(), POLL_MS);
  void run();
  return () => {
    stopped = true;
    window.clearInterval(timer);
    subscribers.clear();
  };
}
