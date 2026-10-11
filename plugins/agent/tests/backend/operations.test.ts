import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type {
  PluginContext,
  PluginHostSummary,
} from "@termix/plugin-sdk/backend";
import { projectId, type Device } from "../../src/backend/identity.js";
import { AgentOperations, type Session } from "../../src/backend/operations.js";

const DEVICE: Device = {
  id: "device-one",
  name: "Local AI",
  ownerId: "owner",
  publicKey: "",
  fingerprint: "",
  accessMode: "all",
  projectIds: [],
  hostIds: [],
  scopes: [
    "jobs:execute",
    "sessions:create",
    "sessions:read",
    "sessions:write",
  ],
  maxConcurrentSessions: 2,
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  revokedAt: null,
  lastUsedAt: null,
};

function fixture() {
  const stored = new Map<string, unknown>();
  const stream = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
    setWindow: vi.fn(),
  });
  const client = {
    shell: vi.fn(
      (_options: unknown, finish: (error: null, output: unknown) => void) => {
        finish(null, stream);
      },
    ),
    exec: vi.fn(),
  };
  const dispose = vi.fn();
  const ctx = {
    kv: {
      get: async (key: string) => stored.get(key),
      set: async (key: string, value: unknown) => {
        stored.set(key, structuredClone(value));
      },
    },
    hosts: {
      list: async () => [
        { id: 42, userId: DEVICE.ownerId, folder: null, name: "test-host" },
      ],
      checkAccess: vi.fn(async () => ({ hasAccess: true })),
    },
    asUser: async (_owner: string, fn: () => unknown) => fn(),
    ssh: {
      connect: vi.fn(async () => ({ client, dispose })),
    },
  } as unknown as PluginContext;
  return { ctx, stored, stream, client, dispose };
}

describe("Local Agent persistent SSH sessions", () => {
  it("rechecks host access and reattaches the SAME remote tmux after app restart", async () => {
    const f = fixture();
    const now = new Date().toISOString();
    const session: Session = {
      id: "12345678-1234-4abc-8def-0123456789ab",
      deviceId: DEVICE.id,
      ownerId: DEVICE.ownerId,
      serverId: "42",
      state: "RUNNING",
      runtimeMode: "tmux",
      pinned: true,
      cols: 120,
      rows: 30,
      createdAt: now,
      updatedAt: now,
      output: "",
      sequence: 0,
      attachments: [],
      writeLease: null,
      failureReason: null,
    };
    f.stored.set("agent-sessions", [session]);
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    expect(ops.sessionStatus(DEVICE, session.id).state).toBe("FAILED");
    const reattached = await ops.attachSession(DEVICE, session.id, "read-only");
    expect(reattached.session.state).toBe("RUNNING");
    expect(f.ctx.hosts.checkAccess).toHaveBeenCalledWith(42, "connect");
    expect(f.stream.write).toHaveBeenCalledWith(
      "tmux new-session -A -s cat-agent-12345678-123\n",
    );
    await ops.stop();
  });

  it("never reconnects an expired or revoked owner grant", async () => {
    const f = fixture();
    const now = new Date().toISOString();
    f.stored.set("agent-sessions", [
      {
        id: "99999999-1234-4abc-8def-0123456789ab",
        deviceId: DEVICE.id,
        ownerId: DEVICE.ownerId,
        serverId: "42",
        state: "RUNNING",
        runtimeMode: "tmux",
        pinned: true,
        cols: 120,
        rows: 30,
        createdAt: now,
        updatedAt: now,
        output: "",
        sequence: 0,
        attachments: [],
        writeLease: null,
        failureReason: null,
      },
    ]);
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    const disabled = { ...DEVICE, accessMode: "selected" as const };
    await expect(
      ops.attachSession(
        disabled,
        "99999999-1234-4abc-8def-0123456789ab",
        "read-only",
      ),
    ).rejects.toMatchObject({ code: "TMUX_RECONNECT_FAILED" });
    expect(f.ctx.ssh.connect).not.toHaveBeenCalled();
    await ops.stop();
  });
});

describe("Local Agent structured SSH tasks", () => {
  it("does not execute a remote command when cancellation arrives before SSH exec", async () => {
    const f = fixture();
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    const job = await ops.createJob(
      DEVICE,
      "42",
      "touch /should-not-run",
      30000,
    );
    const canceled = await ops.cancelJob(DEVICE, job.id);
    expect(["QUEUED", "RUNNING", "CANCELED"]).toContain(canceled.state);
    await vi.waitFor(() => {
      expect(ops.getJob(DEVICE, job.id).state).toBe("CANCELED");
    });
    expect(f.client.exec).not.toHaveBeenCalled();
    await ops.stop();
  });
});

describe("v12 future host permissions", () => {
  it("sees new owned hosts in all mode and only opted-in selected folders", async () => {
    const f = fixture();
    const hosts: PluginHostSummary[] = [
      {
        id: 42,
        userId: DEVICE.ownerId,
        folder: "lab",
        name: "old",
        ip: "10.0.0.42",
        port: 22,
        username: "root",
        tags: "",
        authType: "password",
      },
    ];
    f.ctx.hosts.list = vi.fn(async () => hosts);
    const ops = new AgentOperations(f.ctx);
    const fixed = {
      ...DEVICE,
      accessMode: "selected" as const,
      projectIds: [projectId("lab")],
      hostIds: [42],
    };
    expect((await ops.publicHosts(fixed)).map((row) => row.serverId)).toEqual([
      "42",
    ]);
    hosts.push(
      { ...hosts[0], id: 43, name: "new" },
      { ...hosts[0], id: 44, folder: "other", name: "outside" },
      { ...hosts[0], id: 45, userId: "another-user", name: "private" },
    );
    expect((await ops.publicHosts(DEVICE)).map((row) => row.serverId)).toEqual([
      "42",
      "43",
      "44",
    ]);
    expect((await ops.publicHosts(fixed)).map((row) => row.serverId)).toEqual([
      "42",
    ]);
    const dynamic = { ...fixed, includeFutureHosts: true };
    expect((await ops.publicHosts(dynamic)).map((row) => row.serverId)).toEqual(
      ["42", "43"],
    );
    expect(await ops.assertHost(dynamic, "43")).toBe(43);
    await expect(ops.assertHost(dynamic, "44")).rejects.toMatchObject({
      code: "SERVER_DENIED",
    });
    await expect(ops.assertHost(dynamic, "45")).rejects.toMatchObject({
      code: "SERVER_DENIED",
    });
    hosts[1].folder = "other";
    await expect(ops.assertHost(dynamic, "43")).rejects.toMatchObject({
      code: "SERVER_DENIED",
    });
    await ops.stop();
  });

  it("closes existing connections and leases after a grant is narrowed or revoked", async () => {
    const f = fixture();
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    const session = await ops.createSession(DEVICE, { serverId: "42" });
    await ops.disconnectDevice(DEVICE.id);
    expect(ops.sessionStatus(DEVICE, session.id)).toMatchObject({
      state: "CLOSED",
      writeLease: null,
      attachments: [],
    });
    expect(f.dispose).toHaveBeenCalled();
    await ops.stop();
  });
});
