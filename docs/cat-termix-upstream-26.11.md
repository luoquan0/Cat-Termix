# Cat-Termix: isolated Termix 26.11.0 integration test

**Status: upstream core baseline only; NOT a Cat-Termix feature-complete image.**
Upstream: https://github.com/Termix-SSH/Termix/commit/6b06059411e517e4038531ddae756c7530516e13
Legacy customizations: https://github.com/luoquan0/Cat-Termix/tree/Cat-Termix
Test source branch: cat-termix/test-upstream-26.11

## Decision and safety boundary

The custom Cat-Termix branch is still based on Termix 2.9.2 and bundles
`plugins/ai`, `plugins/agent` and a separate Docker updater. Termix
26.11.0 moves official plugins into independently versioned `.tmxplug`
archives pinned by SHA-256 in `docker/bundled-plugins.json`. Its SDK
is `@termix-ssh/plugin-sdk` 1.0.22 with Plugin API 1.13.0.
Therefore a direct overlay/copy or database upgrade is unsafe.

This branch starts from an immutable upstream 26.11.0 core commit. The
test workflow validates the core, plugin catalog, locked dependencies and
a fresh-volume container boot. **It does not install any Cat-specific
plugin**, publish to GHCR, deploy to port 2244, touch `ai-dev`, run an
updater against existing volumes, or alter `Cat-Termix` / `main`.

Never attach existing production SQLite, Postgres or MySQL data to an
unvalidated new core: schema and plugin migrations need backup/restore
drills and an explicit, separate migration review.

## Incremental feature migration (separately gated)

1. **Core baseline:** test SDK, plugin packaging, startup, bundled
   AI/SSH/File Manager and permission/disable lifecycle. Use fresh data.
2. **Cat Agent plugin:** port Ed25519 device authorization, scoped
   jobs/session/SFTP and optional sudo to the current SDK, preserving
   signed raw bodies, least-privilege permissions, recovery ordering,
   durable storage and the strict HTTP/CIDR opt-in. Do not reuse old
   privileged scopes without review. Test disabled, timeout and restart.
3. **Cat AI plugin:** use the official 26.11 AI plugin as the new base.
   Re-implement missing Cat requirements only after a feature-by-feature
   comparison: multiple providers/models, per-user reasoning and
   approvals, shared terminal, conversation restore, image input/history,
   screenshot consent and safe context handling.
4. **Updater and branding:** carry across brand/wallpaper settings and
   release updater only after its OCI verify/rollback and no-Docker-
   socket-in-app boundaries are reviewed against the new core.
5. **Release gate:** independent AMD64/ARM64 builds, real plugin
   activation/API smoke, SSH/SFTP/sudo denial tests, database rollback,
   explicit user acceptance. Publish a **fixed test tag first**, never
   overwrite rolling `ai-dev` during integration.

## First-stage acceptance

- Pinned upstream Git commit and SDK version are verified.
- Bundled plugin catalog has unique IDs, official release URLs and
  SHA-256 pins; AI/terminal/file-manager exist.
- Core typecheck, unit tests and complete build pass.
- Standard-profile image boots on a disposable Docker volume; HTTP
  index and health endpoint respond.
- Failure blocks progression; CI log or a commit alone is not a release.

Deployment example after full Cat integration must use a new
`/app/data` volume and a separate port, not the live 2244 setup.

## First CI result: transient artifact download

The first CI run (#42470214521) passed dependency install, SDK and core
typechecking and the core unit suite. The complete build hit an upstream
Plugin-Alerts release HTTP 504, so the container job was correctly skipped.
The bundled downloader now retries 429/500/502/503/504 or network failures
up to three times with bounded backoff. It still fails immediately on
HTTP 404, rejects SHA-256 mismatches and never caches invalid archives.
Dedicated regression tests cover those cases. This is a core-only
compatibility test, not a Cat-feature-complete release.
