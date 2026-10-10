import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
  type KeyObject,
} from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";

export const SCOPES = [
  "sessions:create",
  "sessions:read",
  "sessions:write",
  "sessions:close",
  "jobs:execute",
  "servers:create",
  "quick-connections:create",
  "files:read",
  "files:write",
] as const;
export type AgentScope = (typeof SCOPES)[number];

export type Device = {
  id: string;
  name: string;
  ownerId: string;
  publicKey: string;
  fingerprint: string;
  accessMode: "all" | "selected";
  projectIds: string[];
  hostIds: number[];
  scopes: AgentScope[];
  maxConcurrentSessions: number;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};
export type DeviceRequest = {
  requestId: string;
  deviceName: string;
  codeHash: string;
  publicKey: string;
  fingerprint: string;
  status: "pending" | "approved" | "denied";
  deviceId: string | null;
  expiresAt: string;
};
export type TransportPolicy = {
  allowHttp: boolean;
  allowedCidrs: string[];
};
export type AgentState = {
  devices: Device[];
  requests: DeviceRequest[];
  nonces: Record<string, number>;
  idempotency: Record<
    string,
    { hash: string; data: unknown; until: number; pending?: boolean }
  >;
  transport: TransportPolicy;
};

export class AgentError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentError";
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new AgentError(status, code, message);
};
export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
export function validatedPublicKey(raw: unknown): {
  pem: string;
  fingerprint: string;
} {
  if (typeof raw !== "string" || raw.length > 4096)
    return fail(400, "INVALID_DEVICE_KEY", "设备公钥无效");
  let key: KeyObject;
  try {
    key = createPublicKey(raw);
  } catch {
    return fail(400, "INVALID_DEVICE_KEY", "设备公钥无效");
  }
  if (key.asymmetricKeyType !== "ed25519")
    return fail(400, "INVALID_DEVICE_KEY", "仅支持 Ed25519 公钥");
  return {
    pem: key.export({ type: "spki", format: "pem" }).toString(),
    fingerprint: sha256(key.export({ type: "spki", format: "der" })),
  };
}
export function canonicalDeviceRequest(input: {
  method: string;
  pathAndQuery: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  idempotencyKey?: string;
  requestId?: string;
}): string {
  return [
    "cloudssh-device-v2",
    input.method.toUpperCase(),
    input.pathAndQuery,
    input.timestamp,
    input.nonce,
    input.bodyHash,
    input.idempotencyKey ?? "",
    input.requestId ?? "",
  ].join("\n");
}
type SignedHeaders = {
  nonce: string;
  timestamp: string;
  bodyHash: string;
  signature: Buffer;
  canonical: string;
  deviceId: string;
  idempotencyKey: string;
};
function headers(req: Request): SignedHeaders {
  if (req.get("authorization")?.startsWith("Bearer "))
    return fail(401, "TOKEN_AUTH_REMOVED", "Agent API 只接受设备签名");
  const deviceId = req.get("x-cloudssh-device-id") ?? "";
  const timestamp = req.get("x-cloudssh-timestamp") ?? "";
  const nonce = req.get("x-cloudssh-nonce") ?? "";
  const bodyHash = req.get("x-cloudssh-body-sha256") ?? "";
  const signature = req.get("x-cloudssh-signature") ?? "";
  const requestId = req.get("x-request-id") ?? "";
  const idempotencyKey = req.get("idempotency-key") ?? "";
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 300_000 ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(bodyHash) ||
    !/^[A-Za-z0-9_-]{40,256}$/.test(signature) ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId) ||
    (idempotencyKey && !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey))
  )
    return fail(
      401,
      "DEVICE_SIGNATURE_REQUIRED",
      "缺少有效设备签名或请求时间已过期",
    );
  return {
    deviceId,
    timestamp,
    nonce,
    bodyHash,
    signature: Buffer.from(signature, "base64url"),
    canonical: canonicalDeviceRequest({
      method: req.method,
      pathAndQuery: req.originalUrl,
      timestamp,
      nonce,
      bodyHash,
      idempotencyKey,
      requestId,
    }),
    idempotencyKey,
  };
}
export function verifyDetached(
  req: Request,
  publicKey: string,
  actualBody: Buffer,
): {
  nonce: string;
  timestamp: number;
  bodyHash: string;
  idempotencyKey: string;
} {
  const signed = headers(req);
  if (sha256(actualBody) !== signed.bodyHash)
    return fail(401, "DEVICE_BODY_TAMPERED", "正文与签名摘要不一致");
  if (!verify(null, Buffer.from(signed.canonical), publicKey, signed.signature))
    return fail(401, "DEVICE_SIGNATURE_INVALID", "设备签名无效");
  return {
    nonce: signed.nonce,
    timestamp: Number(signed.timestamp),
    bodyHash: signed.bodyHash,
    idempotencyKey: signed.idempotencyKey,
  };
}
function blank(): AgentState {
  return {
    devices: [],
    requests: [],
    nonces: {},
    idempotency: {},
    transport: { allowHttp: false, allowedCidrs: [] },
  };
}

