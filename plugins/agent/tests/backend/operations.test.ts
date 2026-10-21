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
      execSudo: vi.fn(
        async (
          _hostId: number,
          _command: string,
          options: {
            onStdout?: (chunk: string) => void;
            onStderr?: (chunk: string) => void;
          },
        ) => {
          options.onStdout?.("0\n");
          return { exitCode: 0 };
        },
      ),
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

describe("Local Agent job recovery and SSH handshake timeout", () => {
  it("recovers only a persisted job from the same device", async () => {
    const f = fixture();
    f.client.exec = vi.fn((_command: string, done: (error: Error) => void) =>
      done(new Error("SSH exec rejected")),
    );
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    const job = await ops.createJob(
      DEVICE,
      "42",
      "echo once",
      30_000,
      false,
      "original-key",
    );
    expect(job).not.toHaveProperty("requestKey");
    expect(ops.recoverJob(DEVICE, "original-key")?.id).toBe(job.id);
    expect(
      ops.recoverJob({ ...DEVICE, id: "other-device" }, "original-key"),
    ).toBeUndefined();
    await vi.waitFor(() =>
      expect(ops.getJob(DEVICE, job.id).state).toBe("FAILED"),
    );
    const restored = new AgentOperations(f.ctx);
    await restored.restore();
    expect(restored.recoverJob(DEVICE, "original-key")?.id).toBe(job.id);
    expect(f.client.exec).toHaveBeenCalledTimes(1);
    await ops.stop();
    await restored.stop();
  });

  it("times out a stalled connection and disposes a late arrival", async () => {
    const f = fixture();
    let resolveConnection:
      | ((value: {
          client: typeof f.client;
          dispose: typeof f.dispose;
        }) => void)
      | undefined;
    f.ctx.ssh.connect = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveConnection = resolve;
        }),
    ) as unknown as typeof f.ctx.ssh.connect;
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    const job = await ops.createJob(DEVICE, "42", "echo no", 1_000);
    await vi.waitFor(
      () => expect(ops.getJob(DEVICE, job.id).state).toBe("TIMED_OUT"),
      { timeout: 3_000 },
    );
    resolveConnection?.({ client: f.client, dispose: f.dispose });
    await vi.waitFor(() => expect(f.dispose).toHaveBeenCalled());
    expect(f.client.exec).not.toHaveBeenCalled();
    await ops.stop();
  });

  it("cancels a connecting job without running a late command", async () => {
    const f = fixture();
    let resolveConnection:
      | ((value: {
          client: typeof f.client;
          dispose: typeof f.dispose;
        }) => void)
      | undefined;
    f.ctx.ssh.connect = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveConnection = resolve;
        }),
    ) as unknown as typeof f.ctx.ssh.connect;
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    const job = await ops.createJob(DEVICE, "42", "echo no", 30_000);
    await vi.waitFor(() => expect(f.ctx.ssh.connect).toHaveBeenCalled());
    await ops.cancelJob(DEVICE, job.id);
    await vi.waitFor(() =>
      expect(ops.getJob(DEVICE, job.id).state).toBe("CANCELED"),
    );
    resolveConnection?.({ client: f.client, dispose: f.dispose });
    await vi.waitFor(() => expect(f.dispose).toHaveBeenCalled());
    expect(f.client.exec).not.toHaveBeenCalled();
    await ops.stop();
  });
});

describe("Local Agent job persistence failures", () => {
  it("does not leave QUEUED ghosts or execute when initial storage fails", async () => {
    const f = fixture();
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    const originalSet = f.ctx.kv.set.bind(f.ctx.kv);
    let failOnce = true;
    f.ctx.kv.set = vi.fn(async (key: string, value: unknown) => {
      if (key === "agent-jobs" && failOnce) {
        failOnce = false;
        throw new Error("storage unavailable");
      }
      await originalSet(key, value);
    });
    await expect(
      ops.createJob(DEVICE, "42", "echo never", 30_000, false, "key"),
    ).rejects.toMatchObject({ code: "JOB_PERSIST_FAILED" });
    expect(await ops.listJobs(DEVICE)).toEqual([]);
    expect(f.ctx.ssh.connect).not.toHaveBeenCalled();
    await ops.stop();
  });
});

describe("root execution requires an explicit opt-in device grant", () => {
  it("denies sudo by default without opening SSH and preserves ordinary job behavior", async () => {
    const f = fixture();
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    await expect(
      ops.createJob(DEVICE, "42", "id -u", 30000, true),
    ).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    expect(f.ctx.ssh.execSudo).not.toHaveBeenCalled();
    expect(f.ctx.ssh.connect).not.toHaveBeenCalled();
    await expect(
      ops.createJob(
        { ...DEVICE, scopes: ["sudo:execute"] },
        "42",
        "id -u",
        30000,
        true,
      ),
    ).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    await expect(
      ops.createJob(DEVICE, "42", "id -u", 30000, "true"),
    ).rejects.toMatchObject({ code: "INVALID_SUDO_FLAG" });
    await ops.stop();
  });

  it("runs only the opted-in sudo job through core, without copying any password into the job", async () => {
    const f = fixture();
    const device: Device = {
      ...DEVICE,
      scopes: [...DEVICE.scopes, "sudo:execute"],
    };
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    const job = await ops.createJob(device, "42", "id -u", 30000, true);
    await vi.waitFor(() => {
      expect(ops.getJob(device, job.id)).toMatchObject({
        sudo: true,
        state: "SUCCEEDED",
        stdout: "0\n",
        exitCode: 0,
      });
    });
    expect(f.ctx.ssh.execSudo).toHaveBeenCalledWith(
      42,
      "id -u",
      expect.objectContaining({
        timeoutMs: 30000,
        signal: expect.any(AbortSignal),
        onStdout: expect.any(Function),
      }),
    );
    expect(f.ctx.ssh.connect).not.toHaveBeenCalled();
    const result = JSON.stringify(ops.getJob(device, job.id));
    expect(result).not.toContain("sudoPassword");
    expect(result).not.toContain("secret");
    await ops.stop();
  });

  it("aborts a running sudo job on device grant revocation", async () => {
    const f = fixture();
    let stopped = false;
    f.ctx.ssh.execSudo = vi.fn(
      async (
        _hostId: number,
        _command: string,
        options: { signal: AbortSignal },
      ) =>
        new Promise<{ exitCode: number | null }>((_resolve, reject) => {
          const stop = () => {
            stopped = true;
            reject(new Error("Sudo command canceled"));
          };
          if (options.signal.aborted) stop();
          else options.signal.addEventListener("abort", stop, { once: true });
        }),
    );
    const device: Device = {
      ...DEVICE,
      scopes: [...DEVICE.scopes, "sudo:execute"],
    };
    const ops = new AgentOperations(f.ctx);
    await ops.restore();
    const job = await ops.createJob(device, "42", "sleep 30", 30000, true);
    await vi.waitFor(() => expect(f.ctx.ssh.execSudo).toHaveBeenCalled());
    await ops.disconnectDevice(device.id);
    await vi.waitFor(() => {
      expect(ops.getJob(device, job.id).state).toBe("CANCELED");
    });
    expect(stopped).toBe(true);
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
