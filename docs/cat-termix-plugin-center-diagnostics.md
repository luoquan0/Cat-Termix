# Termix 26.11 plugin-center downloads: diagnosis and proxies

The plugin center does **not** require a proxy if the **Termix server
container** can reach GitHub. The 26.11 downloader requests the official
registry index at:

```
https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/official/index.json
```

It then downloads a SHA-256 pinned `.tmxplug` archive from the selected
plugin's GitHub Release URL. The HTTP requests use the container's
`HTTPS_PROXY`/`HTTP_PROXY` (or lowercase equivalent) and `NO_PROXY`
settings; setting a proxy only in a client browser does not help a
self-hosted server-side download.

## Check from the actual container

For Beta.2 running as `cat-termix-agent-ai-beta2`:

```sh
docker exec cat-termix-agent-ai-beta2 sh -lc '
  export https_proxy="${HTTPS_PROXY:-${https_proxy:-}}"
  wget --spider -S --timeout=20 --tries=1     https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/official/index.json
'

docker exec cat-termix-agent-ai-beta2 sh -lc '
  export https_proxy="${HTTPS_PROXY:-${https_proxy:-}}"
  wget --spider -S --timeout=20 --tries=1     https://github.com/Termix-SSH/Plugin-ACME-SSL/releases/download/v1.1.0/acme-ssl-1.1.0.tmxplug
'
```

The second command checks an example official Release URL and its
redirect/CDN path, without downloading the entire archive. For a specific
failing plugin, use its **actual** `versions[].url` from the signed
official catalog instead. Avoid putting secrets in the command or
publishing headers that include credentials.

Interpretation:

- Registry fails (DNS timeout, TLS, 502/503/504): test a network route or
  container-level proxy before altering Termix code.
- Registry works, release asset fails: GitHub Release/CDN egress may be
  blocked while `raw.githubusercontent.com` remains available.
- Both work, but clicking Install fails: inspect browser's actual HTTP
  request, the plugin ID/version, server logs, and any signed-package
  failure. Status 403 can mean missing administrator permission; 409 can
  mean missing consent/dependencies/version conflict; 502 can mean
  download/registry error. These are different from a browser network bug.
- An installed but disabled plugin is not the same as a failed download;
  check its state and startup log before reinstalling.

To collect diagnostics, reproduce the click once and collect sanitized
logs (never copy credentials or private host data):

```sh
docker logs --since 10m cat-termix-agent-ai-beta2 2>&1 |   grep -Ei 'plugin|registry|download|signature|timeout|403|409|502|503|504' |   tail -n 100
```

## Optional proxy in the Beta.2 Compose file

The Beta.2 compose passes `TERMIX_HTTPS_PROXY`,
`TERMIX_HTTP_PROXY` and `TERMIX_NO_PROXY` from host environment
into container `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`.

```sh
export TERMIX_HTTPS_PROXY=http://PROXY-IP-REACHABLE-FROM-CONTAINER:7890
export TERMIX_HTTP_PROXY=http://PROXY-IP-REACHABLE-FROM-CONTAINER:7890
docker compose -f cat-termix-agent-ai-beta2.compose.yml up -d
```

A proxy listening only on the host's `127.0.0.1` is **not** reachable
through Docker's container loopback. Use a reachable host address or
Docker host-gateway mapping with appropriate authentication/firewall
restrictions. Do not commit authenticated proxy URLs into version
control. The Termix `NO_PROXY` matching is hostname-based, not CIDR.

Termix upstream issue
[Termix-SSH/Termix#1707](https://github.com/Termix-SSH/Termix/issues/1707)
confirms proxy support was shipped in v26.10.5. The
`src/backend/plugins/registry-index.ts` downloader is unchanged between
26.11.0 and 26.11.1, so **upgrading alone does not guarantee that a
manual Install click will work**. Release 26.11.1 has other plugin
improvements (missing bundled plugin auto-recovery, Actions, panels),
which should be evaluated separately.

Keep official plugin signatures and SHA-256 checks enabled. Do not
work around network problems with unsigned packages or untrusted
mirrors.
