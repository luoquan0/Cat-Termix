import { createHash, randomUUID } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { PluginContext } from "@termix/plugin-sdk/backend";

// A base64-encoded 40 KiB chunk fits both the 256 KiB plugin KV limit and
// MySQL's smaller TEXT column. Do not store unbounded session output in one KV.
const CHUNK_BYTES = 40 * 1024;
const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;

type Manifest = {
  version: 1;
  generation: string;
  chunks: number;
  digest: string;
};

function hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Record-level, copy-on-write storage. The small index is committed only
 * after every referenced record is durable. A torn write cannot overwrite
 * the previous generation's chunks. Legacy data remains for v24 rollback.
 */
export class AgentRecordCollection<T extends { id: string }> {
  private ids: string[] = [];
  private readonly lastSaved = new Map<string, string>();
  private readonly manifests = new Map<string, Manifest>();

  constructor(
    private readonly ctx: PluginContext,
    private readonly legacyKey: string,
    private readonly indexKey: string,
    private readonly prefix: string,
    private readonly limit: number,
  ) {}

  private itemKey(id: string) {
    return this.prefix + ":" + id;
  }

  private chunkKey(id: string, manifest: Manifest, index: number) {
    return this.itemKey(id) + ":" + manifest.generation + ":" + index;
  }

  private async removeChunks(id: string, manifest: Manifest) {
    for (let i = 0; i < manifest.chunks; i++) {
      // Cleanup is best-effort. A failure may leave an unreferenced chunk,
      // but must never roll back a successfully committed generation.
      await this.ctx.kv
        .delete(this.chunkKey(id, manifest, i))
        .catch(() => undefined);
    }
  }

  async load(): Promise<T[]> {
    const index = await this.ctx.kv.get(this.indexKey);
    if (index === null || index === undefined) {
      const legacy = await this.ctx.kv.get(this.legacyKey);
      if (legacy !== null && legacy !== undefined && !Array.isArray(legacy)) {
        throw new Error("Invalid legacy Agent record collection");
      }
      const records = ((legacy ?? []) as T[]).slice(-this.limit);
      await this.save(records);
      return records;
    }
    if (
      !Array.isArray(index) ||
      index.length > this.limit ||
      index.some((id) => typeof id !== "string" || id.length > 64) ||
      new Set(index).size !== index.length
    ) {
      throw new Error("Invalid Agent record index");
    }
    const records: T[] = [];
    for (const id of index as string[]) {
      const raw = await this.ctx.kv.get(this.itemKey(id));
      const manifest = raw as Manifest | null;
      if (
        !manifest ||
        manifest.version !== 1 ||
        typeof manifest.generation !== "string" ||
        !/^[0-9a-f-]{36}$/.test(manifest.generation) ||
        !Number.isInteger(manifest.chunks) ||
        manifest.chunks < 1 ||
        manifest.chunks > 256 ||
        typeof manifest.digest !== "string"
      ) {
        throw new Error("Agent record manifest missing or invalid");
      }
      const chunks: Buffer[] = [];
      for (let i = 0; i < manifest.chunks; i++) {
        const chunk = await this.ctx.kv.get(this.chunkKey(id, manifest, i));
        if (typeof chunk !== "string") {
          throw new Error("Agent record chunk missing");
        }
        chunks.push(Buffer.from(chunk, "base64"));
      }
      const compressed = Buffer.concat(chunks);
      if (
        compressed.length > MAX_COMPRESSED_BYTES ||
        hash(compressed) !== manifest.digest
      ) {
        throw new Error("Agent record integrity check failed");
      }
      const record = JSON.parse(
        inflateRawSync(compressed, {
          maxOutputLength: MAX_UNCOMPRESSED_BYTES,
        }).toString("utf8"),
      ) as T;
      if (record.id !== id) throw new Error("Agent record ID mismatch");
      records.push(record);
      this.manifests.set(id, manifest);
      this.lastSaved.set(id, JSON.stringify(record));
    }
    this.ids = [...index];
    return records;
  }

  async save(records: readonly T[]): Promise<void> {
    const recent = records.slice(-this.limit);
    const ids = recent.map((record) => record.id);
    if (
      ids.some((id) => typeof id !== "string" || id.length > 64) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error("Invalid Agent record ID");
    }
    for (const record of recent) {
      const serialized = JSON.stringify(record);
      if (this.lastSaved.get(record.id) === serialized) continue;
      const compressed = deflateRawSync(Buffer.from(serialized, "utf8"));
      if (
        compressed.length > MAX_COMPRESSED_BYTES ||
        Buffer.byteLength(serialized, "utf8") > MAX_UNCOMPRESSED_BYTES
      ) {
        throw new Error("Agent record exceeds maximum safe size");
      }
      const next: Manifest = {
        version: 1,
        generation: randomUUID(),
        chunks: Math.max(1, Math.ceil(compressed.length / CHUNK_BYTES)),
        digest: hash(compressed),
      };
      for (let i = 0; i < next.chunks; i++) {
        await this.ctx.kv.set(
          this.chunkKey(record.id, next, i),
          compressed
            .subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
            .toString("base64"),
        );
      }
      // Commit the record pointer last, never mutate the old chunks in place.
      await this.ctx.kv.set(this.itemKey(record.id), next);
      const old = this.manifests.get(record.id);
      this.manifests.set(record.id, next);
      this.lastSaved.set(record.id, serialized);
      if (old) await this.removeChunks(record.id, old);
    }

    if (ids.join("\0") !== this.ids.join("\0")) {
      await this.ctx.kv.set(this.indexKey, ids);
      const removed = this.ids.filter((id) => !ids.includes(id));
      this.ids = ids;
      for (const id of removed) {
        const old = this.manifests.get(id);
        // Index commit precedes deletion, so interrupted cleanup is safe.
        await this.ctx.kv.delete(this.itemKey(id)).catch(() => undefined);
        if (old) await this.removeChunks(id, old);
        this.manifests.delete(id);
        this.lastSaved.delete(id);
      }
    }
  }
}
