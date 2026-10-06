import type { Request } from "express";
import { forwardAuditEntry } from "./audit-forwarder.js";
import {
  createCurrentAuditLogRepository,
  createCurrentUserRepository,
} from "../database/repositories/factory.js";
import { getClientIp } from "./request-origin.js";

/**
 * Resolves the display name to store alongside the entry. It is denormalised on
 * purpose: the record has to stay readable after the account is gone.
 */
export async function getAuditUsername(userId: string): Promise<string> {
  try {
    const actor = await createCurrentUserRepository().findById(userId);
    return actor?.username ?? userId;
  } catch {
    return userId;
  }
}

export interface AuditLogParams {
  // Null when no user acted (a plugin starting up, background work): the
  // column references users.id, so anything else would be refused.
  userId: string | null;
  username: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  details?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

export async function logAuditOrThrow(params: AuditLogParams): Promise<void> {
  // Agent security-sensitive mutations use this fail-closed variant. Persist
  // locally first; forwarding is only a best-effort copy and never decides
  // whether the audited operation is allowed to complete.
  await createCurrentAuditLogRepository().create({
    userId: params.userId,
    username: params.username,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    resourceName: params.resourceName ?? null,
    details: params.details ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    success: params.success,
    errorMessage: params.errorMessage ?? null,
  });
  void forwardAuditEntry(params).catch(() => {});
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    await logAuditOrThrow(params);
  } catch {
    // General application audit logging remains best effort. Agent routes that
    // require fail-closed audit semantics call logAuditOrThrow directly.
  }
}

export function getRequestMeta(req: Request): {
  ipAddress: string;
  userAgent: string;
} {
  const userAgent = (req.headers["user-agent"] as string) || "";
  return { ipAddress: getClientIp(req), userAgent };
}
