import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import express, { type Router } from "express";
import { createMockCtx } from "@termix/plugin-sdk/testing";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { activate } from "../../src/backend/index";
import {
  canonicalDeviceRequest,
  projectId,
  sha256,
} from "../../src/backend/identity";
import manifestJson from "../../manifest.json";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
async function fixture() {
  const manifest = manifestJson as unknown as PluginManifest;
  let router: Router;
  const hosts = [
    {
      id: 1,
      userId: "owner",
      name: "old",
      ip: "10.0.0.1",
      port: 22,
      username: "root",
      tags: "",
      folder: "lab",
      authType: "password",
    },
  ];
  const mock = createMockCtx({
    pluginId: "agent",
    manifest,
    capabilities: manifest.capabilities,
    permissions: ["agent.manage"],
    hosts,
    router: () => (router = express.Router()),
  });
  mock.ctx.hosts.list = async () => hosts;
  await activate(mock.ctx);
  const app = express();
  app.use((req, _res, next) => {
    const owner = req.header("x-test-user") ?? "owner";
    mock.setActor(owner);
    Object.assign(req, {
      userId: owner,
      sessionId: req.header("x-no-session") ? undefined : "web-session",
    });
    next();
  });
  app.use((req, res, next) => router(req, res, next));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  mock.ctx.http.baseUrl = () => base;
  async function request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        origin: base,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const keys = generateKeyPairSync("ed25519");
  const enrollment = await request("POST", "/v1/auth/device-requests", {
    deviceName: "client",
    publicKey: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  });
  const pending = enrollment.body.request;
  const approved = await request(
    "POST",
    `/admin/requests/${pending.requestId}/approve`,
    {
      code: pending.code,
      scopes: ["files:read"],
      accessMode: "selected",
      projectIds: [projectId("lab")],
      includeFutureHosts: true,
    },
  );
  expect(approved.status).toBe(201);
  const device = approved.body.device;
  async function servers() {
    const path = "/v1/servers";
    const timestamp = String(Date.now());
    const nonce = randomBytes(18).toString("base64url");
    const requestId = randomBytes(10).toString("hex");
    const bodyHash = sha256("");
    const signature = sign(
      null,
      Buffer.from(
        canonicalDeviceRequest({
          method: "GET",
          pathAndQuery: path,
          timestamp,
          nonce,
          bodyHash,
          requestId,
        }),
      ),
      keys.privateKey,
    ).toString("base64url");
    return request("GET", path, undefined, {
      "x-cloudssh-device-id": device.id,
      "x-cloudssh-timestamp": timestamp,
      "x-cloudssh-nonce": nonce,
      "x-cloudssh-body-sha256": bodyHash,
      "x-cloudssh-signature": signature,
      "x-request-id": requestId,
    });
  }
  async function signedJob(payload: Record<string, unknown>, key: string) {
    const path = "/v1/jobs";
    const timestamp = String(Date.now());
    const nonce = randomBytes(18).toString("base64url");
    const requestId = randomBytes(10).toString("hex");
    const bodyHash = sha256(JSON.stringify(payload));
    const signature = sign(
      null,
      Buffer.from(
        canonicalDeviceRequest({
          method: "POST",
          pathAndQuery: path,
          timestamp,
          nonce,
          bodyHash,
          idempotencyKey: key,
          requestId,
        }),
      ),
      keys.privateKey,
    ).toString("base64url");
    return request("POST", path, payload, {
      "x-cloudssh-device-id": device.id,
      "x-cloudssh-timestamp": timestamp,
      "x-cloudssh-nonce": nonce,
      "x-cloudssh-body-sha256": bodyHash,
      "x-cloudssh-signature": signature,
      "x-request-id": requestId,
      "idempotency-key": key,
    });
  }
  return { request, device, hosts, servers, signedJob };
}

describe("critical root execution authorization", () => {
  it("never grants sudo by default, requires jobs:execute, and allows retry after scope denial", async () => {
    const f = await fixture();
    const path = `/admin/devices/${f.device.id}`;
    const devices = (await f.request("GET", "/admin/devices")).body.devices;
    expect(devices[0].scopes).not.toContain("sudo:execute");
    expect(
      (
        await f.request("PATCH", path, {
          scopes: ["files:read", "sudo:execute"],
        })
      ).status,
    ).toBe(400);
    const payload = { serverId: "1", command: "id -u", sudo: true };
    const denied = await f.signedJob(payload, "sudo-grant-retry");
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("SCOPE_DENIED");
    const granted = await f.request("PATCH", path, {
      scopes: ["files:read", "jobs:execute", "sudo:execute"],
    });
    expect(granted.status).toBe(200);
    expect(granted.body.device.scopes).toContain("sudo:execute");
    const accepted = await f.signedJob(payload, "sudo-grant-retry");
    expect(accepted.status).toBe(202);
    expect(accepted.body.job).toMatchObject({
      command: "id -u",
      sudo: true,
    });
    expect(JSON.stringify(accepted.body)).not.toContain("sudoPassword");
    await f.request("PATCH", path, {
      scopes: ["files:read", "jobs:execute"],
    });
    const revoked = await f.signedJob(payload, "sudo-grant-after-revocation");
    expect(revoked.status).toBe(403);
    expect(revoked.body.code).toBe("SCOPE_DENIED");
  });
});

describe("editable Agent grant API", () => {
  it("includes a newly added host, edits scopes without re-pairing, then removes the revoked device", async () => {
    const f = await fixture();
    f.hosts.push({ ...f.hosts[0], id: 2, name: "new", ip: "10.0.0.2" });
    const listed = await f.servers();
    expect(listed.status).toBe(200);
    expect(
      listed.body.servers.map((row: { serverId: string }) => row.serverId),
    ).toEqual(["1", "2"]);
    const edited = await f.request("PATCH", `/admin/devices/${f.device.id}`, {
      scopes: ["files:read", "files:write"],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.device).toMatchObject({
      id: f.device.id,
      fingerprint: f.device.fingerprint,
      includeFutureHosts: true,
      scopes: ["files:read", "files:write"],
    });
    expect(edited.body.device).not.toHaveProperty("publicKey");
    expect(
      (await f.request("DELETE", `/admin/devices/${f.device.id}`)).status,
    ).toBe(200);
    expect((await f.request("GET", "/admin/devices")).body.devices).toEqual([]);
    expect((await f.servers()).status).toBe(401);
  });
  it("requires the owner's interactive same-origin session for edits", async () => {
    const f = await fixture();
    const path = `/admin/devices/${f.device.id}`;
    expect(
      (
        await f.request(
          "PATCH",
          path,
          { scopes: ["files:write"] },
          { origin: "https://untrusted.invalid" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "PATCH",
          path,
          { scopes: ["files:write"] },
          { "x-no-session": "1" },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await f.request(
          "PATCH",
          path,
          { scopes: ["files:write"] },
          { "x-test-user": "other" },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await f.request("PATCH", path, {
          accessMode: "selected",
          projectIds: [projectId("not-owned")],
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.request("GET", "/admin/devices")).body.devices[0].scopes,
    ).toEqual(["files:read"]);
  });
});
