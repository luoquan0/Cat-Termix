# Cat AI v26.11 migration

**Branch:** `cat-termix/ai-port-26.11` (isolated staging, not the production `Cat-Termix` line).

- The original Cat AI v23 plugin was copied with migrations, backend/frontend source and regression tests.
- External SDK imports changed to `@termix-ssh/plugin-sdk` 1.0.22 (Plugin API 1.13.0).
- Model providers, per-channel selection, reasoning settings, host-bound conversations, screenshot uploads and image records remain in source.
- The old in-plugin software updater routes and admin UI were intentionally disabled. They are not part of this beta.
- **ID collision:** upstream 26.11 ships `ai` 1.3.1. The Cat beta keeps the `ai` ID to preserve API paths and will replace upstream AI **only in a disposable test image** after tests pass; never run both together.
- Fresh test volumes and explicit model provider credentials only. Do not attempt migration of the main 2244 data volume.

Acceptance remains pending until full tests, type checking, real container activation, image/chat API, and AMD64/ARM64 images succeed. Do not publish a beta.2 tag prematurely.

Remaining sequence after this migration: compare upstream stable 26.11.1 changes, review official plugin-center download path, and distinguish registry GitHub Release access failures from per-plugin compatibility errors.
