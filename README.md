# Cat-Termix

Cat-Termix is a customized distribution based on **Termix 2.9.1**, focused on self-hosted SSH/remote-desktop management plus the CloudSSH Agent workflow used by this project.

## Baseline

- Upstream: https://github.com/Termix-SSH/Termix
- Imported baseline: Termix 2.9.1 (`release-2.9.1-tag`)
- Cat-Termix repository: https://github.com/luoquan0/Cat-Termix
- Current Cat-Termix version: `2.9.1-cat.1`

The repository starts from a clean Cat-Termix Git history so future Cat-Termix work is easy to review, while the upstream remote remains available for synchronization.

## Product policy

Cat-Termix follows upstream Termix for the core platform and non-AI features, including the plugin framework, SSH terminal, file manager, remote desktop, tunnels, Docker, Proxmox, metrics, automations, fleets, workspaces, database backends, sync and security fixes.

The upstream **Termix AI Assistant** is intentionally not bundled in Cat-Termix. The `plugins/ai` source may remain in the tree to minimize upstream-sync conflicts and preserve migration compatibility, but it is excluded from `docker/bundled-plugins.json` and is not shipped as a bundled runtime plugin.

This is separate from the **CloudSSH Agent** functionality being migrated from Cat-Cloudssh. CloudSSH Agent provides device authentication and controlled remote automation APIs; it is not the upstream Termix AI Assistant.

## CloudSSH Agent migration

The migration target includes the hardened capabilities from Cat-Cloudssh:

- Ed25519 device authentication and device approval
- signed request headers
- nonce / replay protection
- project and credential isolation
- audit logging
- idempotency keys
- jobs
- sessions
- SFTP file operations
- ChatGPT/Agent Skill client
- explicit trusted-LAN HTTP opt-in while keeping HTTPS as the default

The stable Cat-Cloudssh repository remains the reference implementation while this port is adapted to the Termix 2.9 plugin/core architecture.

## Development

Requirements follow the upstream 2.9.1 baseline:

- Node.js 22.12 or newer
- npm 11 or newer

Install and validate:

```sh
npm ci
npm run lint
npm run format:check
npm run type-check
npm run test
npm run build
```

## Upstream synchronization

The local Git setup uses:

```text
origin   -> https://github.com/luoquan0/Cat-Termix.git
upstream -> https://github.com/Termix-SSH/Termix.git
```

New upstream releases should be reviewed and integrated through a dedicated sync branch instead of merging directly into the production branch.

## License and attribution

Cat-Termix is distributed under the Apache License 2.0 terms inherited from the upstream project. The original copyright and license notice in `LICENSE` is intentionally preserved.

See `NOTICE-CAT-TERMIX.md` for upstream attribution and Cat-Termix modification notes.