/**
 * Single-process serialized, persist-before-publish state. This avoids a
 * read/modify/write race across HTTP requests and consumes a signature nonce
 * durably before a side effect can begin.
 */
export class AgentStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly ctx: PluginContext) {}

  async read(): Promise<AgentState> {
    const stored = await this.ctx.kv.get("agent-v1-state");
    if (!stored || typeof stored !== "object") return blank();
    const value = stored as AgentState;
    return {
      ...blank(),
      ...value,
      devices: value.devices ?? [],
      requests: value.requests ?? [],
      nonces: value.nonces ?? {},
      idempotency: value.idempotency ?? {},
      transport: value.transport ?? blank().transport,
    };
  }
  async update<T>(run: (data: AgentState) => T | Promise<T>): Promise<T> {
    let release: () => void = () => {};
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const data = await this.read();
      const now = Date.now();
      data.requests = data.requests.filter(
        (item) => Date.parse(item.expiresAt) + 86_400_000 > now,
      );
      for (const [key, expiry] of Object.entries(data.nonces))
        if (expiry < now) delete data.nonces[key];
      for (const [key, entry] of Object.entries(data.idempotency))
        if (entry.until < now) delete data.idempotency[key];
      const result = await run(data);
      await this.ctx.kv.set("agent-v1-state", data);
      return result;
    } finally {
      release();
    }
  }
  async createRequest(deviceName: unknown, rawPublicKey: unknown) {
    if (
      typeof deviceName !== "string" ||
      !deviceName.trim() ||
      deviceName.length > 64
    )
      return fail(400, "INVALID_INPUT", "设备名称无效");
    const key = validatedPublicKey(rawPublicKey);
    const code = [...randomBytes(8)]
      .map((part) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[part % 32])
      .join("");
    const requestId = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await this.update((data) => {
      data.requests.push({
        requestId,
        deviceName: deviceName.trim(),
        codeHash: sha256(code),
        publicKey: key.pem,
        fingerprint: key.fingerprint,
        status: "pending",
        deviceId: null,
        expiresAt,
      });
    });
    return {
      requestId,
      code: code.slice(0, 4) + "-" + code.slice(4),
      expiresAt,
      intervalSeconds: 2,
    };
  }
  async poll(req: Request) {
    const requestId = String(req.params.requestId ?? "");
    return this.update((data) => {
      const request = data.requests.find((x) => x.requestId === requestId);
      if (!request)
        return fail(404, "DEVICE_REQUEST_NOT_FOUND", "设备请求不存在");
      const proof = verifyDetached(req, request.publicKey, Buffer.alloc(0));
      consumeNonce(
        data,
        "registration:" + request.fingerprint,
        proof.nonce,
        proof.timestamp,
      );
      if (
        Date.parse(request.expiresAt) <= Date.now() &&
        request.status === "pending"
      )
        return { status: "expired" };
      return {
        status: request.status,
        deviceId: request.status === "approved" ? request.deviceId : undefined,
      };
    });
  }
  async authenticate(req: Request, body: Buffer): Promise<Device> {
    const id = req.get("x-cloudssh-device-id") ?? "";
    return this.update((data) => {
      const device = data.devices.find((x) => x.id === id && !x.revokedAt);
      if (
        !device ||
        (device.expiresAt && Date.parse(device.expiresAt) <= Date.now())
      )
        return fail(401, "DEVICE_NOT_AUTHORIZED", "设备未授权或已撤销");
      const proof = verifyDetached(req, device.publicKey, body);
      consumeNonce(data, "device:" + device.id, proof.nonce, proof.timestamp);
      device.lastUsedAt = new Date().toISOString();
      return device;
    });
  }
  async approve(
    userId: string,
    code: string,
    input: {
      name?: string;
      scopes: AgentScope[];
      accessMode: "all" | "selected";
      projectIds: string[];
      hostIds: number[];
      maxConcurrentSessions?: number;
      expiresAt?: string | null;
    },
  ) {
    const hash = sha256(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));
    return this.update((data) => {
      const request = data.requests.find(
        (r) =>
          r.codeHash === hash &&
          r.status === "pending" &&
          Date.parse(r.expiresAt) > Date.now(),
      );
      if (!request)
        return fail(404, "DEVICE_CODE_INVALID", "设备码已过期或不存在");
      if (
        !Array.isArray(input.scopes) ||
        input.scopes.length < 1 ||
        input.scopes.some((s) => !SCOPES.includes(s)) ||
        !["all", "selected"].includes(input.accessMode)
      )
        return fail(400, "INVALID_GRANT", "设备授权范围无效");
      const maxConcurrentSessions = input.maxConcurrentSessions ?? 1;
      if (
        !Number.isInteger(maxConcurrentSessions) ||
        maxConcurrentSessions < 1 ||
        maxConcurrentSessions > 20
      )
        return fail(400, "INVALID_GRANT", "会话数必须为 1–20");
      if (
        input.expiresAt &&
        (!Number.isFinite(Date.parse(input.expiresAt)) ||
          Date.parse(input.expiresAt) <= Date.now())
      )
        return fail(400, "INVALID_GRANT", "过期时间无效");
      const device: Device = {
        id: randomUUID(),
        name: input.name || request.deviceName,
        ownerId: userId,
        publicKey: request.publicKey,
        fingerprint: request.fingerprint,
        accessMode: input.accessMode,
        projectIds: input.accessMode === "all" ? [] : input.projectIds,
        hostIds: input.accessMode === "all" ? [] : input.hostIds,
        scopes: [...new Set(input.scopes)],
        maxConcurrentSessions,
        expiresAt: input.expiresAt ?? null,
        createdAt: new Date().toISOString(),
        revokedAt: null,
        lastUsedAt: null,
      };
      data.devices.push(device);
      request.status = "approved";
      request.deviceId = device.id;
      return device;
    });
  }
  async deny(code: string) {
    const hash = sha256(code.toUpperCase().replace(/[^A-Z0-9]/g, ""));
    return this.update((data) => {
      const request = data.requests.find(
        (r) => r.codeHash === hash && r.status === "pending",
      );
      if (!request) return fail(404, "DEVICE_CODE_INVALID", "设备码不存在");
      request.status = "denied";
    });
  }
  async revoke(userId: string, id: string) {
    return this.update((data) => {
      const device = data.devices.find(
        (x) => x.id === id && x.ownerId === userId && !x.revokedAt,
      );
      if (!device) return fail(404, "DEVICE_NOT_FOUND", "设备不存在");
      device.revokedAt = new Date().toISOString();
    });
  }
  async replay<T>(
    deviceId: string,
    key: string,
    hash: string,
    op: () => Promise<T>,
  ): Promise<T> {
    if (!key)
      return fail(400, "IDEMPOTENCY_KEY_REQUIRED", "写操作必须指定幂等键");
    const cacheKey = deviceId + ":" + key;
    const reservation = await this.update((data) => {
      const saved = data.idempotency[cacheKey];
      if (saved) {
        if (saved.hash !== hash)
          return fail(409, "IDEMPOTENCY_CONFLICT", "幂等键与请求内容不一致");
        if (saved.pending)
          return fail(
            409,
            "IDEMPOTENCY_OUTCOME_UNKNOWN",
            "上次操作的结果尚未确认，请查询远程状态，不要自动重复执行",
          );
        return { cached: true as const, value: saved.data };
      }
      if (Object.keys(data.idempotency).length >= 1024)
        return fail(429, "IDEMPOTENCY_STORAGE_FULL", "幂等记录已满");
      // Save an in-progress marker BEFORE launching any SSH or file side effect.
      // If the process crashes, replays fail closed rather than running twice.
      data.idempotency[cacheKey] = {
        hash,
        data: null,
        pending: true,
        until: Date.now() + 7 * 86_400_000,
      };
      return { cached: false as const };
    });
    if (reservation.cached) return reservation.value as T;
    const result = await op();
    await this.update((data) => {
      const entry = data.idempotency[cacheKey];
      if (!entry || entry.hash !== hash || !entry.pending)
        return fail(409, "IDEMPOTENCY_CONFLICT", "幂等记录不一致");
      data.idempotency[cacheKey] = {
        hash,
        data: result,
        until: Date.now() + 7 * 86_400_000,
      };
    });
    return result;
  }
}
function consumeNonce(
  data: AgentState,
  prefix: string,
  nonce: string,
  timestamp: number,
): void {
  const key = prefix + ":" + nonce;
  if (data.nonces[key])
    return fail(401, "DEVICE_REQUEST_REPLAYED", "设备请求已使用");
  if (Object.keys(data.nonces).length >= 10000)
    return fail(503, "NONCE_STORAGE_FULL", "设备认证暂不可用");
  data.nonces[key] = timestamp + 600_000;
}

