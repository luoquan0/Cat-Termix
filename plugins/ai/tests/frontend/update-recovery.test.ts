import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateInfo } from "../../src/shared/update-policy";
import {
  UPDATE_RESTART_INTENT_KEY,
  UPDATE_RESTART_SUCCESS_KEY,
  armUpdateRestart,
  clearUpdateRestartIntent,
  consumeUpdateSuccessNotification,
  getUpdateRecoveryPhase,
  isVerifiedReplacement,
  pollUpdateRestartOnce,
  readUpdateRestartIntent,
  startUpdateRestartMonitor,
} from "../../src/frontend/update-recovery";

const oldRevision = "a".repeat(40);
const newRevision = "b".repeat(40);
const reqId = "d38726d1-d817-44a2-a7b6-1580fc2a9141";
const now = Date.now();
const baseStatus: NonNullable<UpdateInfo["status"]> = {
  phase: "available",
  currentRevision: oldRevision,
  availableRevision: newRevision,
  lastSuccessAt: "2026-10-09T13:00:00.000Z",
};
function updaterInfo(status: UpdateInfo["status"], state?: "queued" | "running" | "completed" | "failed"): UpdateInfo {
  return {
    canManage: true,
    installed: true,
    policy: { enabled: false, intervalHours: 6, proxyUrl: "" },
    proxyConfigured: false,
    status,
    request: state
      ? {
          id: reqId,
          action: "apply",
          requestedAt: new Date(now).toISOString(),
          state,
        }
      : null,
  };
}
beforeEach(() => {
  clearUpdateRestartIntent();
  window.sessionStorage.clear();
});

describe("Docker replacement browser recovery", () => {
  it("never reloads from a stale success, mere check or unconfirmed startup", async () => {
    const reload = vi.fn();
    const notify = vi.fn();
    armUpdateRestart(baseStatus, "manual", reqId, now);
    const old = updaterInfo(
      { ...baseStatus, phase: "updated", lastRequest: reqId }, "running",
    );
    expect(isVerifiedReplacement(readUpdateRestartIntent()!, old)).toBe(false);
    await pollUpdateRestartOnce(async () => old, { now: () => now + 5000, reload, notify });
    expect(reload).not.toHaveBeenCalled();

    const checking = updaterInfo({
      ...baseStatus, phase: "checking", lastRequest: reqId,
    }, "running");
    await pollUpdateRestartOnce(async () => checking, { now: () => now + 5500, reload, notify });
    expect(reload).not.toHaveBeenCalled();
    expect(readUpdateRestartIntent()?.requestId).toBe(reqId);
    expect(window.sessionStorage.getItem(UPDATE_RESTART_SUCCESS_KEY)).toBeNull();
  });

  it("waits through network outage and refreshes once only after the healthy replacement", async () => {
    const reload = vi.fn();
    const notify = vi.fn();
    armUpdateRestart(baseStatus, "manual", reqId, now);
    await pollUpdateRestartOnce(async () => { throw Error("connection reset"); }, {
      now: () => now + 15000, reload, notify,
    });
    expect(getUpdateRecoveryPhase()).toBe("reconnecting");
    expect(reload).not.toHaveBeenCalled();

    const duringInstall = updaterInfo({
      ...baseStatus, phase: "verifying", lastRequest: reqId,
    }, "running");
    await pollUpdateRestartOnce(async () => duringInstall, { now: () => now + 20000, reload, notify });
    expect(reload).not.toHaveBeenCalled();

    const completed = updaterInfo({
      ...baseStatus,
      phase: "updated", lastRequest: reqId,
      currentRevision: newRevision,
      lastSuccessAt: "2026-10-10T03:30:00.000Z",
    }, "completed");
    await pollUpdateRestartOnce(async () => completed, {
      now: () => now + 30000, reload, notify,
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(readUpdateRestartIntent()).toBeNull();
    expect(window.sessionStorage.getItem(UPDATE_RESTART_INTENT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(UPDATE_RESTART_SUCCESS_KEY)).toContain(newRevision);

    // Simulate the reloaded page: toast once, never re-display on later mounts.
    consumeUpdateSuccessNotification(notify);
    consumeUpdateSuccessNotification(notify);
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "success", "Cat-Termix updated successfully. The page was refreshed.",
    );
  });

  it("does not reload for a no-op, a deferred AI job, a failed update, or expiration", async () => {
    const reload = vi.fn(), notify = vi.fn();
    armUpdateRestart(baseStatus, "manual", reqId, now);
    await pollUpdateRestartOnce(async () => updaterInfo({
      ...baseStatus, phase: "current", lastRequest: reqId,
    }, "completed"), { now: () => now + 1000, reload, notify });
    expect(reload).not.toHaveBeenCalled();
    expect(readUpdateRestartIntent()).toBeNull();

    armUpdateRestart(baseStatus, "manual", reqId, now);
    await pollUpdateRestartOnce(async () => updaterInfo({
      ...baseStatus, phase: "deferred", lastRequest: reqId,
    }, "completed"), { now: () => now + 1000, reload, notify });
    expect(reload).not.toHaveBeenCalled();

    armUpdateRestart(baseStatus, "manual", reqId, now);
    await pollUpdateRestartOnce(async () => updaterInfo({
      ...baseStatus, phase: "error", lastRequest: reqId,
      message: "Registry failure",
    }, "failed"), { now: () => now + 1000, reload, notify });
    expect(reload).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("error", "Registry failure");

    armUpdateRestart(baseStatus, "manual", reqId, now);
    await pollUpdateRestartOnce(async () => updaterInfo(baseStatus), {
      now: () => now + 31 * 60_000, reload, notify,
    });
    expect(readUpdateRestartIntent()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("also recognizes an automatic replacement observed by system settings", async () => {
    armUpdateRestart(baseStatus, "automatic", null, now);
    const automatic = readUpdateRestartIntent()!;
    armUpdateRestart(baseStatus, "automatic", null, now + 10000);
    expect(readUpdateRestartIntent()).toEqual(automatic);
    const reload = vi.fn();
    await pollUpdateRestartOnce(async () => updaterInfo({
      ...baseStatus, phase: "updated",
      currentRevision: newRevision,
      lastSuccessAt: "2026-10-10T03:33:00.000Z",
    }), { now: () => now + 10000, reload, notify: vi.fn() });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("continues monitoring even if settings unmounts", async () => {
    armUpdateRestart(baseStatus, "manual", reqId, now);
    const reload = vi.fn(), notify = vi.fn();
    const stop = startUpdateRestartMonitor(async () => updaterInfo({
      ...baseStatus, phase: "updated", lastRequest: reqId,
      currentRevision: newRevision,
      lastSuccessAt: "2026-10-10T03:36:00.000Z",
    }, "completed"), { now: () => now + 5000, reload, notify });
    try {
      await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    } finally {
      stop();
    }
    expect(window.sessionStorage.getItem(UPDATE_RESTART_SUCCESS_KEY)).toContain(newRevision);
  });
});
