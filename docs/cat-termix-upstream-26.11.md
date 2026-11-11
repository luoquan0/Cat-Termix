# Cat-Termix: isolated Termix 26.11.0 integration test

**Status: upstream core baseline + initial Cat Agent 26.11 beta port; NOT feature complete or production ready.**
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

This branch starts from an immutable upstream 26.11.0 core commit.
The test workflow validates the core, plugin catalog, locked dependencies,
standalone Cat Agent SDK package and fresh-volume container boot. The
disposable test overlay **stages** the Cat Agent plugin but live device
pairing and activation remain unverified. It does not publish to GHCR,
deploy to port 2244, touch `ai-dev`, run an updater against existing
volumes, or alter `Cat-Termix` / `main`.

Never attach existing production SQLite, Postgres or MySQL data to an
unvalidated new core: schema and plugin migrations need backup/restore
drills and an explicit, separate migration review.

## Incremental feature migration (separately gated)

1. **Core baseline:** test SDK, plugin packaging, startup, bundled
   AI/SSH/File Manager and permission/disable lifecycle. Use fresh data.
2. **Cat Agent plugin:** initial 26.11 SDK port is staged and unit-tested.
   Next validate live pairing, scoped SSH/SFTP, recovery, HTTP/CIDR and
   disabled/enabled lifecycle on a new test volume. The new SDK has no
   audited sudo executor; `sudo: true` must return 501 without remote
   effects. Revisit privileged execution only through a future core API.
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
Dedicated regression tests cover those cases. That first run was core-only
compatibility testing, not a Cat-feature-complete release.

## Build reproducibility when upstream release CDN returns 504

A second CI run (#42470642874) passed the same core and retry regressions,
but GitHub Release download returned HTTP 504 again for the official
classic-layout plugin after the alerts package succeeded. Until those public
release assets are reliably reachable, the core CI now compiles the source
locally and tests it using a disposable overlay based on the official
versioned ghcr.io/termix-ssh/termix:26.11.0 image. The official base supplies
its pinned bundled plugins, native dependencies and entrypoint, while compiled
frontend, backend and SDK come from this branch's CI artifacts. The action
checks the official base's package version and records its registry digest.
The overlay Dockerfile is deliberately separate from docker/Dockerfile and
**never published**. The Agent beta has since been added to that isolated
overlay; real device/API E2E remains a separate gate. This does not weaken
the package integrity verifier.

## Phase 2: Cat Local Agent SDK migration (2026-11-09)

- Source: `cat-plugins/agent`, beta `1.1.0-beta.1`, using
  `@termix-ssh/plugin-sdk` 1.0.22 and Plugin API 1.13. The original
  standalone Cat plugin code and its security tests were migrated without
  modifying the upstream production core.
- Compatibility: the manifest still declares `/agent/v1` as a legacy
  route; the SDK also serves `/plugin-api/agent/v1`. Ed25519 signatures
  verify the exact original URL and raw body. Admin endpoints remain
  authenticated with a same-origin web session.
- Safety: the 26.11 SDK has neither `ssh:sudo` nor `ctx.ssh.execSudo`.
  Every `sudo: true` request is explicitly rejected with
  `501 SUDO_UNAVAILABLE` before enqueuing a job or connecting over SSH.
  Existing legacy scope records cannot make that execution available.
- CI: [run 42546211221](https://github.com/luoquan0/Cat-Termix/actions/runs/42546211221)
  passed **41/41 Agent tests**, type checking, plugin build and SDK
  validation, full Termix core tests, a locally built Docker test overlay,
  an empty-volume container startup and frontend/health/package checks.
  Integration source revision before this documentation update:
  `aa0ccd3aa29fb308c5a6c641238b6a958a977886`.
- **Not yet accepted:** Agent activation/enabling on a real fresh web
  instance, signed device pairing, host-scoped SSH job and cancellation,
  real SFTP upload/download, trusted HTTP CIDR routing through nginx,
  recovery after restart, revocation and sudo denial on a real test host,
  AMD64/ARM64 package publication, and migration/rollback with backup.
  None of this CI run touched a live 2244 instance or changed `ai-dev`.

## Legacy signed request body compatibility

The core's global JSON and urlencoded parsers now skip both `/plugin-api/` and the legacy `/agent/` mount. This preserves exact raw request bytes for Ed25519 body-hash verification on the old local-agent URL. The fresh-volume enrollment smoke must pass before any image publication.