const TRUSTED_RANGES: Array<[string, number]> = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
];
function ipv4Number(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  return ip
    .split(".")
    .reduce((acc, part) => (acc * 256 + Number(part)) >>> 0, 0);
}
function subnet(
  address: string,
  prefix: number,
  range: string,
  rangeBits: number,
) {
  const input = ipv4Number(address);
  const base = ipv4Number(range);
  if (input === null || base === null || prefix < rangeBits) return false;
  const mask = (0xffffffff << (32 - rangeBits)) >>> 0;
  return (input & mask) === (base & mask);
}
export function validateTransportPolicy(raw: unknown): TransportPolicy {
  const v = raw as TransportPolicy;
  if (
    !v ||
    typeof v.allowHttp !== "boolean" ||
    !Array.isArray(v.allowedCidrs) ||
    v.allowedCidrs.length > 32
  )
    return fail(
      400,
      "INVALID_HTTP_POLICY",
      "HTTP 来源需配置 0–32 个可信内网 CIDR",
    );
  const allowedCidrs = [
    ...new Set(
      v.allowedCidrs.map((value) => {
        if (typeof value !== "string" || value.length > 48)
          return fail(400, "INVALID_HTTP_POLICY", "来源 IP 格式无效");
        const [address, prefixRaw, ...extra] = value.split("/");
        const prefix = prefixRaw === undefined ? 32 : Number(prefixRaw);
        if (
          extra.length ||
          !Number.isInteger(prefix) ||
          prefix < 0 ||
          prefix > 32 ||
          !TRUSTED_RANGES.some(([range, bits]) =>
            subnet(address, prefix, range, bits),
          )
        )
          return fail(
            400,
            "INVALID_HTTP_POLICY",
            "只能配置可信 IPv4 内网/VPN CIDR",
          );
        return address + "/" + prefix;
      }),
    ),
  ];
  if (v.allowHttp && !allowedCidrs.length)
    return fail(400, "INVALID_HTTP_POLICY", "启用 HTTP 时必须指定来源 IP");
  return { allowHttp: v.allowHttp, allowedCidrs };
}
export function resolveTransportPolicy(
  saved: TransportPolicy,
  environment: NodeJS.ProcessEnv,
): TransportPolicy {
  if (environment.CLOUDSSH_AGENT_HTTP_POLICY_LOCKED !== "true") return saved;
  try {
    return validateTransportPolicy({
      allowHttp: environment.CLOUDSSH_AGENT_ALLOW_HTTP === "true",
      allowedCidrs: (environment.CLOUDSSH_AGENT_HTTP_ALLOWED_CIDRS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    });
  } catch {
    // An invalid administrator-supplied deployment lock must NEVER widen HTTP.
    return { allowHttp: false, allowedCidrs: [] };
  }
}

export function allowsTransport(
  secure: boolean,
  ip: string,
  policy: TransportPolicy,
): boolean {
  if (secure || ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip))
    return true;
  if (!policy.allowHttp) return false;
  return policy.allowedCidrs.some((value) => {
    const [range, prefixRaw] = value.split("/");
    const prefix = Number(prefixRaw);
    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    const a = ipv4Number(ip);
    const b = ipv4Number(range);
    return a !== null && b !== null && (a & mask) === (b & mask);
  });
}
export function projectId(folder: string | null): string {
  return "folder:" + Buffer.from(folder || "", "utf8").toString("base64url");
}
export function projectFolder(id: string): string | null {
  if (!id.startsWith("folder:"))
    return fail(400, "INVALID_PROJECT", "项目标识无效");
  const raw = id.slice(7);
  if (raw && !/^[A-Za-z0-9_-]+$/.test(raw))
    return fail(400, "INVALID_PROJECT", "项目标识无效");
  const folder = Buffer.from(raw, "base64url").toString("utf8");
  if (folder.length > 512) return fail(400, "INVALID_PROJECT", "分类路径过长");
  return folder || null;
}
export function requireScope(device: Device, scope: AgentScope): void {
  if (!device.scopes.includes(scope))
    fail(403, "SCOPE_DENIED", "此设备没有所需权限：" + scope);
}
