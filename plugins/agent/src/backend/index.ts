import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from "express";
import type {
  PluginContext,
  PluginHostSummary,
} from "@termix/plugin-sdk/backend";
import {
  AgentError,
  AgentStore,
  SCOPES,
  allowsTransport,
  projectFolder,
  projectId,
  requireScope,
  sha256,
  resolveTransportPolicy,
  validateTransportPolicy,
  type AgentScope,
  type Device,
} from "./identity.js";
import { AgentOperations } from "./operations.js";

type Incoming = Request & {
  userId?: string;
  sessionId?: string;
  apiKeyId?: string;
  pendingTOTP?: boolean;
};
type AgentRequest = Incoming & {
  device?: Device;
  rawBuffer?: Buffer;
  jsonBody?: Record<string, unknown>;
};
function fail(status: number, code: string, message: string): never {
  throw new AgentError(status, code, message);
}
function body(req: AgentRequest): Record<string, unknown> {
  return req.jsonBody ?? {};
}
function getString(input: unknown, name = "参数", max = 4096): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > max ||
    input.includes("\0")
  )
    return fail(400, "INVALID_INPUT", name + " 无效");
  return input.trim();
}
function nameFromReq(req: AgentRequest) {
  return req.userId ?? fail(401, "LOGIN_REQUIRED", "请先登录网页");
}
function jsonParse(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {};
  try {
    const data: unknown = JSON.parse(raw.toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data))
      return fail(400, "INVALID_INPUT", "JSON 对象无效");
    return data as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AgentError) throw err;
    return fail(400, "INVALID_JSON", "请求正文 JSON 无效");
  }
}
function safe<T>(
  handler: (req: AgentRequest, res: Response) => Promise<T> | T,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(req as AgentRequest, res))
      .catch(next);
  };
}
function secure(req: Request): boolean {
  return req.secure || req.protocol === "https";
}
function requestIp(req: Request) {
  return req.ip ?? req.socket.remoteAddress ?? "";
}
function privateIp(ip: string) {
  return allowsTransport(false, ip, {
    allowHttp: true,
    allowedCidrs: [
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "100.64.0.0/10",
    ],
  });
}
function allowedOrigin(req: Request, ctx: PluginContext) {
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(ctx.http.baseUrl(req)).origin;
  } catch {
    return false;
  }
}
function sessionRequired(req: AgentRequest, ctx: PluginContext) {
  nameFromReq(req);
  if (
    !req.sessionId ||
    req.apiKeyId ||
    req.pendingTOTP ||
    !allowedOrigin(req, ctx)
  )
    return fail(
      403,
      "INTERACTIVE_SESSION_REQUIRED",
      "请在已登录网页中进行同源管理操作",
    );
}
function publicError(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  void req;
  void next;
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof AgentError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  res
    .status(500)
    .json({ code: "AGENT_INTERNAL_ERROR", error: "Agent 请求处理失败" });
}
export async function activate(ctx: PluginContext) {
  const store = new AgentStore(ctx);
  const operations = new AgentOperations(ctx);
  await operations.restore();
  ctx.disposables.add(() => operations.stop());
  const router = ctx.http.router<Router>({ public: ["/v1/*"], rawBody: true });
  const locked = () => process.env.CLOUDSSH_AGENT_HTTP_POLICY_LOCKED === "true";
  const currentPolicy = async () =>
    resolveTransportPolicy((await store.read()).transport, process.env);

  // Signed paths accept exact old /agent/v1 URLs. Everything is parsed as raw
  // bytes before comparing the SHA-256 included in the Ed25519 signature.
  router.use("/v1", (req, res, next) => {
    const max = req.path.startsWith("/files/upload") ? "64mb" : "1mb";
    express.raw({ type: "*/*", limit: max })(req, res, next);
  });
  router.use("/v1", (req, res, next) => {
    void Promise.resolve()
      .then(async () => {
        const policy = await currentPolicy();
        if (!allowsTransport(secure(req), requestIp(req), policy))
          return fail(
            426,
            "HTTPS_REQUIRED",
            "只允许 HTTPS 或管理员明确授权的内网 HTTP 来源",
          );
        if (
          req.method !== "GET" &&
          req.method !== "HEAD" &&
          !Buffer.isBuffer(req.body)
        )
          return fail(400, "INVALID_INPUT", "缺少原始正文");
        const incoming = req as AgentRequest;
        incoming.rawBuffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.alloc(0);
        if (!req.path.startsWith("/files/upload") && incoming.rawBuffer.length)
          incoming.jsonBody = jsonParse(incoming.rawBuffer);
        // Express requires next() to dispatch after this async middleware.
        (res.locals as { agentValidated?: boolean }).agentValidated = true;
        next();
      })
      .catch(next);
  });
  // Administrative routes use the core web session, never a device identity.
  router.use("/admin", express.json({ limit: "1mb" }));
  const manage = safe(async (req, res) => {
    void res;
    if (!(await ctx.rbac.has("manage")))
      return fail(403, "MANAGE_DENIED", "当前账号没有管理本地 Agent 的权限");
  });
  void manage;
  const deviceMiddleware = safe(async (req, res) => {
    void res;
    const raw = req.rawBuffer ?? Buffer.alloc(0);
    req.device = await store.authenticate(req, raw);
  });
  void deviceMiddleware;

  // v1 health and unauthenticated device enrollment.
  router.get(
    "/v1/health",
    safe(async (_req, res) => {
      res.json({ status: "ok", version: "v1" });
    }),
  );
  router.post(
    "/v1/auth/device-requests",
    safe(async (req, res) => {
      const b = body(req);
      const created = await store.createRequest(b.deviceName, b.publicKey);
      res.status(201).json({ request: created });
    }),
  );
  router.get(
    "/v1/auth/device-requests/:requestId",
    safe(async (req, res) => {
      res.json(await store.poll(req));
    }),
  );
  // Every endpoint following enrollment requires the device's own signature
  // and consumes a durable single-use nonce before any read or write.
  const signed = (
    handler: (
      req: AgentRequest,
      res: Response,
      device: Device,
    ) => Promise<unknown>,
  ) =>
    safe(async (req, res) => {
      const device = await store.authenticate(
        req,
        req.rawBuffer ?? Buffer.alloc(0),
      );
      await ctx.asUser(device.ownerId, () => handler(req, res, device));
    });
  const mutation = <T>(
    req: AgentRequest,
    device: Device,
    fn: () => Promise<T>,
  ): Promise<T> =>
    store.replay(
      device.id,
      req.get("idempotency-key") || "",
      sha256(
        req.method +
          "\n" +
          req.originalUrl +
          "\n" +
          sha256(req.rawBuffer ?? Buffer.alloc(0)),
      ),
      fn,
    );

  router.get(
    "/v1/servers",
    signed(async (_req, res, device) =>
      res.json({ servers: await operations.publicHosts(device) }),
    ),
  );
  router.get(
    "/v1/projects",
    signed(async (_req, res, device) =>
      res.json({ projects: await operations.projectsFor(device) }),
    ),
  );
  router.get(
    "/v1/projects/:projectId/folders",
    signed(async (req, res, device) => {
      const id = getString(req.params.projectId, "项目");
      const projects = await operations.projectsFor(device);
      if (!projects.some((x) => x.id === id))
        fail(403, "PROJECT_DENIED", "项目未授权");
      const folder = projectFolder(id);
      res.json({
        folders: folder ? [{ path: folder, color: null, icon: null }] : [],
      });
    }),
  );
  router.get(
    "/v1/projects/:projectId/credentials",
    signed(async (req, res, device) => {
      const id = getString(req.params.projectId, "项目");
      if (!(await operations.projectsFor(device)).some((p) => p.id === id))
        fail(403, "PROJECT_DENIED", "项目未授权");
      if (
        !device.scopes.includes("servers:create") &&
        !device.scopes.includes("quick-connections:create")
      )
        fail(403, "SCOPE_DENIED", "设备无权读取保存的凭据元数据");
      const creds = await ctx.credentials.listSshKeys();
      res.json({
        credentials: creds.map((key) => ({
          id: String(key.id),
          name: key.name,
          username: "",
          authType: "key",
          keyType: null,
        })),
      });
    }),
  );
  router.post(
    "/v1/servers",
    signed(async (req, res, device) => {
      requireScope(device, "servers:create");
      const b = body(req);
      const id = getString(b.projectId, "项目");
      if (!(await operations.projectsFor(device)).some((p) => p.id === id))
        fail(403, "PROJECT_DENIED", "项目未授权");
      if (b.authType && !["none", "credential"].includes(String(b.authType)))
        fail(
          422,
          "AUTH_METHOD_UNSUPPORTED",
          "仅支持无凭据或使用已保存的凭据创建主机",
        );
      const address = getString(b.address, "地址", 255);
      const username = getString(b.username, "用户名", 255);
      const name =
        typeof b.name === "string" ? getString(b.name, "名称", 128) : address;
      const port = Number(b.port ?? 22);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        fail(400, "INVALID_PORT", "端口无效");
      const credentialId =
        b.authType === "credential" ? Number(b.credentialId) : null;
      if (
        b.authType === "credential" &&
        (!Number.isSafeInteger(credentialId) || credentialId! <= 0)
      )
        fail(400, "INVALID_CREDENTIAL", "已保存凭据 ID 无效");
      const result = await mutation(req, device, async () => {
        const created = await ctx.hosts.create({
          name,
          ip: address,
          port,
          username,
          authType: credentialId ? "credential" : "none",
          credentialId,
          folder: projectFolder(id),
          tags: Array.isArray(b.tags)
            ? b.tags.filter((v): v is string => typeof v === "string")
            : [],
        });
        await ctx.audit.record({
          action: "agent_host_created",
          resourceType: "host",
          resourceId: String(created.id),
          success: true,
        });
        return {
          hostId: created.id,
          serverId: String(created.id),
          projectId: id,
          name,
          address,
          port,
        };
      });
      res.status(201).json({ server: result });
    }),
  );

  router.post(
    "/v1/jobs",
    signed(async (req, res, device) => {
      const b = body(req);
      const result = await mutation(req, device, () =>
        operations.createJob(device, b.serverId, b.command, b.timeoutMs),
      );
      await ctx.audit.record({
        action: "agent_job_started",
        resourceType: "host",
        resourceId: String(b.serverId),
        success: true,
      });
      res.status(202).json({ job: result });
    }),
  );
  router.get(
    "/v1/jobs",
    signed(async (_req, res, device) =>
      res.json({ jobs: await operations.listJobs(device) }),
    ),
  );
  router.get(
    "/v1/jobs/:id",
    signed(async (req, res, device) =>
      res.json({ job: operations.getJob(device, String(req.params.id)) }),
    ),
  );
  router.post(
    "/v1/jobs/:id/cancel",
    signed(async (req, res, device) =>
      res.json({
        job: await operations.cancelJob(device, String(req.params.id)),
      }),
    ),
  );

  router.post(
    "/v1/sessions",
    signed(async (req, res, device) => {
      const result = await mutation(req, device, () =>
        operations.createSession(device, body(req)),
      );
      res.status(201).json({ session: result });
    }),
  );
  router.get(
    "/v1/sessions",
    signed(async (_req, res, device) =>
      res.json({ sessions: await operations.listSessions(device) }),
    ),
  );
  router.get(
    "/v1/sessions/:id/status",
    signed(async (req, res, device) =>
      res.json({
        session: operations.sessionStatus(device, String(req.params.id)),
      }),
    ),
  );
  router.post(
    "/v1/sessions/:id/attach",
    signed(async (req, res, device) => {
      const b = body(req);
      res.json(
        await mutation(req, device, () =>
          operations.attachSession(
            device,
            String(req.params.id),
            b.mode ?? "read-only",
            b.takeover === true,
          ),
        ),
      );
    }),
  );
  router.get(
    "/v1/sessions/:id/read",
    signed(async (req, res, device) =>
      res.json(
        await operations.readSession(
          device,
          String(req.params.id),
          typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        ),
      ),
    ),
  );
  router.post(
    "/v1/sessions/:id/write",
    signed(async (req, res, device) => {
      res.json(
        await mutation(req, device, () =>
          operations.writeSession(device, String(req.params.id), body(req)),
        ),
      );
    }),
  );
  router.post(
    "/v1/sessions/:id/resize",
    signed(async (req, res, device) =>
      res.json({
        session: await operations.resizeSession(
          device,
          String(req.params.id),
          body(req),
        ),
      }),
    ),
  );
  router.post(
    "/v1/sessions/:id/detach",
    signed(async (req, res, device) => {
      res.json(
        await operations.detachSession(
          device,
          String(req.params.id),
          getString(body(req).attachmentId),
        ),
      );
    }),
  );
  router.post(
    "/v1/sessions/:id/close",
    signed(async (req, res, device) => {
      res.json({
        session: await operations.closeSession(device, String(req.params.id)),
      });
    }),
  );

  router.get(
    "/v1/files/list",
    signed(async (req, res, device) =>
      res.json(
        await operations.listFiles(device, req.query.serverId, req.query.path),
      ),
    ),
  );
  router.get(
    "/v1/files/read",
    signed(async (req, res, device) =>
      res.json(
        await operations.readFile(device, req.query.serverId, req.query.path),
      ),
    ),
  );
  router.get(
    "/v1/files/download",
    signed(async (req, res, device) => {
      const contents = await operations.downloadFile(
        device,
        req.query.serverId,
        req.query.path,
      );
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
      res.send(contents);
    }),
  );
  router.post(
    "/v1/files/upload",
    signed(async (req, res, device) => {
      const result = await mutation(req, device, () =>
        operations.uploadFile(
          device,
          req.query.serverId,
          req.query.path,
          req.rawBuffer ?? Buffer.alloc(0),
        ),
      );
      res.status(201).json({ file: result });
    }),
  );
  router.post(
    "/v1/files/mkdir",
    signed(async (req, res, device) => {
      const b = body(req);
      res.status(201).json({
        directory: await mutation(req, device, () =>
          operations.mkdir(device, b.serverId, b.path, b.recursive === true),
        ),
      });
    }),
  );
  router.post(
    "/v1/files/rename",
    signed(async (req, res, device) => {
      const b = body(req);
      res.json({
        file: await mutation(req, device, () =>
          operations.rename(
            device,
            b.serverId,
            b.sourcePath,
            b.destinationPath,
          ),
        ),
      });
    }),
  );
  router.post(
    "/v1/files/delete",
    signed(async (req, res, device) => {
      const b = body(req);
      res.json({
        file: await mutation(req, device, () =>
          operations.deleteFile(
            device,
            b.serverId,
            b.path,
            b.recursive === true,
          ),
        ),
      });
    }),
  );

  const requireManager = async (req: AgentRequest, operation?: "transport") => {
    nameFromReq(req);
    if (!req.sessionId || req.apiKeyId || req.pendingTOTP)
      fail(401, "INTERACTIVE_SESSION_REQUIRED", "仅允许网页登录会话管理设备");
    if (
      operation === "transport" &&
      !(await ctx.rbac.has("admin.settings.manage"))
    )
      fail(403, "ADMIN_REQUIRED", "只有实例管理员可以修改传输策略");
    if (
      !(await ctx.rbac.has(
        operation === "transport" ? "manage_http" : "manage",
      ))
    )
      fail(403, "MANAGE_DENIED", "没有管理权限");
  };
  const manager = (
    action: (
      req: AgentRequest,
      res: Response,
      userId: string,
    ) => Promise<unknown>,
  ) =>
    safe(async (req, res) => {
      await requireManager(req);
      await action(req, res, nameFromReq(req));
    });
  router.get(
    "/admin/status",
    manager(async (_req, res) => res.json({ ok: true })),
  );
  router.get(
    "/admin/devices",
    manager(async (_req, res, userId) => {
      const state = await store.read();
      res.json({
        devices: state.devices
          .filter((x) => x.ownerId === userId)
          .map(({ publicKey: _key, ...safe }) => {
            void _key;
            return safe;
          }),
      });
    }),
  );
  router.get(
    "/admin/projects",
    manager(async (_req, res, userId) => {
      const hosts = await ctx.hosts.list();
      const choices = new Map<
        string,
        { id: string; name: string; hostIds: number[] }
      >();
      for (const host of hosts.filter(
        (h: PluginHostSummary) => h.userId === userId,
      )) {
        const id = projectId(host.folder);
        const existing = choices.get(id);
        if (existing) existing.hostIds.push(host.id);
        else
          choices.set(id, {
            id,
            name: host.folder || "未分类主机",
            hostIds: [host.id],
          });
      }
      res.json({ projects: [...choices.values()] });
    }),
  );
  router.post(
    "/admin/requests/resolve",
    manager(async (req, res) => {
      sessionRequired(req, ctx);
      const code = getString(req.body?.code, "设备码", 32)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const state = await store.read();
      const pending = state.requests.find(
        (x) =>
          x.codeHash === sha256(code) &&
          x.status === "pending" &&
          Date.parse(x.expiresAt) > Date.now(),
      );
      if (!pending) fail(404, "DEVICE_CODE_INVALID", "设备码不存在或已过期");
      res.json({
        requestId: pending.requestId,
        deviceName: pending.deviceName,
        fingerprint: pending.fingerprint,
        expiresAt: pending.expiresAt,
      });
    }),
  );
  router.post(
    "/admin/requests/:id/approve",
    manager(async (req, res, userId) => {
      sessionRequired(req, ctx);
      const b = req.body as Record<string, unknown>;
      const code = getString(b.code, "设备码", 32);
      const mode = b.accessMode === "selected" ? "selected" : "all";
      const requested = Array.isArray(b.projectIds)
        ? b.projectIds.filter((x): x is string => typeof x === "string")
        : [];
      const hosts = (await ctx.hosts.list()).filter((x) => x.userId === userId);
      const allowedProjects = new Set(hosts.map((x) => projectId(x.folder)));
      if (
        mode === "selected" &&
        (!requested.length || requested.some((id) => !allowedProjects.has(id)))
      )
        fail(400, "INVALID_GRANT", "请选择有权管理的主机分类");
      const permittedHostIds = hosts
        .filter((x) => requested.includes(projectId(x.folder)))
        .map((x) => x.id);
      const scopes = Array.isArray(b.scopes)
        ? b.scopes.filter(
            (x): x is AgentScope =>
              typeof x === "string" && SCOPES.some((value) => value === x),
          )
        : [];
      await ctx.audit.record({
        action: "agent_device_approval_intent",
        resourceType: "agent_device",
        details: JSON.stringify({
          fingerprintChecked: true,
          scopes,
          accessMode: mode,
          projectIds: requested,
        }),
        success: true,
      });
      const device = await store.approve(userId, code, {
        scopes,
        accessMode: mode,
        projectIds: requested,
        hostIds: permittedHostIds,
        maxConcurrentSessions:
          typeof b.maxConcurrentSessions === "number"
            ? b.maxConcurrentSessions
            : 1,
        expiresAt: typeof b.expiresAt === "string" ? b.expiresAt : null,
      });
      res.status(201).json({
        device: {
          id: device.id,
          fingerprint: device.fingerprint,
          name: device.name,
        },
      });
    }),
  );
  router.post(
    "/admin/requests/:id/deny",
    manager(async (req, res) => {
      sessionRequired(req, ctx);
      await store.deny(getString(req.body?.code, "设备码", 32));
      res.json({ denied: true });
    }),
  );
  router.delete(
    "/admin/devices/:id",
    manager(async (req, res, userId) => {
      sessionRequired(req, ctx);
      await ctx.audit.record({
        action: "agent_device_revocation_intent",
        resourceType: "agent_device",
        resourceId: String(req.params.id),
        success: true,
      });
      await store.revoke(userId, String(req.params.id));
      res.json({ revoked: true });
    }),
  );

  const policySnapshot = async (req: Request) => {
    const policy = await currentPolicy();
    return {
      ...policy,
      locked: locked(),
      source: locked() ? "environment" : "saved",
      sourceAddress: requestIp(req),
      currentRequestAllowed: allowsTransport(
        secure(req),
        requestIp(req),
        policy,
      ),
      canConfigure: secure(req) || privateIp(requestIp(req)),
    };
  };
  router.get(
    "/admin/transport-policy",
    safe(async (req, res) => {
      await requireManager(req, "transport");
      res.setHeader("Cache-Control", "private, no-store");
      res.json(await policySnapshot(req));
    }),
  );
  router.post(
    "/admin/transport-policy",
    safe(async (req, res) => {
      await requireManager(req, "transport");
      sessionRequired(req, ctx);
      if (locked())
        fail(409, "HTTP_POLICY_LOCKED", "已由部署环境锁定 HTTP 配置");
      if (!(secure(req) || privateIp(requestIp(req))))
        fail(
          426,
          "HTTPS_REQUIRED",
          "公网必须通过 HTTPS 网页修改内网 HTTP 策略",
        );
      const next = validateTransportPolicy(req.body);
      await ctx.audit.record({
        action: "agent_http_policy_change_intent",
        resourceType: "agent_transport_policy",
        success: true,
        details: JSON.stringify({
          allowHttp: next.allowHttp,
          allowedCidrs: next.allowedCidrs,
        }),
      });
      await store.update((data) => {
        data.transport = next;
      });
      res.json(await policySnapshot(req));
    }),
  );
  router.use(publicError);

  ctx.log.info(
    "Local Agent device API installed at /agent/v1; admin UI at /plugin-api/agent/admin",
  );
}
export async function deactivate() {}
