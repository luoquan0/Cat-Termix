/** Run OUTSIDE the container: the bridge peer must not be treated as loopback. */
import assert from "node:assert/strict";
const base = process.env.CAT_TERMIX_SMOKE_URL ?? "http://127.0.0.1:19080";
for (const [path, expectedStatus] of [
  ["/agent/v1/health", 426],
  ["/plugin-api/agent/v1/health", 426],
  // Core's public-route matcher is case-sensitive. This alias is rejected by
  // authentication before Agent transport middleware; it must not become 200.
  ["/plugin-api/agent/V1/health", 401],
  ["/plugin-api/agent/v1", 426],
]) {
  let variant = 0;
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
      expectedStatus,
      `${path}: untrusted HTTP must not be promoted to HTTPS or loopback`,
    );
    const body = await response.json();
    if (expectedStatus === 426) {
      assert.equal(body.code, "HTTPS_REQUIRED");
    } else {
      assert.equal(body.error, "Missing authentication token");
    }
    console.log(`${path} variant ${++variant}: rejected with ${response.status}`);
  }
}
console.log("Both Agent API entry points reject forged transport metadata");
