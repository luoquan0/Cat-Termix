import { randomUUID } from "node:crypto";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { Client, ClientChannel, SFTPWrapper } from "ssh2";
import {
  AgentError,
  type Device,
  projectId,
  requireScope,
} from "./identity.js";

type JobStatus =
  "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "TIMED_OUT";
export type Job = {
  id: string;
  deviceId: string;
  ownerId: string;
  serverId: string;
  command: string;
  state: JobStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timeoutMs: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  failureReason: string | null;
};
type Attachment = {
  id: string;
  deviceId: string;
  mode: "read-only" | "read-write";
};
type Lease = {
  id: string;
  attachmentId: string;
  expiresAt: string;
};
export type Session = {
  id: string;
  deviceId: string;
  ownerId: string;
  serverId: string;
  state: "CREATING" | "RUNNING" | "FAILED" | "CLOSED";
  runtimeMode: "platform" | "tmux";
  pinned: boolean;
  cols: number;
  rows: number;
  createdAt: string;
  updatedAt: string;
  output: string;
  sequence: number;
  attachments: Attachment[];
  writeLease: Lease | null;
  failureReason: string | null;
};
type Runtime = {
  stream: ClientChannel;
  dispose: () => void;
};
type JobController = { cancel: () => void };
function error(status: number, code: string, message: string): never {
  throw new AgentError(status, code, message);
}
function allowedInt(
  value: unknown,
  min: number,
  max: number,
  fallback?: number,
): number {
  const number = value === undefined ? fallback : Number(value);
  if (
    !Number.isInteger(number) ||
    number === undefined ||
    number < min ||
    number > max
  )
    return error(400, "INVALID_INPUT", "数字超出允许范围");
  return number;
}
export function serverHostId(value: unknown): number {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^[1-9]\d{0,14}$/.test(raw))
    return error(400, "INVALID_SERVER_ID", "服务器 ID 无效");
  const result = Number(raw);
  if (!Number.isSafeInteger(result))
    return error(400, "INVALID_SERVER_ID", "服务器 ID 无效");
  return result;
}
function folderOf(value: string | null): string {
  return value || "";
}
function getHostProject(folder: string | null) {
  return projectId(folder);
}
export function validateRemotePath(input: unknown): string {
  if (
    typeof input !== "string" ||
    !input.trim() ||
    input.length > 4096 ||
    input.includes("\0")
  )
    return error(400, "INVALID_REMOTE_PATH", "远程路径无效");
  return input;
}

export class AgentOperations {
  private readonly activeJobs = new Map<string, JobController>();
  private readonly cancelRequests = new Set<string>();
  private readonly activeSessions = new Map<string, Runtime>();
  private writeQueue: Promise<void> = Promise.resolve();
  private flushTimers = new Map<string, NodeJS.Timeout>();
  private jobs = new Map<string, Job>();
  private sessions = new Map<string, Session>();

  constructor(private readonly ctx: PluginContext) {}

