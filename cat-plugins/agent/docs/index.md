# Local Agent migration to Termix 26.11

Test plugin version: `1.1.0-beta.1`.

**Routes:** signed API at `/agent/v1/*` (compatibility) or `/plugin-api/agent/v1/*`; browser management at `/plugin-api/agent/admin/*`. The new SDK can mount the declared legacy route without a bespoke core router. Preserve `req.originalUrl` exactly when verifying Ed25519 requests.

**Authorization:** short-lived pairing codes; server-side device approvals and revocation; per-host and per-scope checks; least-privileged SSH and SFTP through the core SDK. No device can select the owner identity in its request body.

**Transport:** HTTPS by default. Admin-managed private IPv4/CIDR exceptions use the policy dialog. With `CLOUDSSH_AGENT_HTTP_POLICY_LOCKED=true` the deployment also sets `CLOUDSSH_AGENT_ALLOW_HTTP` and `CLOUDSSH_AGENT_HTTP_ALLOWED_CIDRS`. An invalid locked config must not allow HTTP.

**Unsupported:** privileged `sudo: true` jobs are explicitly rejected with HTTP 501 `SUDO_UNAVAILABLE`. The new core has no audited sudo helper; old grants never bypass this denial.

**Acceptance:** plugin validation, full tests, TypeScript build, disabled and active plugin lifecycle, new-volume real container API, Ed25519 pairing, SFTP upload and download, and rollback tests. A CI pass is not proof of production-server compatibility. Do not reuse a live 2244 volume or auto-publish an image.
