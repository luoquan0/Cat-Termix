/** Real Docker replacement + cold backup/rollback, confined to unique CI containers. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import * as tar from "tar";
import { execFileSync } from "node:child_process";
import {
  Docker,
  Registry,
  replaceContainer,
  IMAGE,
  SOURCE,
} from "./updater.mjs";
const id = randomUUID().slice(0, 8),
  name = `cat-updater-smoke-${id}`;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-updater-test-"));
const dataDir = path.join(temp, "data"),
  stateDir = path.join(temp, "state");
await fs.mkdir(dataDir);
await fs.mkdir(stateDir);
await fs.writeFile(path.join(dataDir, "sentinel"), "keep-me");
const docker = new Docker();
await docker.init();
const label = "io.cat-termix.updater-test=" + id;
let fixtureImage;
try {
  execFileSync("docker", ["pull", "node:26-slim"], { stdio: "inherit" });
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      name,
      "--label",
      label,
      "-e",
      "CUSTOM_SETTING=preserve",
      "-v",
      `${dataDir}:/app/data`,
      "--health-cmd",
      'node -e "process.exit(0)"',
      "--health-interval",
      "1s",
      "--health-start-period",
      "1s",
      "--health-retries",
      "2",
      "node:26-slim",
      "node",
      "-e",
      "setInterval(()=>{},1000)",
    ],
    { stdio: "inherit" },
  );
  const old = await docker.call("GET", `/containers/${name}/json`);
  const image = await docker.call("GET", `/images/${old.Image}/json`);
  const release = {
    imageRef: old.Image,
    revision: "a".repeat(40),
    config: {
      config: {
        ...image.Config,
        Labels: {
          "org.opencontainers.image.source": SOURCE,
          "org.opencontainers.image.revision": "a".repeat(40),
        },
      },
    },
  };
  await replaceContainer({ docker, old, release, stateDir, dataDir });
  const newer = await docker.call("GET", `/containers/${name}/json`);
  assert.notEqual(newer.Id, old.Id);
  assert.equal(newer.State.Health.Status, "healthy");
  assert.ok(newer.Config.Env.includes("CUSTOM_SETTING=preserve"));
  assert.equal(
    await fs.readFile(path.join(dataDir, "sentinel"), "utf8"),
    "keep-me",
  );
  await assert.rejects(
    replaceContainer({
      docker,
      old: newer,
      release,
      stateDir,
      dataDir,
      healthy: async () => {
        await fs.writeFile(
          path.join(dataDir, "sentinel"),
          "candidate-modified",
        );
        await fs.writeFile(
          path.join(dataDir, "new-file"),
          "remove-on-rollback",
        );
        throw new Error("simulated unhealthy image");
      },
    }),
    /previous container\/data were restored/,
  );
  const restored = await docker.call("GET", `/containers/${name}/json`);
  assert.equal(restored.Id, newer.Id);
  assert.equal(restored.State.Running, true);
  assert.equal(
    await fs.readFile(path.join(dataDir, "sentinel"), "utf8"),
    "keep-me",
  );
  await assert.rejects(fs.access(path.join(dataDir, "new-file")));

  // Exercise verified OCI download -> Docker load with a minimal, local fixture.
  // All registry requests use the same proxy dispatcher, including layer bytes.
  await fs.writeFile(path.join(temp, "proof"), "verified image layer");
  await tar.c(
    { cwd: temp, file: path.join(temp, "fixture-layer.tar"), portable: true },
    ["proof"],
  );
  const layerBytes = await fs.readFile(path.join(temp, "fixture-layer.tar"));
  const compressed = gzipSync(layerBytes);
  const digest = (bytes) =>
    "sha256:" + createHash("sha256").update(bytes).digest("hex");
  const revision = "f".repeat(32) + id;
  const configBytes = Buffer.from(
    JSON.stringify({
      architecture: image.Architecture,
      os: "linux",
      config: {
        Labels: {
          "org.opencontainers.image.source": SOURCE,
          "org.opencontainers.image.revision": revision,
        },
      },
      rootfs: { type: "layers", diff_ids: [digest(layerBytes)] },
      history: [{ created_by: "Cat-Termix CI fixture" }],
    }),
  );
  const manifest = {
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      mediaType: "application/vnd.oci.image.config.v1+json",
      digest: digest(configBytes),
      size: configBytes.length,
    },
    layers: [
      {
        mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
        digest: digest(compressed),
        size: compressed.length,
      },
    ],
  };
  const calls = [],
    dispatcher = { testProxy: true };
  const registry = new Registry(async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/token?")) return Response.json({ token: "fixture" });
    if (url.endsWith("/manifests/ai-dev")) return Response.json(manifest);
    if (url.endsWith("/blobs/" + digest(configBytes)))
      return new Response(configBytes);
    if (url.endsWith("/blobs/" + digest(compressed)))
      return new Response(compressed);
    throw new Error("Unexpected fixture registry request");
  }, dispatcher);
  const downloaded = await registry.release(image.Architecture);
  fixtureImage = digest(configBytes);
  await registry.load(downloaded, docker, stateDir);
  const imported = await docker.call(
    "GET",
    `/images/${encodeURIComponent(downloaded.imageRef)}/json`,
  );
  assert.equal(imported.Id, fixtureImage);
  assert.deepEqual(imported.RootFS.Layers, [digest(layerBytes)]);
  assert.ok(
    calls.length >= 4 &&
      calls.every((c) => c.options.dispatcher === dispatcher),
  );
  console.log(
    "Verified OCI layer download and real Docker import through proxy-aware transport: passed",
  );

  console.log(
    "Docker replacement, volume/environment preservation, cold backup and failed-start rollback: passed",
  );
} finally {
  if (fixtureImage)
    await docker
      .call("DELETE", `/images/${fixtureImage}?force=1`)
      .catch(() => {});
  const filters = encodeURIComponent(JSON.stringify({ label: [label] }));
  const containers = await docker.call(
    "GET",
    `/containers/json?all=1&filters=${filters}`,
  );
  for (const c of containers)
    await docker
      .call("DELETE", `/containers/${c.Id}?force=1&v=0`)
      .catch(() => {});
  await fs.rm(temp, { recursive: true, force: true });
}
