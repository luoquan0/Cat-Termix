import assert from "node:assert/strict";

const origin = process.env.CAT_TERMIX_SMOKE_URL ?? "http://127.0.0.1:19080";

async function check(path) {
  let response;
  // Core HTTP may report 503 while the plugin is still activating.
  // Retry startup only; permanent 503, 404 and 500 still fail.
  for (let attempt = 0; attempt < 45; attempt++) {
    response = await fetch(origin + path, { redirect: "manual" });
    if (response.status !== 503) break;
    await response.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const type = response.headers.get("content-type") ?? "";
  const body = await response.text();
  assert.ok(
    [200, 401, 403].includes(response.status),
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
