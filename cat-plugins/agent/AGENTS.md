# Local Agent coding guidance

## About this plugin

This is Cat-Termix's independent Agent plugin for Termix 26.11. Use the official SDK, never Termix private internals. Keep Ed25519 signing tied to the original method, request URL/query and raw body. Always recheck owner permissions, device scopes and host grants before remote work; never accept a user id from a device body. Inbound `/agent/v1` URLs must remain compatible, including the signed canonical URL.

Use core SSH connection APIs and scoped KV. Keep HTTPS and private CIDR HTTP policy opt-in with invalid configuration denied. Sudo is unsupported in this beta: do not reintroduce password access or manually wrap `sudo` around commands. Cancel running jobs and connections on device revocation. Maintain recovery fail-closed behavior.

This package is staged only in isolated testing; do not publish into `ai-dev` or mount production data volumes.
