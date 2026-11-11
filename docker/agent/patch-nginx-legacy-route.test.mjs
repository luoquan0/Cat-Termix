import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AGENT_LEGACY_LOCATION,
  AGENT_PLUGIN_API_LOCATION,
  AGENT_TRUST_PROXY_MAP,
  patchNginxTemplates,
} from "./patch-nginx-legacy-route.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-agent-nginx-"));
  for (const sourceName of ["nginx.conf", "nginx-https.conf"]) {
    const source = fs.readFileSync(path.join(here, "..", sourceName), "utf8");
    fs.writeFileSync(path.join(root, sourceName + ".template"), source);
  }
  return root;
}

test("adds hardened legacy and SDK Agent routes to both HTTP and HTTPS templates", () => {
  const root = fixture();
  try {
    patchNginxTemplates(root);
    for (const name of ["nginx.conf.template", "nginx-https.conf.template"]) {
      const content = fs.readFileSync(path.join(root, name), "utf8");
      assert.ok(content.includes(AGENT_TRUST_PROXY_MAP.trim().split("\n")[0]));
      assert.ok(content.includes(AGENT_LEGACY_LOCATION));
      assert.ok(content.includes(AGENT_PLUGIN_API_LOCATION));
      assert.ok(content.indexOf("location ^~ /agent/ {") < content.indexOf("location ^~ /plugin-api/ {"));
      assert.ok(content.indexOf("location ^~ /plugin-api/agent/v1 {") < content.indexOf("location ^~ /plugin-api/ {"));
      for (const prefix of ["/agent/", "/plugin-api/agent/v1"]) {
        const start = content.indexOf("location ^~ " + prefix + " {");
        const end = content.indexOf("}", start);
        const route = content.slice(start, end);
        assert.ok(route.includes("proxy_set_header X-Real-IP $agent_client_ip;"));
        assert.ok(route.includes("proxy_set_header X-Forwarded-For $agent_client_ip;"));
        assert.ok(route.includes("proxy_set_header X-Forwarded-Proto $agent_forwarded_proto;"));
        assert.ok(!route.includes("$proxy_add_x_forwarded_for"));
        assert.ok(!route.includes("$http_x_forwarded"));
      }
      assert.ok(content.includes("default $realip_remote_addr;"));
      assert.ok(content.includes("1 $remote_addr;"));
      assert.ok(content.includes('"1:https" https;'));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("core JSON parsers preserve signed raw bodies on both Agent API mounts", () => {
  const source = fs.readFileSync(
    path.join(here, "../../src/backend/database/database.ts"),
    "utf8",
  );
  const bypass = 'if (req.path.startsWith("/plugin-api/") || req.path.startsWith("/agent/")) return next();';
  assert.equal(source.split(bypass).length - 1, 2);
});

test("patch is idempotent", () => {
  const root = fixture();
  try {
    patchNginxTemplates(root);
    const before = fs.readFileSync(path.join(root, "nginx.conf.template"), "utf8");
    patchNginxTemplates(root);
    assert.equal(fs.readFileSync(path.join(root, "nginx.conf.template"), "utf8"), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when an upstream Nginx template changes unexpectedly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-agent-nginx-bad-"));
  try {
    fs.writeFileSync(path.join(root, "nginx.conf.template"), "server { location / { } }");
    fs.writeFileSync(path.join(root, "nginx-https.conf.template"), "server { location / { } }");
    assert.throws(() => patchNginxTemplates(root), /expected one HTTP-context map insertion point/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only explicitly configured reverse-proxy peers receive trusted geo entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-agent-proxy-"));
  try {
    const config = path.join(root, "nginx.conf");
    fs.writeFileSync(config, [
      "geo $realip_remote_addr $agent_trusted_proxy {",
      "    default 0;",
      "    127.0.0.1 1;",
      "    # BEGIN AGENT_TRUSTED_PROXIES",
      "    # END AGENT_TRUSTED_PROXIES",
      "}",
      "",
    ].join("\n"));
    const helper = path.join(here, "configure-agent-trusted-proxies.sh");
    const result = spawnSync("/bin/sh", [helper, config], {
      encoding: "utf8",
      env: {
        ...process.env,
        TRUSTED_PROXIES: "10.20.0.5,2001:db8::/32,evil;touch /tmp/pwned",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = fs.readFileSync(config, "utf8");
    assert.ok(output.includes("10.20.0.5 1;"));
    assert.ok(output.includes("2001:db8::/32 1;"));
    assert.ok(!output.includes("evil"));
    assert.ok(!fs.existsSync("/tmp/pwned"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("empty trusted-proxy configuration does not add forwarded-header trust", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-agent-proxy-empty-"));
  try {
    const config = path.join(root, "nginx.conf");
    fs.writeFileSync(config, [
      "geo $realip_remote_addr $agent_trusted_proxy {",
      "    default 0;",
      "    127.0.0.1 1;",
      "    # BEGIN AGENT_TRUSTED_PROXIES",
      "    # END AGENT_TRUSTED_PROXIES",
      "}",
      "",
    ].join("\n"));
    const helper = path.join(here, "configure-agent-trusted-proxies.sh");
    const result = spawnSync("/bin/sh", [helper, config], {
      encoding: "utf8",
      env: { ...process.env, TRUSTED_PROXIES: "" },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = fs.readFileSync(config, "utf8");
    assert.ok(!output.includes(" 1;\n    # END AGENT_TRUSTED_PROXIES"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
