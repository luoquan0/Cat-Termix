# Cat-Termix Local Agent (Termix 26.11 test port)

This package migrates the signed Local Agent plugin from Cat-Termix 2.9.2 to the independent Termix 26.11 SDK. **This is a testing beta, not an upgrade for production data.**

It retains Ed25519 device enrollment, scoped SSH jobs, tmux-backed sessions, SFTP and the `/agent/v1` legacy path. HTTPS is the default; a trusted private IPv4/CIDR HTTP exception requires administrator approval.

**Sudo tasks are intentionally unavailable.** The 26.11 SDK does not offer `ssh:sudo` or `ctx.ssh.execSudo`. Requests with `sudo: true` return 501 without executing SSH or creating jobs, even for devices with a historical `sudo:execute` grant. The plugin never reads sudo passwords.

See [documentation](docs/index.md) before trying a fresh-volume test instance.
