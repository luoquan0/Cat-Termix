import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startServer, type TestServer } from "./helpers";
import { validateUpdatePolicy } from "../../src/shared/update-policy";
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
