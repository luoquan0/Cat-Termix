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
  allowsTransport,
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
  it("keeps folders stable and rejects unknown IDs", () => {
    expect(projectFolder(projectId("Production / Linux"))).toBe(
      "Production / Linux",
    );
    expect(projectFolder(projectId(null))).toBeNull();
    expect(() => projectFolder("unknown-project")).toThrow();
  });
});
