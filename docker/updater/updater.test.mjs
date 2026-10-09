import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  IMAGE,
  SOURCE,
  validatePolicy,
  verifyDigest,
  Registry,
  replacementConfig,
  defaults,
} from "./updater.mjs";

test("update configuration accepts HTTP proxies but no arbitrary image/command source", () => {
  assert.equal(
    validatePolicy({ ...defaults, proxyUrl: "http://user:pass@127.0.0.1:7890" })
      .proxyUrl,
    "http://user:pass@127.0.0.1:7890",
  );
  for (const proxyUrl of [
    "file:///tmp/x",
    "http://localhost/evil",
    "https://localhost/?token=x",
  ])
    assert.throws(() => validatePolicy({ ...defaults, proxyUrl }));
  assert.throws(() => validatePolicy({ ...defaults, intervalHours: 0 }));
  assert.equal(validatePolicy({ ...defaults, image: "evil" }).image, undefined);
});
test("digest verification detects corrupted downloads", () => {
  const b = Buffer.from("test");
  const d = "sha256:" + createHash("sha256").update(b).digest("hex");
  verifyDigest(b, d);
  assert.throws(() => verifyDigest(Buffer.from("other"), d));
  assert.throws(() => verifyDigest(b, "md5:x"));
});
test("proxy dispatcher is used for redirects but GHCR bearer tokens never leak across hosts", async () => {
  const calls = [],
    dispatcher = {};
  const r = new Registry(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(null, {
          status: 307,
          headers: { location: "https://download.example/layer" },
        })
      : new Response("bytes");
  }, dispatcher);
  r.token = "private-token";
  await r.get("https://ghcr.io/v2/luoquan0/cat-termix/blobs/sha256:x");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.dispatcher, dispatcher);
  assert.equal(calls[1].options.dispatcher, dispatcher);
  assert.equal(calls[0].options.headers.Authorization, "Bearer private-token");
  assert.equal(calls[1].options.headers.Authorization, undefined);
});
test("registry redirects cannot downgrade TLS", async () => {
  const r = new Registry(
    async () =>
      new Response(null, {
        status: 307,
        headers: { location: "http://insecure/layer" },
      }),
  );
  await assert.rejects(r.get("https://ghcr.io/test"), /non-HTTPS/);
});
const old = () => ({
  Id: "123456789012".repeat(5),
  Config: {
    Image: IMAGE + ":ai-dev",
    Hostname: "123456789012",
    Env: ["PORT=8080"],
    Labels: {
      "com.docker.compose.project": "demo",
      "org.opencontainers.image.revision": "old",
    },
  },
  HostConfig: {
    Binds: ["data:/app/data:rw"],
    PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "9080" }] },
    NetworkMode: "demo_default",
    RestartPolicy: { Name: "unless-stopped" },
  },
  NetworkSettings: {
    Networks: { demo_default: { Aliases: ["cat-termix", "123456789012"] } },
  },
});
const release = {
  imageRef: IMAGE + ":sha-" + "a".repeat(40),
  config: {
    config: {
      Labels: {
        "org.opencontainers.image.source": SOURCE,
        "org.opencontainers.image.revision": "a".repeat(40),
      },
    },
  },
};
test("replacement preserves ports, volumes, environment, restart policy and network aliases", () => {
  const before = old(),
    c = replacementConfig(before, release);
  assert.equal(c.Image, release.imageRef);
  assert.deepEqual(c.Env, before.Config.Env);
  assert.deepEqual(c.HostConfig, before.HostConfig);
  assert.equal(c.Hostname, "");
  assert.equal(c.Labels["com.docker.compose.project"], "demo");
  assert.equal(c.Labels["org.opencontainers.image.revision"], "a".repeat(40));
  assert.deepEqual(c.NetworkingConfig.EndpointsConfig.demo_default.Aliases, [
    "cat-termix",
  ]);
});
test("unsupported auto-remove/privileged/network modes are refused before stopping anything", () => {
  for (const flag of ["Privileged", "AutoRemove"]) {
    const c = old();
    c.HostConfig[flag] = true;
    assert.throws(() => replacementConfig(c, release));
  }
  const c = old();
  c.HostConfig.NetworkMode = "host";
  assert.throws(() => replacementConfig(c, release));
});
