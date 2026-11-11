# Cat-Termix 26.11 Agent beta deployment

<badge> </badge>

## Published image

- Multi-architecture image: `ghcr.io/luoquan0/cat-termix:26.11-agent-beta.1`
- Immutable source tag: `ghcr.io/luoquan0/cat-termix:sha-9746f1ab813238adf9ee52f4c27ce38af4aa8caa`
- OCI index digest: `sha256:271798946cccbd927ec6d90a1c2bc5d91def4c5b4b84e3ab78df4cdd22b2b5d6`
- AMD64 manifest: `sha256:6e3b194ff7f03fc7916971b824c81a8e0194b443d25bb43bf75ae7fdc9444221`
- ARM64 manifest: `sha256:54dfd5563d503a6b8f3c74025cfef0cf2d69b3f0557c782ed217cb75d97d79e9`
- Anonymous GHCR pull: available

This is a disposable beta instance. It contains upstream Termix 26.11.0
plus Cat Local Agent 1.1.0-beta.1. It does not contain the migrated Cat AI
plugin or Cat updater. It must not reuse any existing Cat-Termix data.

## Deploy with Docker Compose

Download the compose file and start the isolated instance:

```sh
curl -fsSL -o cat-termix-agent-beta.compose.yml https://raw.githubusercontent.com/luoquan0/Cat-Termix/cat-termix/test-upstream-26.11/deploy/cat-termix-agent-beta.compose.yml
docker compose -f cat-termix-agent-beta.compose.yml pull
docker compose -f cat-termix-agent-beta.compose.yml up -d
docker compose -f cat-termix-agent-beta.compose.yml ps
docker logs --tail 100 -f cat-termix-agent-beta
```

The compose file publishes host TCP **2245** to container TCP 8080 and
creates the isolated named volume **cat-termix-agent-beta-data**.
It does not reference the existing 2244 container or volume.

## Docker run alternative

```sh
docker pull ghcr.io/luoquan0/cat-termix:26.11-agent-beta.1
docker volume create cat-termix-agent-beta-data
docker run -d --name cat-termix-agent-beta --restart unless-stopped -p 2245:8080 -v cat-termix-agent-beta-data:/app/data ghcr.io/luoquan0/cat-termix:26.11-agent-beta.1
```

## First boot and Local Agent pairing

1. Open `http://SERVER-IP:2245` and finish the fresh Termix administrator setup.
2. The bundled Local Agent plugin is recommended and enabled on a new beta volume. Confirm it is active in Plugins.
3. Prefer HTTPS for the Local Agent URL.
4. For direct private-LAN HTTP, add only the local Agent's actual source IP/CIDR in the Local Agent administrator transport policy. HTTP is denied by default; the client's `--allow-http` flag alone is not enough.
5. Pair the local Agent using the HTTPS domain, or the approved private-LAN URL on port 2245.

### If HTTPS terminates at a reverse proxy

Set the container environment variable `TRUSTED_PROXIES` to the exact IP/CIDR
of the reverse proxy (for example `172.20.0.5/32`). Do not trust an entire
private subnet unless every host in that subnet is a trusted proxy.

Only explicitly configured proxy peers may supply `X-Forwarded-Proto` and
the forwarded client address for Agent requests. Direct clients cannot
promote HTTP to HTTPS by forging forwarded headers. Termix's own
`ENABLE_SSL=true` mode is also supported.

The legacy signed endpoint `/agent/v1` and the SDK endpoint
`/plugin-api/agent/v1` are both enabled and covered by the CI smoke tests.

## Known beta limitation

The 26.11 SDK has no audited sudo executor. Agent requests with
`sudo: true` are rejected with `501 SUDO_UNAVAILABLE` before SSH or job
creation. Do not use this beta for root-required operations.

## Health and isolation

```sh
docker inspect --format '{{.State.Health.Status}}' cat-termix-agent-beta
docker logs --tail 200 cat-termix-agent-beta
docker volume inspect cat-termix-agent-beta-data
```

Do not mount the existing 2244 volume, reuse the production container name,
or point the production reverse proxy at port 2245.

To remove the beta container while retaining its test data:

```sh
docker compose -f cat-termix-agent-beta.compose.yml down
```

Only when the beta data is disposable, remove its volume separately:

```sh
docker volume rm cat-termix-agent-beta-data
```
