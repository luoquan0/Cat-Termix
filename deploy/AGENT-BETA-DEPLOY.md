# Cat-Termix 26.11 Agent beta deployment

Image:
- Multi-architecture: \`ghcr.io/luoquan0/cat-termix:26.11-agent-beta.1\`
- Immutable commit tag: \`ghcr.io/luoquan0/cat-termix:sha-<full-commit-sha>\`
- Platforms: linux/amd64 and linux/arm64

This is a disposable beta instance. It contains upstream Termix 26.11.0 plus
the Cat Local Agent 1.1.0-beta.1 plugin. It does not contain the migrated Cat
AI plugin or the Cat updater. It must not reuse any existing Cat-Termix data.

## Docker Compose

From a directory containing the downloaded compose file:

\`\`\`sh
docker compose -f cat-termix-agent-beta.compose.yml pull
docker compose -f cat-termix-agent-beta.compose.yml up -d
docker compose -f cat-termix-agent-beta.compose.yml ps
docker logs --tail 100 -f cat-termix-agent-beta
\`\`\`

The compose file publishes host TCP 2245 to container TCP 8080 and creates
the isolated named volume \`cat-termix-agent-beta-data\`.

## Docker run alternative

\`\`\`sh
docker pull ghcr.io/luoquan0/cat-termix:26.11-agent-beta.1
docker volume create cat-termix-agent-beta-data
docker run -d \\
  --name cat-termix-agent-beta \\
  --restart unless-stopped \\
  -p 2245:8080 \\
  -v cat-termix-agent-beta-data:/app/data \\
  ghcr.io/luoquan0/cat-termix:26.11-agent-beta.1
\`\`\`

## Registry access

If anonymous pulls are unavailable, authenticate with a GitHub token that
has \`read:packages\`:

\`\`\`sh
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
\`\`\`

Do not put the token in shell history or send it to the Agent.

## First boot and Local Agent pairing

1. Open \`http://SERVER-IP:2245\` (or the HTTPS reverse-proxy URL).
2. Finish the fresh Termix administrator setup. The bundled Local Agent
   plugin is recommended and enabled on a new beta volume.
3. Confirm Plugins > Local Agent is active and the Agent health endpoint
   responds from inside the server:
   \`docker exec cat-termix-agent-beta wget -q -O - http://127.0.0.1:30001/health\`
4. Prefer an HTTPS reverse proxy for the Local Agent URL.
5. If using direct private-LAN HTTP, add only the local Agent's real source
   IP/CIDR in Local Agent's administrator HTTP policy. The server rejects
   HTTP by default; the client's \`--allow-http\` flag alone is not enough.
6. Pair the local Agent against \`https://SERVER-DOMAIN\` or the approved
   private-LAN URL on port 2245.

The legacy signed endpoint \`/agent/v1\` is preserved. The 26.11 beta
explicitly rejects \`sudo: true\` with \`501 SUDO_UNAVAILABLE\`; do not use
this beta for root-required operations.

## Health and isolation

\`\`\`sh
docker inspect --format '{{.State.Health.Status}}' cat-termix-agent-beta
docker logs --tail 200 cat-termix-agent-beta
docker volume inspect cat-termix-agent-beta-data
\`\`\`

Do not mount the existing 2244 volume, reuse the production container name,
or point the production reverse proxy at port 2245. Remove the beta only
after saving any test logs you need:

\`\`\`sh
docker compose -f cat-termix-agent-beta.compose.yml down
# This separately deletes beta data; run only when the test data is disposable:
docker volume rm cat-termix-agent-beta-data
\`\`\`
