import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { AgentRecordCollection } from "../../src/backend/persistence.js";

type Row = { id: string; output: string; status: string };

function fixture() {
  const data = new Map<string, unknown>();
  const set = vi.fn(async (key: string, value: unknown) => {
    // MySQL's TEXT column is smaller than the plugin SDK's 256 KiB cap.
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 65_535) {
      throw new Error("Data too long for column value");
    }
    data.set(key, structuredClone(value));
  });
  const ctx = {
    kv: {
      get: async (key: string) => data.get(key),
      set,
      delete: async (key: string) => data.delete(key),
    },
  } as unknown as PluginContext;
  const create = () =>
    new AgentRecordCollection<Row>(
      ctx,
      "agent-jobs",
      "agent-jobs-index-v2",
      "agent-job-v2",
      300,
    );
  return { data, set, ctx, create };
}

describe("Agent record storage across database backends", () => {
  it("migrates existing v24 history without deleting rollback data", async () => {
    const f = fixture();
    const legacy: Row[] = [
      { id: "old-one", output: "old data", status: "FAILED" },
    ];
    f.data.set("agent-jobs", structuredClone(legacy));
    const records = f.create();
    expect(await records.load()).toEqual(legacy);
    expect(f.data.get("agent-jobs")).toEqual(legacy);
    expect(f.data.get("agent-jobs-index-v2")).toEqual(["old-one"]);
    expect(await f.create().load()).toEqual(legacy);
  });

  it("round-trips incompressible output larger than 256 KiB in bounded chunks", async () => {
    const f = fixture();
    const store = f.create();
    await store.load();
    const large = randomBytes(480_000).toString("base64");
    await store.save([{ id: "large-job", output: large, status: "RUNNING" }]);
    expect(await f.create().load()).toEqual([
      { id: "large-job", output: large, status: "RUNNING" },
    ]);
    for (const [, value] of f.data) {
      expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBeLessThan(
        65_536,
      );
    }
  });

  it("retains the last complete generation if a replacement write fails", async () => {
    const f = fixture();
    const store = f.create();
    await store.load();
    const original: Row = {
      id: "original",
      output: randomBytes(100_000).toString("base64"),
      status: "QUEUED",
    };
    await store.save([original]);
    const previous = await f.create().load();
    const originalSet = f.ctx.kv.set.bind(f.ctx.kv);
    f.ctx.kv.set = vi.fn(async (key: string, value: unknown) => {
      if (key === "agent-job-v2:original") {
        throw new Error("interrupted before manifest commit");
      }
      return originalSet(key, value);
    });
    await expect(
      store.save([{ ...original, output: randomBytes(300_000).toString("base64") }]),
    ).rejects.toThrow("interrupted");
    expect(await f.create().load()).toEqual(previous);
  });
});