  async restore() {
    for (const row of ((await this.ctx.kv.get("agent-jobs")) ?? []) as Job[]) {
      if (row.state === "RUNNING" || row.state === "QUEUED") {
        row.state = "FAILED";
        row.failureReason = "服务重启中断了此任务，不会自动重复执行";
        row.finishedAt = new Date().toISOString();
      }
      this.jobs.set(row.id, row);
    }
    for (const row of ((await this.ctx.kv.get("agent-sessions")) ??
      []) as Session[]) {
      if (row.state === "CREATING" || row.state === "RUNNING") {
        row.state = "FAILED";
        row.failureReason =
          row.runtimeMode === "tmux"
            ? "连接已断开；等待重附着原 tmux 会话"
            : "服务重启关闭了平台模式会话";
        row.writeLease = null;
        row.attachments = [];
      }
      this.sessions.set(row.id, row);
    }
    await this.saveJobs();
    await this.saveSessions();
  }
  private enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.writeQueue.then(fn);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }
  private saveJobs() {
    return this.enqueue(() =>
      this.ctx.kv.set("agent-jobs", [...this.jobs.values()].slice(-300)),
    );
  }
  private saveSessions() {
    return this.enqueue(() =>
      this.ctx.kv.set(
        "agent-sessions",
        [...this.sessions.values()].slice(-100),
      ),
    );
  }
  private async persistSession(id: string) {
    const timer = this.flushTimers.get(id);
    if (timer) clearTimeout(timer);
    this.flushTimers.delete(id);
    await this.saveSessions();
  }
  private scheduleSessionSave(id: string) {
    if (this.flushTimers.has(id)) return;
    this.flushTimers.set(
      id,
      setTimeout(() => {
        this.flushTimers.delete(id);
        void this.saveSessions().catch(() => undefined);
      }, 750),
    );
  }

  async hostsFor(device: Device) {
    return this.ctx.asUser(device.ownerId, async () => {
      const hosts = await this.ctx.hosts.list();
      return hosts.filter(
        (host) =>
          host.userId === device.ownerId &&
          (device.accessMode === "all" ||
            (device.hostIds.includes(host.id) &&
              device.projectIds.includes(getHostProject(host.folder)))),
      );
    });
  }
  async projectsFor(device: Device) {
    const hosts = await this.hostsFor(device);
    const projects = new Map<
      string,
      { id: string; name: string; kind: "personal"; folder: string }
    >();
    for (const host of hosts) {
      const folder = folderOf(host.folder);
      const id = projectId(host.folder);
      projects.set(id, {
        id,
        name: folder || "未分类主机",
        kind: "personal",
        folder,
      });
    }
    return [...projects.values()];
  }
  async assertHost(device: Device, raw: unknown): Promise<number> {
    const hostId = serverHostId(raw);
    const hosts = await this.hostsFor(device);
    if (!hosts.some((host) => host.id === hostId))
      return error(403, "SERVER_DENIED", "此设备未获该服务器的授权");
    return this.ctx.asUser(device.ownerId, async () => {
      const access = await this.ctx.hosts.checkAccess(hostId, "connect");
      if (!access.hasAccess)
        return error(403, "SERVER_DENIED", "主机连接权限已失效");
      return hostId;
    });
  }
  async publicHosts(device: Device) {
    const hosts = await this.hostsFor(device);
    return hosts.map((host) => ({
      hostId: host.id,
      serverId: String(host.id),
      name: host.name || host.ip,
      projectId: projectId(host.folder),
      projectName: folderOf(host.folder) || "未分类主机",
      connectionType: "ssh",
      address: host.ip,
      port: host.port,
      folder: host.folder,
      tags: host.tags?.split(",").filter(Boolean) ?? [],
    }));
  }
  private publicJob(job: Job): Job {
    return { ...job };
  }

  async createJob(
    device: Device,
    rawHost: unknown,
    command: unknown,
    rawTimeout: unknown,
  ) {
    requireScope(device, "jobs:execute");
    const hostId = await this.assertHost(device, rawHost);
    const activeCount = [...this.jobs.values()].filter(
      (job) => job.state === "QUEUED" || job.state === "RUNNING",
    ).length;
    if (activeCount >= 32)
      return error(429, "JOB_LIMIT_REACHED", "并发任务数已达到上限");
    if (
      typeof command !== "string" ||
      !command.trim() ||
      command.length > 65_536
    )
      return error(400, "INVALID_COMMAND", "命令长度无效");
    const timeoutMs = allowedInt(rawTimeout, 1000, 900_000, 30_000);
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      deviceId: device.id,
      ownerId: device.ownerId,
      serverId: String(hostId),
      command,
      state: "QUEUED",
      stdout: "",
      stderr: "",
      exitCode: null,
      timeoutMs,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      failureReason: null,
    };
    this.jobs.set(job.id, job);
    await this.saveJobs(); // Persist the id BEFORE a remote command can start.
    void this.executeJob(job, hostId);
    return this.publicJob(job);
  }
  private async executeJob(job: Job, hostId: number) {
    if (job.state === "CANCELED" || this.cancelRequests.has(job.id)) {
      this.cancelRequests.delete(job.id);
      return;
    }
    let end: (() => void) | null = null;
    let timedOut = false;
    let aborted = false;
    let timer: NodeJS.Timeout | undefined;
    try {
      job.state = "RUNNING";
      job.startedAt = new Date().toISOString();
      await this.saveJobs();
      if (this.cancelRequests.has(job.id)) {
        aborted = true;
        throw new Error("Canceled");
      }
      await this.ctx.asUser(job.ownerId, async () => {
        const connection = await this.ctx.ssh.connect<Client>(hostId, {
          purpose: "agent-job",
          profile: "background",
        });
        try {
          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (failure?: Error) => {
              if (settled) return;
              settled = true;
              if (timer) clearTimeout(timer);
              this.activeJobs.delete(job.id);
              if (failure) reject(failure);
              else resolve();
            };
            end = () => finish(new Error("Canceled"));
            if (this.cancelRequests.has(job.id)) {
              aborted = true;
              finish(new Error("Canceled"));
              return;
            }
            connection.client.exec(job.command, (err, stream) => {
              if (err) {
                finish(err);
                return;
              }
              if (this.cancelRequests.has(job.id)) {
                aborted = true;
                stream.close();
                finish(new Error("Canceled"));
                return;
              }
              timer = setTimeout(() => {
                timedOut = true;
                stream.close();
                finish(new Error("Timed out"));
              }, job.timeoutMs);
              this.activeJobs.set(job.id, {
                cancel: () => {
                  aborted = true;
                  stream.close();
                  finish(new Error("Canceled"));
                },
              });
              const append = (
                field: "stdout" | "stderr",
                chunk: Buffer | string,
              ) => {
                const current = job[field];
                if (current.length < 65_536)
                  job[field] = (current + chunk.toString()).slice(0, 65_536);
              };
              stream.on("data", (chunk: Buffer | string) =>
                append("stdout", chunk),
              );
              stream.stderr.on("data", (chunk: Buffer | string) =>
                append("stderr", chunk),
              );
              stream.on("exit", (code: number | null) => {
                job.exitCode = code;
              });
              stream.on("close", () => finish());
              stream.on("error", (failure: Error) => finish(failure));
            });
          });
        } finally {
          connection.dispose();
        }
      });
      job.state = job.exitCode === 0 ? "SUCCEEDED" : "FAILED";
      if (job.state === "FAILED") job.failureReason = "远程命令返回非零退出码";
    } catch (failure) {
      job.state = timedOut
        ? "TIMED_OUT"
        : aborted || this.cancelRequests.has(job.id)
          ? "CANCELED"
          : "FAILED";
      job.failureReason =
        failure instanceof Error ? failure.message.slice(0, 200) : "运行失败";
    } finally {
      if (end) this.activeJobs.delete(job.id);
      this.cancelRequests.delete(job.id);
      job.finishedAt = new Date().toISOString();
      await this.saveJobs().catch(() => undefined);
    }
  }
  async listJobs(device: Device) {
    requireScope(device, "jobs:execute");
    return [...this.jobs.values()]
      .filter((job) => job.deviceId === device.id)
      .map((job) => this.publicJob(job));
  }
  getJob(device: Device, id: string): Job {
    requireScope(device, "jobs:execute");
    const job = this.jobs.get(id);
    if (!job || job.deviceId !== device.id)
      return error(404, "JOB_NOT_FOUND", "任务不存在");
    return this.publicJob(job);
  }
  async cancelJob(device: Device, id: string) {
    const job = this.getJob(device, id);
    if (job.state === "QUEUED" || job.state === "RUNNING")
      this.cancelRequests.add(id);
    if (job.state === "QUEUED") {
      const original = this.jobs.get(id)!;
      original.state = "CANCELED";
      original.finishedAt = new Date().toISOString();
    } else if (job.state === "RUNNING") this.activeJobs.get(id)?.cancel();
    await this.saveJobs();
    return this.getJob(device, id);
  }

  private getSession(device: Device, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.deviceId !== device.id)
      return error(404, "SESSION_NOT_FOUND", "会话不存在");
    return session;
  }
  private publicSession(session: Session) {
    const { output: _output, ...safe } = session;
    void _output;
    return structuredClone(safe);
  }
  private async openSession(session: Session) {
    const id = Number(session.serverId);
    await this.ctx.asUser(session.ownerId, async () => {
      const connection = await this.ctx.ssh.connect<Client>(id, {
        purpose: "agent-session",
        profile: "terminal",
      });
      try {
        const stream = await new Promise<ClientChannel>((resolve, reject) => {
          connection.client.shell(
            { cols: session.cols, rows: session.rows, term: "xterm-256color" },
            (failure, channel) =>
              failure ? reject(failure) : resolve(channel),
          );
        });
        this.activeSessions.set(session.id, {
          stream,
          dispose: connection.dispose,
        });
        stream.on("data", (chunk: Buffer | string) => {
          session.output = (session.output + chunk.toString()).slice(-262_144);
          session.sequence += 1;
          this.scheduleSessionSave(session.id);
        });
        stream.on("close", () => {
          if (this.activeSessions.get(session.id)?.stream !== stream) {
            connection.dispose();
            return;
          }
          if (session.state === "RUNNING") {
            session.state = "FAILED";
            session.failureReason =
              session.runtimeMode === "tmux"
                ? "连接已断开；等待重附着原 tmux 会话"
                : "SSH PTY 已结束";
          }
          this.activeSessions.delete(session.id);
          connection.dispose();
          this.scheduleSessionSave(session.id);
        });
        if (session.runtimeMode === "tmux")
          stream.write(
            "tmux new-session -A -s cat-agent-" +
              session.id.slice(0, 12) +
              "\n",
          );
      } catch (e) {
        connection.dispose();
        throw e;
      }
    });
  }
  async createSession(device: Device, raw: Record<string, unknown>) {
    requireScope(device, "sessions:create");
    const id = await this.assertHost(device, raw.serverId);
    const active = [...this.sessions.values()].filter(
      (x) =>
        x.deviceId === device.id &&
        (x.state === "RUNNING" || x.state === "CREATING"),
    );
    if (active.length >= device.maxConcurrentSessions)
      return error(429, "SESSION_LIMIT_REACHED", "设备达到最大会话数量");
    const runtimeMode =
      raw.runtimeMode === "tmux" ||
      (raw.runtimeMode === undefined && raw.pinned === true)
        ? "tmux"
        : "platform";
    if (
      raw.runtimeMode &&
      !["platform", "tmux"].includes(String(raw.runtimeMode))
    )
      return error(400, "INVALID_MODE", "SSH 会话模式无效");
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      deviceId: device.id,
      ownerId: device.ownerId,
      serverId: String(id),
      state: "CREATING",
      runtimeMode,
      pinned: raw.pinned === true,
      cols: allowedInt(raw.cols, 20, 500, 120),
      rows: allowedInt(raw.rows, 5, 300, 30),
      createdAt: now,
      updatedAt: now,
      output: "",
      sequence: 0,
      attachments: [],
      writeLease: null,
      failureReason: null,
    };
    this.sessions.set(session.id, session);
    await this.saveSessions();
    try {
      await this.openSession(session);
      session.state = "RUNNING";
    } catch (failure) {
      session.state = "FAILED";
      session.failureReason =
        failure instanceof Error ? failure.message.slice(0, 200) : "连接失败";
    }
    session.updatedAt = new Date().toISOString();
    await this.saveSessions();
    return this.publicSession(session);
  }
  async listSessions(device: Device) {
    requireScope(device, "sessions:read");
    return [...this.sessions.values()]
      .filter((session) => session.deviceId === device.id)
      .map((s) => this.publicSession(s));
  }
  sessionStatus(device: Device, id: string) {
    requireScope(device, "sessions:read");
    return this.publicSession(this.getSession(device, id));
  }
  async attachSession(
    device: Device,
    id: string,
    mode: unknown,
    takeover = false,
  ) {
    requireScope(device, "sessions:read");
    const session = this.getSession(device, id);
    if (
      session.state === "FAILED" &&
      session.runtimeMode === "tmux" &&
      session.failureReason === "连接已断开；等待重附着原 tmux 会话"
    ) {
      // Explicit attach is the recovery boundary. Never reconnect to a host
      // without re-checking its CURRENT owner grants after restart.
      session.state = "CREATING";
      try {
        await this.persistSession(id);
        await this.assertHost(device, session.serverId);
        await this.openSession(session); // Same session ID reattaches original tmux.
        session.state = "RUNNING";
        session.failureReason = null;
        session.updatedAt = new Date().toISOString();
        await this.persistSession(id);
      } catch {
        session.state = "FAILED";
        session.failureReason = "连接已断开；等待重附着原 tmux 会话";
        await this.persistSession(id);
        return error(
          503,
          "TMUX_RECONNECT_FAILED",
          "无法重附着远端 tmux 会话，请检查主机连接和权限",
        );
      }
    }
    if (session.state !== "RUNNING")
      return error(409, "SESSION_NOT_RUNNING", "会话未连接");
    if (mode !== "read-only" && mode !== "read-write")
      return error(400, "INVALID_MODE", "附件模式无效");
    if (mode === "read-write") requireScope(device, "sessions:write");
    if (
      mode === "read-write" &&
      session.writeLease &&
      Date.parse(session.writeLease.expiresAt) > Date.now() &&
      !takeover
    )
      return error(409, "WRITE_LEASE_HELD", "已有其他附件持有写入租约");
    const attachmentId = randomUUID();
    const attachment: Attachment = {
      id: attachmentId,
      deviceId: device.id,
      mode,
    };
    session.attachments.push(attachment);
    if (mode === "read-write") {
      session.writeLease = {
        id: randomUUID(),
        attachmentId,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    }
    await this.persistSession(id);
    return {
      attachmentId,
      mode,
      lease: mode === "read-write" ? { ...session.writeLease } : null,
      session: this.publicSession(session),
    };
  }
  async readSession(device: Device, id: string, cursor?: string) {
    requireScope(device, "sessions:read");
    const s = this.getSession(device, id);
    const position = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isInteger(position) || position < 0)
      return error(400, "INVALID_CURSOR", "输出游标无效");
    return {
      sessionId: id,
      chunks:
        position < s.sequence
          ? [
              {
                generation: 1,
                sequence: s.sequence,
                data: s.output,
                timestamp: s.updatedAt,
              },
            ]
          : [],
      nextCursor: String(s.sequence),
      hasMore: false,
      state: s.state,
    };
  }
  async writeSession(
    device: Device,
    id: string,
    input: Record<string, unknown>,
  ) {
    requireScope(device, "sessions:write");
    const session = this.getSession(device, id);
    const lease = session.writeLease;
    if (
      !lease ||
      lease.id !== input.leaseId ||
      lease.attachmentId !== input.attachmentId ||
      Date.parse(lease.expiresAt) <= Date.now()
    )
      return error(409, "WRITE_LEASE_INVALID", "缺少有效写入租约");
    if (typeof input.data !== "string" || input.data.length > 1_048_576)
      return error(400, "INVALID_INPUT", "输入无效");
    const runtime = this.activeSessions.get(id);
    if (!runtime || session.state !== "RUNNING")
      return error(409, "SESSION_NOT_RUNNING", "SSH 终端已断开");
    runtime.stream.write(input.data);
    lease.expiresAt = new Date(Date.now() + 60_000).toISOString();
    await this.saveSessions();
    return { written: Buffer.byteLength(input.data), lease: { ...lease } };
  }
  async resizeSession(
    device: Device,
    id: string,
    input: Record<string, unknown>,
  ) {
    requireScope(device, "sessions:write");
    const session = this.getSession(device, id);
    if (
      !session.writeLease ||
      session.writeLease.id !== input.leaseId ||
      session.writeLease.attachmentId !== input.attachmentId ||
      Date.parse(session.writeLease.expiresAt) <= Date.now()
    )
      return error(409, "WRITE_LEASE_INVALID", "缺少有效写入租约");
    const cols = allowedInt(input.cols, 20, 500);
    const rows = allowedInt(input.rows, 5, 300);
    const runtime = this.activeSessions.get(id);
    if (!runtime) return error(409, "SESSION_NOT_RUNNING", "会话不在线");
    runtime.stream.setWindow(rows, cols, 0, 0);
    session.cols = cols;
    session.rows = rows;
    await this.saveSessions();
    return this.publicSession(session);
  }
  async detachSession(device: Device, id: string, attachmentId: string) {
    requireScope(device, "sessions:read");
    const session = this.getSession(device, id);
    const attachment = session.attachments.find(
      (a) => a.id === attachmentId && a.deviceId === device.id,
    );
    if (!attachment) return error(404, "ATTACHMENT_NOT_FOUND", "附件不存在");
    session.attachments = session.attachments.filter(
      (a) => a.id !== attachmentId,
    );
    if (session.writeLease?.attachmentId === attachmentId)
      session.writeLease = null;
    await this.saveSessions();
    return { detached: true };
  }
  async closeSession(device: Device, id: string) {
    requireScope(device, "sessions:close");
    const session = this.getSession(device, id);
    const runtime = this.activeSessions.get(id);
    if (runtime) {
      runtime.stream.end("exit\n");
      runtime.dispose();
      this.activeSessions.delete(id);
    }
    session.state = "CLOSED";
    session.writeLease = null;
    session.attachments = [];
    session.updatedAt = new Date().toISOString();
    await this.persistSession(id);
    return this.publicSession(session);
  }
  async stop() {
    for (const ctl of this.activeJobs.values()) ctl.cancel();
    this.activeJobs.clear();
    for (const [id, item] of this.activeSessions) {
      const session = this.sessions.get(id);
      if (session && session.state === "RUNNING") {
        session.state = "FAILED";
        session.failureReason =
          session.runtimeMode === "tmux"
            ? "连接已断开；等待重附着原 tmux 会话"
            : "服务停机中断了平台会话";
        session.writeLease = null;
        session.attachments = [];
        session.updatedAt = new Date().toISOString();
      }
      item.dispose();
    }
    this.activeSessions.clear();
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    this.flushTimers.clear();
    await this.saveSessions();
  }

  async withSftp<T>(
    device: Device,
    serverId: unknown,
    scope: "files:read" | "files:write",
    fn: (sftp: SFTPWrapper) => Promise<T>,
  ): Promise<T> {
    requireScope(device, scope);
    const id = await this.assertHost(device, serverId);
    return this.ctx.asUser(device.ownerId, async () => {
      const connection = await this.ctx.ssh.connect<Client>(id, {
        purpose: "agent-file",
        profile: "stream",
      });
      try {
        const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
          connection.client.sftp((err, handle) =>
            err ? reject(err) : resolve(handle),
          ),
        );
        try {
          return await fn(sftp);
        } finally {
          sftp.end();
        }
      } finally {
        connection.dispose();
      }
    });
  }
  async listFiles(device: Device, serverId: unknown, rawPath: unknown) {
    const path = validateRemotePath(rawPath ?? ".");
    return this.withSftp(device, serverId, "files:read", async (sftp) => {
      const entries = await new Promise<import("ssh2").FileEntryWithStats[]>(
        (resolve, reject) =>
          sftp.readdir(path, (err, rows) =>
            err ? reject(err) : resolve(rows),
          ),
      );
      return {
        path,
        files: entries.slice(0, 2000).map((row) => ({
          name: row.filename,
          path: path.replace(/\/+$/, "") + "/" + row.filename,
          type: row.attrs.isDirectory()
            ? "directory"
            : row.attrs.isSymbolicLink()
              ? "link"
              : "file",
          size: row.attrs.size,
          modifiedAt: row.attrs.mtime
            ? new Date(row.attrs.mtime * 1000).toISOString()
            : null,
          permissions: row.attrs.mode,
        })),
      };
    });
  }
  async readFile(device: Device, serverId: unknown, rawPath: unknown) {
    const path = validateRemotePath(rawPath);
    return this.withSftp(device, serverId, "files:read", async (sftp) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = sftp.createReadStream(path);
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4_194_304) stream.destroy(new Error("文件读取超过 4 MiB"));
          else chunks.push(chunk);
        });
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      const buffer = Buffer.concat(chunks);
      if (buffer.includes(0))
        return error(400, "BINARY_FILE", "仅支持文本读取");
      return {
        path,
        content: buffer.toString("utf8"),
        encoding: "utf8" as const,
        size: buffer.length,
        truncated: false,
      };
    });
  }
  async downloadFile(device: Device, serverId: unknown, rawPath: unknown) {
    const path = validateRemotePath(rawPath);
    return this.withSftp(device, serverId, "files:read", async (sftp) => {
      const buffers: Buffer[] = [];
      let size = 0;
      const stream = sftp.createReadStream(path);
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 64 * 1024 * 1024)
            stream.destroy(new Error("下载超过 64 MiB"));
          else buffers.push(chunk);
        });
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      return Buffer.concat(buffers);
    });
  }
  async uploadFile(
    device: Device,
    serverId: unknown,
    rawPath: unknown,
    bytes: Buffer,
  ) {
    const path = validateRemotePath(rawPath);
    if (bytes.length > 64 * 1024 * 1024)
      return error(413, "FILE_TOO_LARGE", "文件超过 64 MiB");
    return this.withSftp(device, serverId, "files:write", async (sftp) => {
      await new Promise<void>((resolve, reject) => {
        const stream = sftp.createWriteStream(path, {
          flags: "w",
          mode: 0o600,
        });
        stream.once("error", reject);
        stream.once("close", resolve);
        stream.end(bytes);
      });
      return { serverId: String(serverId), path, size: bytes.length };
    });
  }
  async mkdir(
    device: Device,
    serverId: unknown,
    rawPath: unknown,
    recursive: boolean,
  ) {
    const path = validateRemotePath(rawPath);
    return this.withSftp(device, serverId, "files:write", async (sftp) => {
      if (recursive) {
        const parts = path.split("/").filter(Boolean);
        let current = path.startsWith("/") ? "/" : "";
        for (const part of parts) {
          current += (current && !current.endsWith("/") ? "/" : "") + part;
          await new Promise<void>((resolve, reject) => {
            sftp.mkdir(current, (err) => {
              if (!err || (err as NodeJS.ErrnoException).code === "EEXIST")
                resolve();
              else
                sftp.stat(current, (statErr, row) =>
                  !statErr && row.isDirectory() ? resolve() : reject(err),
                );
            });
          });
        }
      } else
        await new Promise<void>((resolve, reject) =>
          sftp.mkdir(path, (err) => (err ? reject(err) : resolve())),
        );
      return { serverId: String(serverId), path };
    });
  }
  async rename(
    device: Device,
    serverId: unknown,
    sourceRaw: unknown,
    destinationRaw: unknown,
  ) {
    const sourcePath = validateRemotePath(sourceRaw);
    const destinationPath = validateRemotePath(destinationRaw);
    return this.withSftp(device, serverId, "files:write", async (sftp) => {
      await new Promise<void>((resolve, reject) =>
        sftp.rename(sourcePath, destinationPath, (err) =>
          err ? reject(err) : resolve(),
        ),
      );
      return { serverId: String(serverId), sourcePath, destinationPath };
    });
  }
  async deleteFile(
    device: Device,
    serverId: unknown,
    rawPath: unknown,
    recursive: boolean,
  ) {
    const path = validateRemotePath(rawPath);
    if (path === "/" || path === "." || path === "..")
      return error(400, "UNSAFE_PATH", "不能删除根目录");
    return this.withSftp(device, serverId, "files:write", async (sftp) => {
      const remove = async (target: string, depth = 0): Promise<void> => {
        if (depth > 10)
          return error(400, "RECURSION_LIMIT", "删除目录超过深度限制");
        const stats = await new Promise<import("ssh2").Stats>(
          (resolve, reject) =>
            sftp.lstat(target, (err, value) =>
              err ? reject(err) : resolve(value),
            ),
        );
        if (stats.isDirectory()) {
          if (recursive) {
            const files = await new Promise<
              import("ssh2").FileEntryWithStats[]
            >((resolve, reject) =>
              sftp.readdir(target, (err, rows) =>
                err ? reject(err) : resolve(rows),
              ),
            );
            for (const row of files)
              await remove(
                target.replace(/\/+$/, "") + "/" + row.filename,
                depth + 1,
              );
          }
          await new Promise<void>((resolve, reject) =>
            sftp.rmdir(target, (err) => (err ? reject(err) : resolve())),
          );
        } else
          await new Promise<void>((resolve, reject) =>
            sftp.unlink(target, (err) => (err ? reject(err) : resolve())),
          );
      };
      await remove(path);
      return { serverId: String(serverId), path };
    });
  }
}
