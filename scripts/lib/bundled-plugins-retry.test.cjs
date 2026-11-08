const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fetchArtifact } = require("./bundled-plugins.cjs");

const payload = Buffer.from("verified plugin package bytes");
const entry = {
  id: "alerts",
  url: "https://github.com/Termix-SSH/Plugin-Alerts/releases/download/v1.2.0/alerts-1.2.0.tmxplug",
  sha256: crypto.createHash("sha256").update(payload).digest("hex"),
};

async function withTempRoot(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cat-plugin-retry-"));
  try {
    return await callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("transient HTTP 504 retries and preserves the pinned digest", async () => {
  await withTempRoot(async (root) => {
    let attempts = 0;
    const buffer = await fetchArtifact(entry, root, async () => {
      attempts++;
      if (attempts === 1) return { ok: false, status: 504 };
      return {
        ok: true,
        arrayBuffer: async () => Uint8Array.from(payload).buffer,
      };
    });
    assert.equal(attempts, 2);
    assert.deepEqual(buffer, payload);
    const cached = path.join(root, "node_modules/.cache/termix-bundled-plugins", entry.sha256 + ".tmxplug");
    assert.deepEqual(fs.readFileSync(cached), payload);
  });
});

test("permanent HTTP 404 is not retried", async () => {
  await withTempRoot(async (root) => {
    let attempts = 0;
    await assert.rejects(
      fetchArtifact(entry, root, async () => {
        attempts++;
        return { ok: false, status: 404 };
      }),
      /alerts: download failed with 404/,
    );
    assert.equal(attempts, 1);
  });
});

test("success with the wrong digest is rejected and never cached", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      fetchArtifact(entry, root, async () => ({
        ok: true,
        arrayBuffer: async () => Uint8Array.from(Buffer.from("tampered")).buffer,
      })),
      /alerts: sha256 is .* pins /,
    );
    const cached = path.join(root, "node_modules/.cache/termix-bundled-plugins", entry.sha256 + ".tmxplug");
    assert.equal(fs.existsSync(cached), false);
  });
});
