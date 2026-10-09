/**
 * Opt-in Docker updater. No HTTP listener, shell commands, or user-supplied image.
 * Only this helper (not Termix or its AI tools) receives the Docker socket.
 * Registry metadata AND layer downloads use the configured HTTP(S) proxy.
 */
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

export const IMAGE = "ghcr.io/luoquan0/cat-termix";
export const SOURCE = "https://github.com/luoquan0/Cat-Termix";
export const VERSION = "1";
const ACCEPT =
  "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const defaults = { enabled: false, intervalHours: 6, proxyUrl: "" };
export function validatePolicy(value) {
  const p = value;
  if (
    !p ||
    typeof p.enabled !== "boolean" ||
    !Number.isInteger(p.intervalHours) ||
    p.intervalHours < 1 ||
    p.intervalHours > 168 ||
    typeof p.proxyUrl !== "string" ||
    p.proxyUrl.length > 2048
  )
    throw new Error("Invalid update configuration");
  if (p.proxyUrl) {
    const u = new URL(p.proxyUrl);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      !u.hostname ||
      u.hash ||
      u.search ||
      (u.pathname && u.pathname !== "/")
    )
      throw new Error("Invalid proxy origin");
  }
  return {
    enabled: p.enabled,
    intervalHours: p.intervalHours,
    proxyUrl: p.proxyUrl,
  };
}
export function verifyDigest(bytes, digest) {
  if (
    !/^sha256:[a-f0-9]{64}$/.test(digest) ||
    "sha256:" + createHash("sha256").update(bytes).digest("hex") !== digest
  )
    throw new Error("Image digest verification failed");
}
export async function atomicJson(file, data, mode = 0o644) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data), { mode });
  await fs.rename(temp, file);
}
async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}
export class Docker {
  constructor(socketPath = "/var/run/docker.sock") {
    this.socketPath = socketPath;
    this.version = "";
  }
  async init() {
    const version = await this.call("GET", "/version");
    const selected = Math.min(Number(version.ApiVersion), 1.51).toFixed(2);
    if (
      !Number.isFinite(Number(selected)) ||
      Number(selected) < Math.max(1.4, Number(version.MinAPIVersion ?? 0))
    )
      throw new Error(
        "Unsupported Docker API version (requires compatible API >= 1.40)",
      );
    this.version = `/v${selected}`;
  }
  async call(method, url, body, stream = false) {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path: this.version + url,
          method,
          headers: {
            "Content-Type": stream ? "application/x-tar" : "application/json",
          },
        },
        (response) => {
          let text = "",
            size = 0;
          response.on("data", (part) => {
            size += part.length;
            if (size > 16 * 1024 * 1024) {
              response.destroy(new Error("Docker response too large"));
              return;
            }
            text += part;
          });
          response.on("error", reject);
          response.on("end", () => {
            if ((response.statusCode ?? 500) >= 400)
              return reject(
                new Error(
                  `Docker ${method} ${url.split("?")[0]} failed (${response.statusCode})`,
                ),
              );
            if (stream) {
              try {
                for (const line of text.split("\n").filter(Boolean)) {
                  if (JSON.parse(line).error)
                    throw new Error(
                      "Docker could not import the verified image",
                    );
                }
              } catch (error) {
                return reject(error);
              }
              return resolve(text);
            }
            try {
              resolve(text ? JSON.parse(text) : null);
            } catch {
              resolve(text);
            }
          });
        },
      );
      request.setTimeout(15 * 60 * 1000, () =>
        request.destroy(new Error("Docker operation timed out")),
      );
      request.on("error", reject);
      if (stream) {
        body.on("error", (error) => request.destroy(error));
        body.pipe(request);
      } else request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async target(project) {
    const filters = JSON.stringify({
      label: [
        `io.cat-termix.autoupdate=true`,
        `com.docker.compose.project=${project}`,
        "com.docker.compose.service=cat-termix",
      ],
    });
    const matches = await this.call(
      "GET",
      "/containers/json?all=1&filters=" + encodeURIComponent(filters),
    );
    const current = matches.filter(
      (item) => !item.Names.some((name) => name.includes(".rollback-")),
    );
    if (current.length !== 1)
      throw new Error(
        "Expected exactly one explicitly opted-in Cat-Termix container in this Compose project",
      );
    return this.call("GET", `/containers/${current[0].Id}/json`);
  }
}
export class Registry {
  constructor(fetcher, dispatcher) {
    this.fetcher = fetcher;
    this.dispatcher = dispatcher;
    this.token = "";
  }
  static async open(proxyUrl) {
    const { fetch, ProxyAgent } = await import("undici");
    return new Registry(fetch, proxyUrl ? new ProxyAgent(proxyUrl) : undefined);
  }
  async close() {
    await this.dispatcher?.close();
  }
  async get(url, authorization = true) {
    let current = new URL(url);
    for (let i = 0; i < 6; i++) {
      if (current.protocol !== "https:")
        throw new Error("Refusing a non-HTTPS registry redirect");
      const response = await this.fetcher(current.href, {
        headers: {
          Accept: ACCEPT,
          ...(authorization &&
          current.origin === "https://ghcr.io" &&
          this.token
            ? { Authorization: `Bearer ${this.token}` }
            : {}),
        },
        dispatcher: this.dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("Invalid registry redirect");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(
          `Registry request failed (${response.status}); check proxy or public package access`,
        );
      }
      return response;
    }
    throw new Error("Too many registry redirects");
  }
  async bytes(url, digest) {
    const response = await this.get(url);
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 8 * 1024 * 1024)
          throw new Error("Registry metadata too large");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = Buffer.concat(chunks);
    if (digest) verifyDigest(bytes, digest);
    return bytes;
  }
  async release(architecture) {
    if (!["amd64", "arm64"].includes(architecture))
      throw new Error("Only amd64 and arm64 updates are supported");
    const auth = JSON.parse(
      await this.bytes(
        "https://ghcr.io/token?service=ghcr.io&scope=repository:luoquan0/cat-termix:pull",
      ),
    );
    this.token = auth.token ?? auth.access_token;
    if (typeof this.token !== "string")
      throw new Error("No registry read token");
    const root = "https://ghcr.io/v2/luoquan0/cat-termix";
    const indexBytes = await this.bytes(`${root}/manifests/ai-dev`);
    let manifest = JSON.parse(indexBytes);
    let manifestDigest =
      "sha256:" + createHash("sha256").update(indexBytes).digest("hex");
    if (manifest.manifests) {
      const entry = manifest.manifests.find(
        (m) =>
          m.platform?.os === "linux" &&
          m.platform?.architecture === architecture,
      );
      if (!entry)
        throw new Error("No compatible platform in the published image");
      manifestDigest = entry.digest;
      manifest = JSON.parse(
        await this.bytes(`${root}/manifests/${manifestDigest}`, manifestDigest),
      );
    }
    const configBytes = await this.bytes(
      `${root}/blobs/${manifest.config?.digest}`,
      manifest.config?.digest,
    );
    const config = JSON.parse(configBytes);
    const revision =
      config.config?.Labels?.["org.opencontainers.image.revision"];
    if (
      config.os !== "linux" ||
      config.architecture !== architecture ||
      config.config?.Labels?.["org.opencontainers.image.source"] !== SOURCE ||
      !/^[a-f0-9]{40}$/.test(revision ?? "")
    )
      throw new Error("Image source, revision or platform verification failed");
    if (
      !Array.isArray(manifest.layers) ||
      manifest.layers.length > 200 ||
      config.rootfs?.diff_ids?.length !== manifest.layers.length
    )
      throw new Error("Unsupported image layer metadata");
    return {
      manifest,
      config,
      configBytes,
      revision,
      digest: manifestDigest,
      imageRef: `${IMAGE}:sha-${revision}`,
    };
  }
  async load(release, docker, workDir) {
    const temp = await fs.mkdtemp(path.join(workDir, "image-"));
    try {
      await fs.writeFile(path.join(temp, "config.json"), release.configBytes);
      const files = [];
      let totalExpanded = 0;
      for (const [index, layer] of release.manifest.layers.entries()) {
        if (
          !/^sha256:[a-f0-9]{64}$/.test(layer.digest) ||
          !Number.isSafeInteger(layer.size) ||
          layer.size < 0 ||
          layer.size > 4 * 1024 ** 3
        )
          throw new Error("Invalid layer descriptor");
        if (
          ![
            "application/vnd.oci.image.layer.v1.tar+gzip",
            "application/vnd.docker.image.rootfs.diff.tar.gzip",
            "application/vnd.oci.image.layer.v1.tar",
          ].includes(layer.mediaType)
        )
          throw new Error("Unsupported layer encoding");
        const response = await this.get(
          `https://ghcr.io/v2/luoquan0/cat-termix/blobs/${layer.digest}`,
        );
        const hash = createHash("sha256");
        let received = 0;
        const wireCheck = new Transform({
          transform(part, _encoding, callback) {
            received += part.length;
            hash.update(part);
            callback(
              received > layer.size
                ? new Error("Layer exceeds declared size")
                : null,
              part,
            );
          },
        });
        const expandedHash = createHash("sha256");
        const expandedCheck = new Transform({
          transform(part, _encoding, callback) {
            totalExpanded += part.length;
            expandedHash.update(part);
            callback(
              totalExpanded > 12 * 1024 ** 3
                ? new Error("Expanded image exceeds 12 GiB safety limit")
                : null,
              part,
            );
          },
        });
        const name = `${index}.tar`;
        const streams = [Readable.fromWeb(response.body), wireCheck];
        if (layer.mediaType.endsWith("gzip")) streams.push(createGunzip());
        streams.push(expandedCheck, createWriteStream(path.join(temp, name)));
        await pipeline(streams);
        if (
          received !== layer.size ||
          "sha256:" + hash.digest("hex") !== layer.digest ||
          "sha256:" + expandedHash.digest("hex") !==
            release.config.rootfs.diff_ids[index]
        )
          throw new Error("Layer digest verification failed");
        files.push(name);
      }
      await fs.writeFile(
        path.join(temp, "manifest.json"),
        JSON.stringify([
          {
            Config: "config.json",
            RepoTags: [release.imageRef],
            Layers: files,
          },
        ]),
      );
      const tar = await import("tar");
      const archive = tar.c({ cwd: temp, portable: true }, [
        "config.json",
        "manifest.json",
        ...files,
      ]);
      await docker.call("POST", "/images/load?quiet=1", archive, true);
      const image = await docker.call(
        "GET",
        `/images/${encodeURIComponent(release.imageRef)}/json`,
      );
      if (image.Id !== release.manifest.config.digest)
        throw new Error("Imported image ID mismatch");
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  }
}

export function replacementConfig(old, release) {
  const config = structuredClone(old.Config);
  config.Image = release.imageRef;
  if (config.Hostname === old.Id.slice(0, 12)) config.Hostname = "";
  const labels = { ...config.Labels };
  for (const key of Object.keys(labels))
    if (key.startsWith("org.opencontainers.image.")) delete labels[key];
  config.Labels = { ...labels, ...release.config.config.Labels };
  const host = structuredClone(old.HostConfig);
  if (
    host.AutoRemove ||
    host.Privileged ||
    ["host", "none"].includes(host.NetworkMode)
  )
    throw new Error(
      "Automatic update requires a non-privileged persistent container on a bridge network",
    );
  const endpoints = {};
  for (const [network, settings] of Object.entries(
    old.NetworkSettings.Networks,
  )) {
    if (settings.IPAMConfig && Object.values(settings.IPAMConfig).some(Boolean))
      throw new Error(
        "Static container IP updates require a manual maintenance procedure",
      );
    const aliases = (settings.Aliases ?? []).filter(
      (alias) => alias !== old.Id && alias !== old.Id.slice(0, 12),
    );
    endpoints[network] =
      network !== "bridge" && aliases.length ? { Aliases: aliases } : {};
  }
  return {
    ...config,
    HostConfig: host,
    NetworkingConfig: { EndpointsConfig: endpoints },
  };
}
async function waitHealthy(docker, id, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    const current = await docker.call("GET", `/containers/${id}/json`);
    if (current.State?.Running && current.State?.Health?.Status === "healthy")
      return;
    if (
      !current.State?.Running ||
      current.State?.Health?.Status === "unhealthy"
    )
      throw new Error("Updated container failed its startup health check");
    await sleep(2000);
  }
  throw new Error(
    "Updated container did not become healthy within 180 seconds",
  );
}
export async function replaceContainer({
  docker,
  old,
  release,
  stateDir,
  dataDir,
  status = async () => {},
  healthy = waitHealthy,
}) {
  const createConfig = replacementConfig(old, release);
  const originalName = old.Name.replace(/^\//, "");
  const backupName = `${originalName}.rollback-${Date.now()}`;
  await fs.mkdir(path.join(stateDir, "backups"), { recursive: true });
  const backupFile = path.join(stateDir, "backups", `${Date.now()}.tar.gz`);
  const journalPath = path.join(stateDir, "journal.json");
  const journal = {
    oldId: old.Id,
    originalName,
    backupName,
    backupFile: null,
    newId: null,
    phase: "stopping",
  };
  await atomicJson(journalPath, journal, 0o600);
  let renamed = false;
  const tar = await import("tar");
  try {
    await status({
      phase: "backing_up",
      message: "Stopping application and taking a cold local-data backup",
    });
    await docker.call("POST", `/containers/${old.Id}/stop?t=30`);
    await tar.c({ cwd: dataDir, file: backupFile, gzip: true }, ["."]);
    await fs.chmod(backupFile, 0o600);
    journal.backupFile = backupFile;
    journal.phase = "backed_up";
    await atomicJson(journalPath, journal, 0o600);
    await docker.call(
      "POST",
      `/containers/${old.Id}/rename?name=${encodeURIComponent(backupName)}`,
    );
    renamed = true;
    const created = await docker.call(
      "POST",
      `/containers/create?name=${encodeURIComponent(originalName)}`,
      createConfig,
    );
    journal.newId = created.Id;
    journal.phase = "starting";
    await atomicJson(journalPath, journal, 0o600);
    await docker.call("POST", `/containers/${created.Id}/start`);
    await status({
      phase: "verifying",
      message: "Waiting for the replacement container to become healthy",
    });
    await healthy(docker, created.Id);
    journal.phase = "committed";
    await atomicJson(journalPath, journal, 0o600);
    await docker.call("DELETE", `/containers/${old.Id}?v=0`);
    await fs.rm(journalPath, { force: true });
    // Keep the last three cold snapshots; never prune application volumes or images.
    const backups = (await fs.readdir(path.join(stateDir, "backups")))
      .filter((name) => /^\d+\.tar\.gz$/.test(name))
      .sort();
    for (const name of backups.slice(0, -3))
      await fs.rm(path.join(stateDir, "backups", name));
    await status({
      phase: "updated",
      currentRevision: release.revision,
      lastSuccessAt: new Date().toISOString(),
      message: "Update completed; previous data snapshot retained",
    });
  } catch (error) {
    if (journal.phase === "committed") throw error;
    await status({
      phase: "rolling_back",
      message:
        "Startup failed; restoring previous container and cold data snapshot",
    });
    if (journal.newId) {
      await docker
        .call("POST", `/containers/${journal.newId}/stop?t=10`)
        .catch(() => {});
      await docker.call("DELETE", `/containers/${journal.newId}?force=1&v=0`);
    }
    if (journal.backupFile) {
      // dataDir is validated against BOTH the target and this helper's data mount.
      for (const name of await fs.readdir(dataDir))
        await fs.rm(path.join(dataDir, name), { recursive: true, force: true });
      await tar.x({
        cwd: dataDir,
        file: journal.backupFile,
        preserveOwner: true,
      });
    }
    if (renamed)
      await docker.call(
        "POST",
        `/containers/${old.Id}/rename?name=${encodeURIComponent(originalName)}`,
      );
    await docker.call("POST", `/containers/${old.Id}/start`);
    await fs.rm(journalPath, { force: true });
    throw new Error(
      "Update failed and the previous container/data were restored. " +
        error.message,
    );
  }
}

async function validateDataMount(docker, old, project, dataDir) {
  const main = old.Mounts.find((m) => m.Destination === "/app/data");
  if (!main || !["bind", "volume"].includes(main.Type) || !main.RW)
    throw new Error("Persistent /app/data mount required");
  const helpers = await docker.call(
    "GET",
    "/containers/json?filters=" +
      encodeURIComponent(
        JSON.stringify({
          label: [
            `com.docker.compose.project=${project}`,
            "com.docker.compose.service=cat-termix-updater",
          ],
        }),
      ),
  );
  if (helpers.length !== 1)
    throw new Error("Cannot identify this project updater");
  const helper = await docker.call("GET", `/containers/${helpers[0].Id}/json`);
  const mirror = helper.Mounts.find((m) => m.Destination === dataDir);
  if (
    !mirror ||
    !mirror.RW ||
    mirror.Source !== main.Source ||
    mirror.Type !== main.Type
  )
    throw new Error(
      "Updater backup volume does not match application data; refusing update",
    );
  const env = Object.fromEntries(
    (old.Config.Env ?? []).map((v) => {
      const i = v.indexOf("=");
      return [v.slice(0, i), v.slice(i + 1)];
    }),
  );
  const envFile = await fs
    .readFile(path.join(dataDir, ".env"), "utf8")
    .catch((e) => {
      if (e.code === "ENOENT") return "";
      throw e;
    });
  const dialects = [
    env.DATABASE_DIALECT,
    ...Array.from(
      envFile.matchAll(/^\s*DATABASE_DIALECT\s*=\s*["']?([^\s"']+)/gm),
      (m) => m[1],
    ),
  ].filter(Boolean);
  if (
    dialects.some((d) => d !== "sqlite") ||
    env.DATABASE_URL ||
    /^\s*DATABASE_URL\s*=\s*\S+/m.test(envFile)
  )
    throw new Error(
      "External databases require an external backup/rollback procedure; automatic replacement is disabled",
    );
  if (env.DATA_DIR && env.DATA_DIR !== "/app/data")
    throw new Error("Custom DATA_DIR requires manual updater setup");
}

export async function main() {
  const control = process.env.CAT_TERMIX_CONTROL_DIR || "/control";
  const stateDir = process.env.CAT_TERMIX_UPDATE_STATE || "/state";
  const dataDir = process.env.CAT_TERMIX_BACKUP_SOURCE || "/backup-source";
  const project = process.env.CAT_TERMIX_PROJECT || "cat-termix-ai-test";
  if (!/^[a-zA-Z0-9_-]+$/.test(project))
    throw new Error("Invalid Compose project");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(control, { recursive: true });
  const docker = new Docker();
  await docker.init();
  let currentStatus = await readJson(path.join(control, "status.json"), {});
  const status = async (patch) => {
    currentStatus = {
      ...currentStatus,
      ...patch,
      heartbeat: new Date().toISOString(),
      updaterVersion: VERSION,
    };
    await atomicJson(path.join(control, "status.json"), currentStatus);
  };
  const heartbeat = setInterval(() => void status({}).catch(() => {}), 30000);
  heartbeat.unref();
  // Interrupted maintenance is not silently retried. Require operator inspection
  // of the journal/backup rather than guessing what wrote to application data.
  if (await readJson(path.join(stateDir, "journal.json"))) {
    await status({
      phase: "recovery_required",
      message:
        "Interrupted maintenance detected. Use the saved journal and cold backup to recover; automatic updates are paused.",
    });
    while (true) await sleep(60000);
  }
  let lastRequest = currentStatus.lastRequest ?? "";
  let lastCheck = Date.parse(currentStatus.lastCheckAt ?? "") || 0;
  while (true) {
    let registry;
    try {
      if (await readJson(path.join(stateDir, "journal.json"))) {
        await status({
          phase: "recovery_required",
          message:
            "Unfinished maintenance journal: automatic updates paused. Inspect the retained cold backup and containers.",
        });
        await sleep(60000);
        continue;
      }
      const policy = validatePolicy(
        await readJson(path.join(control, "config.json"), defaults),
      );
      const request = await readJson(path.join(control, "request.json"));
      const manual =
        request?.id &&
        request.id !== lastRequest &&
        ["check", "apply"].includes(request.action) &&
        Date.now() - Date.parse(request.at) < 10 * 60 * 1000;
      if (
        !manual &&
        (!policy.enabled ||
          Date.now() - lastCheck < policy.intervalHours * 3600000)
      ) {
        await status({});
        await sleep(15000);
        continue;
      }
      if (manual) {
        lastRequest = request.id;
        await status({ lastRequest });
      }
      const old = await docker.target(project);
      const oldImage = await docker.call("GET", `/images/${old.Image}/json`);
      registry = await Registry.open(policy.proxyUrl);
      await status({
        phase: "checking",
        message: "Checking the published Cat-Termix ai-dev image",
        currentRevision:
          old.Config.Labels?.["org.opencontainers.image.revision"],
      });
      const release = await registry.release(oldImage.Architecture);
      lastCheck = Date.now();
      await status({
        phase:
          old.Image === release.manifest.config.digest
            ? "current"
            : "available",
        availableRevision: release.revision,
        lastCheckAt: new Date(lastCheck).toISOString(),
        message: "",
      });
      if (
        old.Image === release.manifest.config.digest ||
        (manual && request.action === "check") ||
        (!manual && !policy.enabled)
      )
        continue;
      const activity = await readJson(path.join(control, "activity.json"));
      if (
        activity?.activeRequests > 0 &&
        Date.now() - Date.parse(activity.heartbeat) < 90000
      ) {
        await status({
          phase: "deferred",
          message:
            "AI request is active. Update deferred; retry after it completes.",
        });
        lastCheck = Date.now() - policy.intervalHours * 3600000 + 60000;
        continue;
      }
      await validateDataMount(docker, old, project, dataDir);
      replacementConfig(old, release); // Fail before download or downtime for unsupported deployments.
      await status({
        phase: "downloading",
        message:
          "Downloading and verifying image layers using the configured update proxy",
      });
      await registry.load(release, docker, stateDir);
      // Re-read consent and live identity immediately before the destructive boundary.
      const latestPolicy = validatePolicy(
        await readJson(path.join(control, "config.json"), defaults),
      );
      if (!manual && !latestPolicy.enabled) {
        await status({
          phase: "downloaded",
          message: "Automatic updates disabled; installation cancelled",
        });
        continue;
      }
      const stillCurrent = await docker.target(project);
      if (stillCurrent.Id !== old.Id || stillCurrent.Image !== old.Image)
        throw new Error(
          "Container changed during download; no replacement performed",
        );
      const maintenanceFile = path.join(control, "maintenance.json");
      const maintenanceId = randomUUID();
      await atomicJson(maintenanceFile, {
        id: maintenanceId,
        at: new Date().toISOString(),
      });
      try {
        let ready = false;
        for (let attempt = 0; attempt < 15; attempt++) {
          const ack = await readJson(path.join(control, "activity.json"));
          if (
            ack?.maintenanceId === maintenanceId &&
            ack.activeRequests === 0
          ) {
            ready = true;
            break;
          }
          await sleep(2000);
        }
        if (!ready)
          throw new Error(
            "Application did not acknowledge idle maintenance; update deferred without stopping it",
          );
        const finalPolicy = validatePolicy(
          await readJson(path.join(control, "config.json"), defaults),
        );
        if (!manual && !finalPolicy.enabled)
          throw new Error("Automatic updates disabled before installation");
        await replaceContainer({
          docker,
          old,
          release,
          stateDir,
          dataDir,
          status,
        });
      } finally {
        await fs.rm(maintenanceFile, { force: true });
      }
    } catch (error) {
      // Never expose proxy credentials or token-bearing registry URLs in the UI.
      const safe = String(error.message)
        .replace(/https?:\/\/[^\s]+/g, "[network endpoint]")
        .slice(0, 500);
      await status({ phase: "error", message: safe });
      lastCheck = Date.now();
    } finally {
      await registry?.close().catch(() => {});
    }
    await sleep(15000);
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(
      "Updater stopped:",
      String(error.message).replace(/https?:\/\/[^\s]+/g, "[endpoint]"),
    );
    process.exitCode = 1;
  });
}
