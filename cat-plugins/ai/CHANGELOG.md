# Changelog

## 1.3.2-beta.1

Standalone test migration of Cat AI to Termix 26.11 SDK.

### Added

- Preserve multi-channel chat, reasoning preferences, host-scoped history and image recognition.
- Use a separate test-only AI plugin replacement for the official bundled `ai` plugin.

### Changed

- Disable the legacy Cat software updater in this beta; it requires an independent migration.
- Keep production data and provider credentials separate from this clean-volume test image.
