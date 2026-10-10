export interface UpdatePolicy {
  enabled: boolean;
  intervalHours: number;
  proxyUrl: string;
}
export const DEFAULT_UPDATE_POLICY: UpdatePolicy = {
  enabled: false,
  intervalHours: 6,
  proxyUrl: "",
};
export function validateUpdatePolicy(value: unknown): UpdatePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid update configuration");
  const p = value as UpdatePolicy;
  if (
    typeof p.enabled !== "boolean" ||
    !Number.isInteger(p.intervalHours) ||
    p.intervalHours < 1 ||
    p.intervalHours > 168 ||
    typeof p.proxyUrl !== "string" ||
    p.proxyUrl.length > 2048
  )
    throw new Error("Invalid update configuration");
  if (p.proxyUrl) {
    const u = new URL(p.proxyUrl);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      !u.hostname ||
      u.hash ||
      u.search ||
      (u.pathname && u.pathname !== "/")
    )
      throw new Error("Proxy must be an http:// or https:// proxy origin");
  }
  return {
    enabled: p.enabled,
    intervalHours: p.intervalHours,
    proxyUrl: p.proxyUrl,
  };
}
/** A check is asynchronous. 202 means queued, not that GHCR was checked. */
export interface UpdateRequestProgress {
  id: string;
  action: "check" | "apply";
  requestedAt: string;
  state: "queued" | "running" | "completed" | "failed" | "timed_out";
}

export interface UpdateStatus {
  phase?: string;
  currentRevision?: string;
  availableRevision?: string;
  lastCheckAt?: string;
  lastSuccessAt?: string;
  lastRequest?: string;
  message?: string;
  heartbeat?: string;
}

export interface UpdateInfo {
  canManage: boolean;
  installed: boolean;
  policy: UpdatePolicy;
  proxyConfigured: boolean;
  status?: UpdateStatus | null;
  /** Derived from the request file and the separate updater's real heartbeat. */
  request?: UpdateRequestProgress | null;
}

/**
 * Correlate an accepted manual request with the updater's acknowledged ID and
 * timestamps. Crucially, an old "current" status cannot finish a new check.
 * Compatible with already-deployed Preview 4+ updater helpers.
 */
export function resolveUpdateRequestProgress(
  raw: unknown,
  status: UpdateStatus | null | undefined,
  now = Date.now(),
): UpdateRequestProgress | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const request = raw as Record<string, unknown>;
  if (
    typeof request.id !== "string" ||
    !/^[a-f\d-]{36}$/i.test(request.id) ||
    (request.action !== "check" && request.action !== "apply") ||
    typeof request.at !== "string"
  ) return null;
  const at = Date.parse(request.at);
  if (!Number.isFinite(at)) return null;

  const accepted = status?.lastRequest === request.id;
  const phase = status?.phase;
  const checkedAt = Date.parse(status?.lastCheckAt ?? "");
  const heartbeat = Date.parse(status?.heartbeat ?? "");
  const doneCheck = accepted &&
    Number.isFinite(checkedAt) &&
    checkedAt >= at;
  const appliedAt = Date.parse(status?.lastSuccessAt ?? "");
  const doneApply =
    accepted &&
    ((phase === "updated" &&
      Number.isFinite(appliedAt) &&
      appliedAt >= at) ||
      (phase === "current" && doneCheck) ||
      (phase === "deferred" &&
        Number.isFinite(heartbeat) &&
        heartbeat >= at));
  let state: UpdateRequestProgress["state"] = "queued";

  if (
    (request.action === "check" && doneCheck &&
      (phase === "current" || phase === "available")) ||
    (request.action === "apply" && doneApply)
  ) {
    state = "completed";
  } else if (accepted && phase === "error" &&
    Number.isFinite(heartbeat) && heartbeat >= at) {
    state = "failed";
  } else if (accepted && request.action === "check" && doneCheck) {
    // A later automatic update may have already advanced the phase.
    state = "completed";
  } else if (
    (!accepted && now - at > 10 * 60_000) ||
    (accepted &&
      request.action === "check" &&
      now - at > 3 * 60_000 &&
      (!Number.isFinite(heartbeat) || now - heartbeat > 180000))
  ) {
    // The helper rejects unaccepted requests older than ten minutes.
    // Its heartbeat also detects an interrupted, already-started check.
    state = "timed_out";
  } else if (accepted) {
    state = "running";
  }
  return {
    id: request.id,
    action: request.action,
    requestedAt: request.at,
    state,
  };
}
