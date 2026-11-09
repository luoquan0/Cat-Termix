import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import assert from "node:assert/strict";

const origin = process.env.CAT_TERMIX_SMOKE_URL || "http://127.0.0.1:19080";
const path = "/agent/v1";
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const digest = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
async function json(response, code) {
  const body = await response.json();
  assert.equal(response.status, code, JSON.stringify(body));
  return body;
}
const health = await json(await fetch(origin + path + "/health"), 200);
assert.equal(health.status, "ok");
const registration = await json(await fetch(origin + path + "/auth/device-requests", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ deviceName: "CI local-agent smoke", publicKey }),
}), 201);
const request = registration.request;
assert.match(request.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
assert.ok(request.requestId);
const pollPath = path + "/auth/device-requests/" + request.requestId;
const timestamp = String(Date.now());
const nonce = randomBytes(18).toString("base64url");
const requestId = "cat-agent-smoke-1";
const canonical = [
  "cloudssh-device-v2", "GET", pollPath, timestamp, nonce, digest, "", requestId,
].join("\n");
const signature = sign(null, Buffer.from(canonical), keys.privateKey).toString("base64url");
const headers = {
  "x-cloudssh-device-id": "", "x-cloudssh-timestamp": timestamp,
  "x-cloudssh-nonce": nonce, "x-cloudssh-body-sha256": digest,
  "x-cloudssh-signature": signature, "x-request-id": requestId,
};
const status = await json(await fetch(origin + pollPath, { headers }), 200);
assert.equal(status.status, "pending");
const unapproved = await fetch(origin + path + "/servers", { headers });
assert.equal(unapproved.status, 401, "unapproved device may not list hosts");
console.log("Local Agent Nginx, enrollment and Ed25519 signature smoke passed");
