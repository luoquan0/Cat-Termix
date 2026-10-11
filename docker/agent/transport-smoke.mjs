/** Run OUTSIDE the container: the bridge peer must not be treated as loopback. */
import assert from "node:assert/strict";
const base = process.env.CAT_TERMIX_SMOKE_URL ?? "http://127.0.0.1:19080";
for (const path of [
  "/agent/v1/health",
  "/plugin-api/agent/v1/health",
  "/plugin-api/agent/V1/health",
  "/plugin-api/agent/v1",
]) {
  for (const headers of [
    {},
    { "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" },
    {
      "x-forwarded-proto": "https",
      "x-forwarded-for": "192.168.1.1",
      "x-real-ip": "127.0.0.1",
    },
    {
      "x-forwarded-proto": "https, http",
      "x-forwarded-for": "::1",
      forwarded: "for=127.0.0.1;proto=https",
    },
  ]) {
    const response = await fetch(new URL(path, base), {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(
      response.status,
      426,
      `${path}: untrusted HTTP must not be promoted to HTTPS or loopback`,
    );
    const body = await response.json();
    assert.equal(body.code, "HTTPS_REQUIRED");
  }
}
console.log("Both Agent API entry points reject forged transport metadata");
