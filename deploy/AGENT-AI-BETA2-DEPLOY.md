# Cat-Termix 26.11 Agent + AI Beta.2 deployment

## Isolated test image

Image: `ghcr.io/luoquan0/cat-termix:26.11-agent-ai-beta.2`

This beta combines the Termix 26.11.0 core with the separate Cat Agent
1.1.0-beta.1 and Cat AI 1.3.2-beta.1 plugins. Native AMD64 and ARM64 CI
must succeed before the image tag is published. The original Termix AI plugin
is replaced only inside the disposable Beta.2 image to avoid duplicate IDs.

**No Cat updater is included. Agent sudo requests return
`501 SUDO_UNAVAILABLE`.** Existing credentials, chat history and data are
not migrated from Cat-Termix v23 or the Agent Beta.1 volume.

## Deploy in isolation

```sh
curl -fsSL -o cat-termix-agent-ai-beta2.compose.yml https://raw.githubusercontent.com/luoquan0/Cat-Termix/cat-termix/ai-port-26.11/deploy/cat-termix-agent-ai-beta2.compose.yml
docker compose -f cat-termix-agent-ai-beta2.compose.yml pull
docker compose -f cat-termix-agent-ai-beta2.compose.yml up -d
docker compose -f cat-termix-agent-ai-beta2.compose.yml ps
docker logs --tail 120 cat-termix-agent-ai-beta2
```

The host port is **2246**, container HTTP port **8080**, container name
`cat-termix-agent-ai-beta2`, named data volume
`cat-termix-agent-ai-beta2-data`. None is shared with Agent Beta.1 on
port 2245 or the production environment on 2244.

Open `http://YOUR-TEST-SERVER:2246` (or your HTTPS reverse proxy).
Finish fresh administrator setup, inspect the Plugins page for **Cat AI
Assistant** and **Local Agent**, and enable AI globally and for your user
before configuring a new model provider/channel. Use HTTPS for browser
screen capture; paste/upload image files may work over private-LAN HTTP.

## Registry and plugin-center downloads

The Termix backend—not the browser—downloads the registry index from
`https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/official/index.json`
and plugin archives from GitHub Release URLs. Direct download works when
the container's own egress to GitHub succeeds. If it does not, configure
an outbound HTTP/HTTPS proxy reachable **from the container**:

```sh
export TERMIX_HTTPS_PROXY=http://PROXY-HOST-REACHABLE-FROM-DOCKER:7890
export TERMIX_HTTP_PROXY=http://PROXY-HOST-REACHABLE-FROM-DOCKER:7890
docker compose -f cat-termix-agent-ai-beta2.compose.yml up -d
```

Do not use `127.0.0.1` as a host-side proxy address in Docker unless a
proxy actually runs inside this same container: loopback inside Docker is
not the Docker host. On Linux the host-gateway mapping or a reachable LAN
address may be required. Never commit proxy credentials to this repo or
paste an authenticated proxy URL into logs. `TERMIX_NO_PROXY` supports
hostnames/exact hosts, not CIDR ranges.

Check the raw registry and a specific plugin release URL from **inside the
container** (use the affected plugin's actual URL from its registry entry).
Preserve exact error status, plugin id/version, and redacted container
logs. A 404, permission/consent 409, signature failure or incompatible SDK
version is not fixed by a proxy. Do **not** bypass signed archive checks or
use an untrusted registry mirror.

## Acceptance

1. Confirm `docker inspect --format '{{.State.Health.Status}}'
   cat-termix-agent-ai-beta2` reports healthy.
2. Confirm plugin `ai` version `1.3.2-beta.1` is active and that only one
   `ai` manifest exists.
3. Create a new provider/channel, set model/reasoning level, open a chat,
   upload an image, and verify conversation recovery after closing/reopening.
4. Confirm Agent pairing, host-scoped SSH, SFTP, revocation and reboot
   recovery without reusing Beta.1 or production credentials.
5. Check plugin-center download errors separately; provide exact status/log.

## Remove the disposable instance

```sh
docker compose -f cat-termix-agent-ai-beta2.compose.yml down
# Only when the test data is no longer needed:
docker volume rm cat-termix-agent-ai-beta2-data
```

Do not run `down -v` on the production or Beta.1 compose project.
