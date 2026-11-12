import assert from "node:assert/strict";

const origin = process.env.CAT_TERMIX_SMOKE_URL ?? "http://127.0.0.1:19080";

async function check(path) {
  const response = await fetch(origin + path, { redirect: "manual" });
  const type = response.headers.get("content-type") ?? "";
  const body = await response.text();
  assert.ok(
    ![404, 502, 503].includes(response.status),
    `${path}: unexpected route status ${response.status} ${body.slice(0, 250)}`,
  );
  assert.ok(!/<html|<!doctype/i.test(body), `${path}: HTML rather than plugin API`);
  assert.ok(
    type.includes("application/json"),
    `${path}: missing JSON type (${type})`,
  );
  if (response.status === 200) assert.doesNotThrow(() => JSON.parse(body));
  console.log(`${path}: HTTP ${response.status} (${type})`);
}

await check("/plugin-api/ai/status");
await check("/plugin-api/ai/providers");
console.log("Cat AI beta REST routes are mounted and do not serve the upstream SPA.");
