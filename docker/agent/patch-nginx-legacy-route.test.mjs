import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_LEGACY_LOCATION, patchNginxTemplates } from "./patch-nginx-legacy-route.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceFiles = ["nginx.conf", "nginx-https.conf"];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-agent-nginx-"));
  for (const sourceName of sourceFiles) {
    const source = fs.readFileSync(path.join(here, "..", sourceName), "utf8");
    fs.writeFileSync(path.join(root, sourceName + ".template"), source);
  }
  return root;
}

test("adds a hardened legacy Agent route to both HTTP and HTTPS templates", () => {
  const root = fixture();
  try {
    patchNginxTemplates(root);
    for (const name of ["nginx.conf.template", "nginx-https.conf.template"]) {
      const content = fs.readFileSync(path.join(root, name), "utf8");
      assert.ok(content.includes(AGENT_LEGACY_LOCATION));
      assert.ok(content.indexOf("location ^~ /agent/ {") < content.indexOf("location ^~ /plugin-api/ {"));
      assert.ok(content.includes("proxy_set_header X-Real-IP $realip_remote_addr;"));
      assert.ok(content.includes("proxy_set_header X-Forwarded-For $realip_remote_addr;"));
      assert.ok(content.includes("proxy_set_header X-Forwarded-Proto $scheme;"));
      const routeStart = content.indexOf("location ^~ /agent/ {");
      const routeEnd = content.indexOf("}", routeStart);
      const route = content.slice(routeStart, routeEnd);
      assert.ok(!route.includes("$proxy_add_x_forwarded_for"));
      assert.ok(!route.includes("$http_x_forwarded"));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    assert.throws(() => patchNginxTemplates(root), /expected one insertion point/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
