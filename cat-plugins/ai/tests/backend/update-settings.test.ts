import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, type TestServer } from "./helpers";
import {
  resolveUpdateRequestProgress,
  validateUpdatePolicy,
} from "../../src/shared/update-policy";
let server: TestServer;
let directory: string | undefined;
afterEach(async () => {
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
  vi.restoreAllMocks();
});
describe("administrator-only update configuration", () => {
  it("does not grant updater authority through AI auto execution permission", async () => {
    server = await startServer();
    expect((await server.request("GET", "/updates")).body).toEqual({
      canManage: false,
    });
    expect(
      (
        await server.request("PUT", "/updates", {
          body: { enabled: true, intervalHours: 1, proxyUrl: "" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await server.request("POST", "/updates/apply", {
          body: { confirmRestart: true },
        })
      ).status,
    ).toBe(403);
  });
  it("validates proxy origins and strips unrecognized control fields", () => {
    expect(
      validateUpdatePolicy({
        enabled: false,
        intervalHours: 6,
        proxyUrl: "https://proxy:7890",
        command: "rm",
      }),
    ).toEqual({
      enabled: false,
      intervalHours: 6,
      proxyUrl: "https://proxy:7890",
    });
    for (const proxyUrl of [
      "file:///etc/passwd",
      "http://localhost/path",
      "https://localhost/?url=other",
    ])
      expect(() =>
        validateUpdatePolicy({ enabled: true, intervalHours: 1, proxyUrl }),
      ).toThrow();
  });
});

describe("authorized updater policy storage", () => {
  it("saves a proxy without reflecting credentials, retains it and requires explicit restart consent", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "cat-update-settings-"));
    server = await startServer({
      permissions: ["ai.manage_updates", "admin.settings.manage"],
    });
    vi.spyOn(server.mock.ctx.files, "dataDir").mockResolvedValue(directory);
    const policy = {
      enabled: false,
      intervalHours: 6,
      proxyUrl: "http://tester:password@localhost:7890",
    };
    expect(
      (await server.request("PUT", "/updates", { body: policy })).status,
    ).toBe(200);
    const loaded = await server.request("GET", "/updates");
    expect(loaded.body).toMatchObject({
      canManage: true,
      installed: false,
      proxyConfigured: true,
      policy: { proxyUrl: "http://localhost:7890" },
    });
    expect(JSON.stringify(loaded.body)).not.toContain("password");
    expect(
      (
        await server.request("PUT", "/updates", {
          body: { ...policy, proxyUrl: "", keepProxy: true },
        })
      ).status,
    ).toBe(200);
    expect(
      JSON.parse(
        await readFile(path.join(directory, "updates", "config.json"), "utf8"),
      ).proxyUrl,
    ).toBe(policy.proxyUrl);
    expect(
      (await server.request("POST", "/updates/apply", { body: {} })).status,
    ).toBe(400);
    expect(
      (
        await server.request("POST", "/updates/apply", {
          body: { confirmRestart: true },
        })
      ).status,
    ).toBe(202);
    expect(
      JSON.parse(
        await readFile(path.join(directory, "updates", "request.json"), "utf8"),
      ).action,
    ).toBe("apply");
  });
});

describe("manual updater request progress", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const at = "2026-10-10T00:00:00.000Z";
  const request = { id, action: "check", at };

  it("does not mistake old current status for a completed new check", () => {
    const old = {
      phase: "current",
      lastRequest: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      lastCheckAt: "2026-10-09T23:00:00.000Z",
      heartbeat: "2026-10-10T00:00:01.000Z",
    };
    expect(
      resolveUpdateRequestProgress(request, old, Date.parse(at) + 1000),
    ).toMatchObject({ state: "queued", action: "check" });
    expect(
      resolveUpdateRequestProgress(
        request,
        { ...old, lastRequest: id },
        Date.parse(at) + 1000,
      ),
    ).toMatchObject({ state: "running" });
    expect(
      resolveUpdateRequestProgress(
        request,
        { ...old, lastRequest: id, phase: "checking" },
        Date.parse(at) + 1000,
      ),
    ).toMatchObject({ state: "running" });
    expect(
      resolveUpdateRequestProgress(request, {
        ...old,
        lastRequest: id,
        phase: "current",
        lastCheckAt: "2026-10-10T00:00:05.000Z",
      }),
    ).toMatchObject({ state: "completed" });
    expect(
      resolveUpdateRequestProgress(request, {
        ...old,
        lastRequest: id,
        phase: "available",
        lastCheckAt: "2026-10-10T00:00:05.000Z",
      }),
    ).toMatchObject({ state: "completed" });
  });

  it("reports updater errors and expiry instead of spinning forever", () => {
    expect(
      resolveUpdateRequestProgress(
        request,
        {
          lastRequest: id,
          phase: "error",
          heartbeat: "2026-10-10T00:00:12.000Z",
        },
        Date.parse(at) + 12000,
      ),
    ).toMatchObject({ state: "failed" });
    expect(
      resolveUpdateRequestProgress(
        request,
        null,
        Date.parse(at) + 10 * 60_000 + 1,
      ),
    ).toMatchObject({ state: "timed_out" });
    expect(
      resolveUpdateRequestProgress({ ...request, action: "shell" }, null),
    ).toBeNull();
  });

  it("ends an update request when no new image exists, or installation was deferred", () => {
    const apply = { ...request, action: "apply" };
    expect(
      resolveUpdateRequestProgress(apply, {
        lastRequest: id,
        phase: "current",
        lastCheckAt: "2026-10-10T00:00:07.000Z",
      }),
    ).toMatchObject({ state: "completed" });
    expect(
      resolveUpdateRequestProgress(apply, {
        lastRequest: id,
        phase: "deferred",
        heartbeat: "2026-10-10T00:00:07.000Z",
      }),
    ).toMatchObject({ state: "completed" });
    expect(
      resolveUpdateRequestProgress(apply, {
        lastRequest: id,
        phase: "updated",
        lastSuccessAt: "2026-10-10T00:00:08.000Z",
      }),
    ).toMatchObject({ state: "completed" });
  });

  it("makes check requests visibly queued, running and completed in the authenticated API", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "cat-update-progress-"));
    server = await startServer({
      permissions: ["ai.manage_updates", "admin.settings.manage"],
    });
    vi.spyOn(server.mock.ctx.files, "dataDir").mockResolvedValue(directory);
    const posted = await server.request("POST", "/updates/check");
    expect(posted.status).toBe(202);
    expect(posted.body.accepted).toBe(true);
    expect(posted.body.requestId).toMatch(/^[a-f\d-]{36}$/i);
    const current = await server.request("GET", "/updates");
    expect(current.body.request).toMatchObject({
      id: posted.body.requestId,
      action: "check",
      state: "queued",
    });
    const root = path.join(directory, "updates", "status.json");
    const status = {
      lastRequest: posted.body.requestId,
      heartbeat: new Date().toISOString(),
      phase: "checking",
      currentRevision: "a".repeat(40),
    };
    await writeFile(root, JSON.stringify(status));
    expect(
      (await server.request("GET", "/updates")).body.request,
    ).toMatchObject({
      state: "running",
    });
    const requestedAt = JSON.parse(
      await readFile(path.join(directory, "updates", "request.json"), "utf8"),
    ).at;
    await writeFile(
      root,
      JSON.stringify({
        ...status,
        phase: "current",
        lastCheckAt: new Date(Date.parse(requestedAt) + 1000).toISOString(),
      }),
    );
    expect(
      (await server.request("GET", "/updates")).body.request,
    ).toMatchObject({
      state: "completed",
    });
  });
});
