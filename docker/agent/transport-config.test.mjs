import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
for (const file of ["nginx.conf", "nginx-https.conf"]) {
  test(`${file}: public Agent aliases use the same real TCP peer and protocol`, () => {
    const config = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(
      !config.includes("location ^~ /plugin-api/ {"),
      "A priority prefix must not bypass the case-insensitive Agent guard",
    );
    for (const location of [
      "location ^~ /agent/ {",
      "location ~* ^/plugin-api/agent/v1(?:/|$) {",
    ]) {
      const start = config.indexOf(location);
      assert.ok(start >= 0, `Missing hardened ${location}`);
      const block = config.slice(start, config.indexOf("}", start));
      assert.ok(
        block.includes("proxy_set_header X-Real-IP $realip_remote_addr;"),
      );
      assert.ok(
        block.includes("proxy_set_header X-Forwarded-For $realip_remote_addr;"),
      );
      assert.ok(block.includes("proxy_set_header X-Forwarded-Proto $scheme;"));
      assert.ok(
        !block.includes("$http_x_forwarded") &&
          !block.includes("$proxy_add_x_forwarded_for"),
      );
    }
  });
}
