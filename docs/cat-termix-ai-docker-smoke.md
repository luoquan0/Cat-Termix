# Cat AI 26.11 Docker integration smoke

Build a disposable container from the pinned Termix 26.11.0 base, overlaying
the fork-compiled frontend/backend and the existing Cat Agent. Replace the
official built-in AI plugin at `/app/dist/plugins/ai` with exactly one Cat AI
`1.3.2-beta.1` plugin. No other official plugins are replaced.

The integration smoke verifies the new-volume container boots, the page and
health route work, the Agent legacy health route remains reachable, the custom
AI manifest and frontend/backend files exist, and AI REST endpoints do not
return missing-plugin/SPA errors. It never migrates production credentials or
data and never publishes a GHCR image.

A clean smoke is necessary but insufficient for release: real authenticated
models, vision requests, chat history, permissions, and native ARM64 are
separate beta.2 gates.
