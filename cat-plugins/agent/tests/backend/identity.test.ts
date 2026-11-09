import { describe, expect, it } from "vitest";
import {
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from "node:crypto";
import type { Request } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import {
  AgentStore,
  AgentPreconditionError,
  requireScope,
  allowsTransport,
  resolveTransportPolicy,
  canonicalDeviceRequest,
  projectFolder,
  projectId,
  sha256,
  validateTransportPolicy,
} from "../../src/backend/identity.js";

function fakeContext(): PluginContext {
  const state = new Map<string, unknown>();
  return {
    kv: {
      get: async (key: string) => state.get(key),
      set: async (key: string, value: unknown) => {
        state.set(key, structuredClone(value));
      },
      delete: async (key: string) => state.delete(key),
      list: async () => [...state.keys()],
    },
  } as unknown as PluginContext;
}
function signedRequest(
  publicPath: string,
  privateKey: KeyObject,
  deviceId: string,
  body: Buffer = Buffer.alloc(0),
  nonce = randomBytes(18).toString("base64url"),
): Request {
  const timestamp = String(Date.now());
  const digest = sha256(body);
  const requestId = "test-" + randomBytes(6).toString("hex");
  const signature = sign(
    null,
    Buffer.from(
      canonicalDeviceRequest({
        method: "GET",
        pathAndQuery: publicPath,
        timestamp,
        nonce,
        bodyHash: digest,
        idempotencyKey: "",
        requestId,
      }),
    ),
    privateKey,
  ).toString("base64url");
  const headers = new Map([
    ["x-cloudssh-device-id", deviceId],
    ["x-cloudssh-timestamp", timestamp],
    ["x-cloudssh-nonce", nonce],
    ["x-cloudssh-body-sha256", digest],
    ["x-cloudssh-signature", signature],
    ["x-request-id", requestId],
  ]);
  return {
    method: "GET",
    originalUrl: publicPath,
    get: (name: string) => headers.get(name.toLowerCase()),
    params: {},
  } as unknown as Request;
}
describe("Local Agent signed identity", () => {
  it("pairs an Ed25519 device, verifies signatures, and rejects nonce reuse", async () => {
    const store = new AgentStore(fakeContext());
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey
      .export({ format: "pem", type: "spki" })
      .toString();
    const { code, requestId } = await store.createRequest(
      "Laptop AI",
      publicKey,
    );
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const device = await store.approve("u1", code, {
      scopes: ["jobs:execute", "files:read"],
      accessMode: "all",
      projectIds: [],
      hostIds: [],
    });
    const url = "/agent/v1/servers";
    const req = signedRequest(url, keys.privateKey, device.id);
    expect(await store.authenticate(req, Buffer.alloc(0))).toMatchObject({
      id: device.id,
    });
    await expect(
      store.authenticate(req, Buffer.alloc(0)),
    ).rejects.toMatchObject({
      code: "DEVICE_REQUEST_REPLAYED",
    });
    const registration = signedRequest(
      "/agent/v1/auth/device-requests/" + requestId,
      keys.privateKey,
      "",
      Buffer.alloc(0),
    );
    registration.params = { requestId };
    expect(await store.poll(registration)).toEqual({
      status: "approved",
      deviceId: device.id,
    });
    await store.revoke("u1", device.id);
    await expect(
      store.authenticate(
        signedRequest(url, keys.privateKey, device.id),
        Buffer.alloc(0),
      ),
    ).rejects.toMatchObject({ code: "DEVICE_NOT_AUTHORIZED" });
  });
  it("rejects a mismatching body without burning the signed nonce", async () => {
    const store = new AgentStore(fakeContext());
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey
      .export({ format: "pem", type: "spki" })
      .toString();
    const { code } = await store.createRequest("Laptop AI", publicKey);
    const device = await store.approve("u1", code, {
      scopes: ["jobs:execute"],
      accessMode: "all",
      projectIds: [],
      hostIds: [],
    });
    const req = signedRequest("/agent/v1/servers", keys.privateKey, device.id);
    await expect(
      store.authenticate(req, Buffer.from("tampered")),
    ).rejects.toMatchObject({
      code: "DEVICE_BODY_TAMPERED",
    });
    expect(await store.authenticate(req, Buffer.alloc(0))).toMatchObject({
      id: device.id,
    });
  });
});
describe("Local Agent durable idempotency", () => {
  it("stores successful results and rejects reuse for a different command", async () => {
    const store = new AgentStore(fakeContext());
    let count = 0;
    const invoke = () =>
      store.replay("device-a", "request-1", "command-a", async () => {
        count += 1;
        return { jobId: "job-one" };
      });
    expect(await invoke()).toEqual({ jobId: "job-one" });
    expect(await invoke()).toEqual({ jobId: "job-one" });
    expect(count).toBe(1);
    await expect(
      store.replay("device-a", "request-1", "command-b", async () => {
        count += 1;
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(count).toBe(1);
  });
  it("recovers proven durable job results without rerunning uncertain mutations", async () => {
    const ctx = fakeContext();
    const original = new AgentStore(ctx);
    let executed = 0;
    await expect(
      original.replay("device-a", "request-2", "hash-2", async () => {
        executed++;
        throw new Error("response lost after durable job");
      }),
    ).rejects.toThrow("response lost");
    const restored = new AgentStore(ctx);
    const recovered = await restored.replay(
      "device-a",
      "request-2",
      "hash-2",
      async () => {
        executed++;
        return { jobId: "duplicate" };
      },
      () => ({ jobId: "original" }),
    );
    expect(recovered).toEqual({ jobId: "original" });
    expect(
      await restored.replay("device-a", "request-2", "hash-2", async () => {
        executed++;
        return { jobId: "duplicate" };
      }),
    ).toEqual(recovered);
    expect(executed).toBe(1);
    expect(
      (await restored.read()).idempotency["device-a:request-2"].pending,
    ).toBe(false);
  });

  it("preserves uncertain results across new AgentStore instances", async () => {
    const ctx = fakeContext();
    const original = new AgentStore(ctx);
    await expect(
      original.replay("device-a", "request-1", "command-a", async () => {
        throw new Error("remote outcome unknown");
      }),
    ).rejects.toThrow("remote outcome unknown");
    let retried = false;
    const restored = new AgentStore(ctx);
    await expect(
      restored.replay("device-a", "request-1", "command-a", async () => {
        retried = true;
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_OUTCOME_UNKNOWN" });
    expect(retried).toBe(false);
  });
});

describe("Local Agent HTTP and project scope", () => {
  it("disallows public networks and global CIDR, defaults HTTP off", () => {
    for (const cidr of [
      "0.0.0.0/0",
      "203.0.113.10/32",
      "192.168.0.0/8",
      "192.168.1.5/24junk",
    ]) {
      expect(() =>
        validateTransportPolicy({ allowHttp: true, allowedCidrs: [cidr] }),
      ).toThrow();
    }
    expect(
      allowsTransport(false, "192.168.7.9", {
        allowHttp: false,
        allowedCidrs: [],
      }),
    ).toBe(false);
    const policy = validateTransportPolicy({
      allowHttp: true,
      allowedCidrs: ["192.168.7.9/32"],
    });
    expect(allowsTransport(false, "192.168.7.9", policy)).toBe(true);
    expect(allowsTransport(false, "192.168.7.10", policy)).toBe(false);
    expect(allowsTransport(true, "203.0.113.7", policy)).toBe(true);
  });
  it("applies an environment-locked policy to the actual transport gate", () => {
    const saved = { allowHttp: true, allowedCidrs: ["10.0.0.1/32"] };
    expect(resolveTransportPolicy(saved, {})).toEqual(saved);
    expect(
      resolveTransportPolicy(saved, {
        CLOUDSSH_AGENT_HTTP_POLICY_LOCKED: "true",
        CLOUDSSH_AGENT_ALLOW_HTTP: "false",
      }),
    ).toEqual({ allowHttp: false, allowedCidrs: [] });
    expect(
      resolveTransportPolicy(saved, {
        CLOUDSSH_AGENT_HTTP_POLICY_LOCKED: "true",
        CLOUDSSH_AGENT_ALLOW_HTTP: "true",
        CLOUDSSH_AGENT_HTTP_ALLOWED_CIDRS: "203.0.113.0/24",
      }),
    ).toEqual({ allowHttp: false, allowedCidrs: [] });
  });
  it("keeps folders stable and rejects unknown IDs", () => {
    expect(projectFolder(projectId("Production / Linux"))).toBe(
      "Production / Linux",
    );
    expect(projectFolder(projectId(null))).toBeNull();
    expect(() => projectFolder("unknown-project")).toThrow();
  });
});

describe("v12 editable and removable device grants", () => {
  async function paired() {
    const ctx = fakeContext();
    const store = new AgentStore(ctx);
    const keys = generateKeyPairSync("ed25519");
    const { code, requestId } = await store.createRequest(
      "Client",
      keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    );
    const device = await store.approve("u1", code, {
      scopes: ["files:read"],
      accessMode: "selected",
      projectIds: [projectId("lab")],
      hostIds: [1],
    });
    return { ctx, store, keys, device, requestId };
  }

  it("edits scopes and future hosts without rotating the paired identity", async () => {
    const { store, keys, device } = await paired();
    expect(device.includeFutureHosts).toBe(false);
    await expect(
      store.updateGrant("other-user", device.id, {
        ...device,
        scopes: ["files:write"],
      }),
    ).rejects.toMatchObject({ code: "DEVICE_NOT_FOUND" });
    const updated = await store.updateGrant("u1", device.id, {
      ...device,
      scopes: ["files:read", "files:write"],
      includeFutureHosts: true,
    });
    expect(updated).toMatchObject({
      id: device.id,
      publicKey: device.publicKey,
      fingerprint: device.fingerprint,
      includeFutureHosts: true,
    });
    const authenticated = await store.authenticate(
      signedRequest("/agent/v1/servers", keys.privateKey, device.id),
      Buffer.alloc(0),
    );
    expect(authenticated.scopes).toEqual(["files:read", "files:write"]);
    await store.updateGrant("u1", device.id, {
      ...updated,
      scopes: ["files:read"],
    });
    const narrowed = await store.authenticate(
      signedRequest("/agent/v1/servers", keys.privateKey, device.id),
      Buffer.alloc(0),
    );
    expect(() => requireScope(narrowed, "files:write")).toThrow(
      AgentPreconditionError,
    );
  });

  it("removes revoked records, enrollment references and replay state, then denies the old key", async () => {
    const { store, keys, device, requestId } = await paired();
    await store.authenticate(
      signedRequest("/agent/v1/servers", keys.privateKey, device.id),
      Buffer.alloc(0),
    );
    await store.replay(device.id, "mutation", "hash", async () => ({
      ok: true,
    }));
    await store.revoke("u1", device.id);
    const state = await store.read();
    expect(state.devices).toEqual([]);
    expect(state.requests.some((row) => row.requestId === requestId)).toBe(
      false,
    );
    expect(
      Object.keys(state.nonces).some((key) =>
        key.startsWith("device:" + device.id + ":"),
      ),
    ).toBe(false);
    expect(Object.keys(state.idempotency)).toEqual([]);
    await expect(
      store.authenticate(
        signedRequest("/agent/v1/servers", keys.privateKey, device.id),
        Buffer.alloc(0),
      ),
    ).rejects.toMatchObject({ code: "DEVICE_NOT_AUTHORIZED" });
  });

  it("rejects invalid edits without changing the previous permission", async () => {
    const { store, device } = await paired();
    await expect(
      store.updateGrant("u1", device.id, { ...device, scopes: [] }),
    ).rejects.toMatchObject({ code: "INVALID_GRANT" });
    await expect(
      store.updateGrant("u1", device.id, { ...device, expiresAt: "yesterday" }),
    ).rejects.toMatchObject({ code: "INVALID_GRANT" });
    expect((await store.read()).devices[0].scopes).toEqual(["files:read"]);
  });

  it("cleans historical revoked rows instead of displaying them forever", async () => {
    const { ctx, store, device } = await paired();
    const state = structuredClone(await store.read());
    state.devices[0] = { ...device, revokedAt: new Date().toISOString() };
    await ctx.kv.set("agent-v1-state", state);
    expect((await store.read()).devices).toEqual([]);
  });

  it("allows a safely denied request to succeed after permissions are edited without a false 409", async () => {
    const { store, device } = await paired();
    let writes = 0;
    await expect(
      store.replay(device.id, "same-request", "same-hash", async () => {
        requireScope(device, "files:write");
        writes += 1;
      }),
    ).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    expect(writes).toBe(0);
    const updated = await store.updateGrant("u1", device.id, {
      ...device,
      scopes: ["files:read", "files:write"],
    });
    const invoke = () =>
      store.replay(device.id, "same-request", "same-hash", async () => {
        requireScope(updated, "files:write");
        writes += 1;
        return { done: true };
      });
    expect(await invoke()).toEqual({ done: true });
    expect(await invoke()).toEqual({ done: true });
    expect(writes).toBe(1);
  });
});
