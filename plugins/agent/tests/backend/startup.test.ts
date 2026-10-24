import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { activate } from "../../src/backend/index.js";

function fixture(mode: "slow" | "error") {
  const stored = new Map<string, unknown>();
  const writes: string[] = [];
  const log = { info: vi.fn(), error: vi.fn() };
  let resume: (value: unknown) => void = () => undefined;
  const pending = new Promise<unknown>((resolve) => {
    resume = resolve;
  });
  const cleanup: Array<() => void | Promise<void>> = [];
  const router = express.Router();
  const app = express();
  app.use("/agent", router);
  app.use("/plugin-api/agent", router);
  const ctx = {
    log,
    http: { router: () => router },
    disposables: { add: (fn: () => void | Promise<void>) => cleanup.push(fn) },
    kv: {
      get: vi.fn(async (key: string) => {
        if (key === "agent-jobs-index-v2") {
          if (mode === "error") throw new Error("database is locked");
          return pending;
        }
        return stored.get(key) ?? null;
      }),
      set: vi.fn(async (key: string, value: unknown) => {
        writes.push(key);
        stored.set(key, structuredClone(value));
      }),
      delete: vi.fn(async (key: string) => stored.delete(key)),
    },
  } as unknown as PluginContext;
  return { app, ctx, stored, writes, cleanup, resume, log };
}

describe("Local Agent startup does not lose its router during slow migrations", () => {
  it("mounts immediately, reports RESTORING, then accepts API reads only after restore", async () => {
    const f = fixture("slow");
    // The deferred KV get stands in for a migration lasting over 30 seconds.
    await activate(f.ctx);
    expect(f.cleanup).toHaveLength(1);
    const health = await request(f.app).get("/agent/v1/health").expect(503);
    expect(health.body).toMatchObject({
      status: "restoring",
      code: "AGENT_RESTORING",
    });
    expect(health.headers["retry-after"]).toBe("5");
    await request(f.app).get("/plugin-api/agent/v1/health").expect(503);
    await request(f.app).get("/agent/v1/servers").expect(503);
    await request(f.app)
      .post("/agent/v1/auth/device-requests")
      .send({ deviceName: "test" })
      .expect(503);
    expect(f.writes).toEqual([]);
    f.resume(null);
    await vi.waitFor(async () => {
      const ready = await request(f.app).get("/agent/v1/health");
      expect(ready.status).toBe(200);
      expect(ready.body).toMatchObject({ status: "ok", version: "v1" });
    });
    await request(f.app).get("/plugin-api/agent/v1/health").expect(200);
    // 401 means the route is now alive and is enforcing device signatures.
    await request(f.app).get("/agent/v1/servers").expect(401);
    await f.cleanup[0]();
  });

  it("keeps the diagnostic route on restore failure and never rewrites partial history", async () => {
    const f = fixture("error");
    f.stored.set("agent-jobs", [
      { id: "old-job", state: "FAILED", stdout: "keep historical output" },
    ]);
    await activate(f.ctx);
    await vi.waitFor(() => {
      expect(f.log.error).toHaveBeenCalled();
    });
    const health = await request(f.app).get("/agent/v1/health").expect(503);
    expect(health.body).toMatchObject({
      status: "failed",
      code: "AGENT_RESTORE_FAILED",
    });
    expect(JSON.stringify(health.body)).not.toContain("database is locked");
    await request(f.app).get("/agent/v1/servers").expect(503);
    await f.cleanup[0]();
    expect(f.writes).toEqual([]);
    expect(f.stored.get("agent-jobs")).toEqual([
      { id: "old-job", state: "FAILED", stdout: "keep historical output" },
    ]);
  });
});
