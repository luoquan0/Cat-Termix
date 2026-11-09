# Changelog

## 1.1.0-beta.1

First independent test port of the Cat Local Agent to Termix 26.11.

### Changed

- Migrate the Cat Agent plugin to `@termix-ssh/plugin-sdk` 1.0.22 and Plugin API 1.13.
- Preserve signed legacy `/agent/v1` routing, persistent SSH jobs, sessions, SFTP and explicit HTTP/CIDR transport policy.
- Stop advertising the unavailable `ssh:sudo` capability; fail privileged requests before storing jobs or connecting to hosts.
- Add standalone plugin build, validation, documentation and isolation checks.
