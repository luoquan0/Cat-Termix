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
export interface UpdateInfo {
  canManage: boolean;
  installed: boolean;
  policy: UpdatePolicy;
  proxyConfigured: boolean;
  status?: {
    phase?: string;
    currentRevision?: string;
    availableRevision?: string;
    lastCheckAt?: string;
    lastSuccessAt?: string;
    message?: string;
    heartbeat?: string;
  };
}
