// Tests the immutable, upstream-only base before Cat extensions are ported.
// Node built-ins only: keep this check usable before npm ci.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const sdkPackage = JSON.parse(
  readFileSync("packages/plugin-sdk/package.json", "utf8"),
);
const catalog = JSON.parse(
  readFileSync("docker/bundled-plugins.json", "utf8"),
);

assert.equal(packageJson.name, "termix");
assert.equal(packageJson.version, "26.11.0");
assert.equal(sdkPackage.name, "@termix-ssh/plugin-sdk");
assert.equal(sdkPackage.version, "1.0.22");
assert.ok(packageJson.workspaces.includes("packages/*"));
assert.ok(Array.isArray(catalog.plugins));
assert.ok(catalog.plugins.length > 20);

const ids = new Set();
for (const plugin of catalog.plugins) {
  assert.equal(typeof plugin.id, "string");
  assert.ok(!ids.has(plugin.id), "Duplicate plugin ID: " + plugin.id);
  ids.add(plugin.id);
  assert.equal(plugin.source, "tmxplug", plugin.id);
  assert.match(plugin.sha256, /^[a-f0-9]{64}$/, plugin.id);
  assert.match(
    plugin.url,
    /^https:\/\/github\.com\/Termix-SSH\/Plugin-[A-Za-z0-9-]+\/releases\/download\//,
    plugin.id,
  );
}
assert.ok(ids.has("ai"), "Upstream AI plugin must be pinned");
assert.ok(ids.has("ssh-terminal"), "Upstream terminal plugin must be pinned");
assert.ok(ids.has("file-manager"), "Upstream file manager must be pinned");
console.log("26.11.0 immutable upstream/plugin-catalog baseline verified.");
console.log("Cat Agent, custom AI and updater are NOT yet ported or enabled.");
