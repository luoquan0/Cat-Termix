import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_TRUST_PROXY_MAP = [
  "    # Trust forwarded protocol only when the original TCP peer is an explicitly configured reverse proxy.",
  "    geo $realip_remote_addr $agent_trusted_proxy {",
  "        default 0;",
  "        127.0.0.1 1;",
  "        # BEGIN AGENT_TRUSTED_PROXIES",
  "        # END AGENT_TRUSTED_PROXIES",
  "    }",
  "",
  "    map \"$agent_trusted_proxy:$http_x_forwarded_proto\" $agent_forwarded_proto {",
  "        default $scheme;",
  "        \"1:https\" https;",
  "        \"1:http\" http;",
  "    }",
  "",
  "    map $agent_trusted_proxy $agent_client_ip {",
  "        default $realip_remote_addr;",
  "        1 $remote_addr;",
  "    }",
  "",
].join("\n");

function agentLocation(prefix, comment) {
  return [
    "        " + comment,
    "        # The original TCP peer is retained separately from forwarded client metadata.",
    "        location ^~ " + prefix + " {",
    "            proxy_pass http://127.0.0.1:30001;",
    "            proxy_http_version 1.1;",
    "            proxy_set_header Host $http_host;",
    "            proxy_set_header X-Real-IP $agent_client_ip;",
    "            proxy_set_header X-Termix-Proxy-Peer $realip_remote_addr;",
    "            proxy_set_header X-Forwarded-For $agent_client_ip;",
    "            proxy_set_header X-Forwarded-Proto $agent_forwarded_proto;",
    "            proxy_set_header X-Forwarded-Host $http_host;",
    "            proxy_set_header X-Forwarded-Port $server_port;",
    "            proxy_read_timeout 86400s;",
    "            proxy_send_timeout 86400s;",
    "            proxy_connect_timeout 10s;",
    "            proxy_buffering off;",
    "            proxy_request_buffering off;",
    "            client_max_body_size 0;",
    "        }",
    "",
  ].join("\n");
}

export const AGENT_LEGACY_LOCATION = agentLocation(
  "/agent/",
  "# Legacy signed CloudSSH Agent clients keep their /agent/v1 URL.",
);
export const AGENT_PLUGIN_API_LOCATION = agentLocation(
  "/plugin-api/agent/v1",
  "# Protect the SDK route from untrusted forwarded-protocol headers.",
);

export function patchNginxTemplates(root = "/app/nginx") {
  for (const name of ["nginx.conf.template", "nginx-https.conf.template"]) {
    const file = path.join(root, name);
    let source = fs.readFileSync(file, "utf8");
    const mapMarker = "    map $http_x_forwarded_proto $proxy_x_forwarded_proto {";
    const pluginMarker = "        location ^~ /plugin-api/ {";
    if (!source.includes(AGENT_TRUST_PROXY_MAP.trim().split("\n")[0])) {
      if (source.split(mapMarker).length - 1 !== 1) {
        throw new Error(name + ": expected one HTTP-context map insertion point");
      }
      source = source.replace(mapMarker, AGENT_TRUST_PROXY_MAP + mapMarker);
    } else if (
      !source.includes("map $agent_trusted_proxy $agent_client_ip {") ||
      !source.includes("map \"$agent_trusted_proxy:$http_x_forwarded_proto\" $agent_forwarded_proto {")
    ) {
      throw new Error(name + ": incomplete Agent trusted-proxy map");
    }
    for (const [prefix, block] of [
      ["/agent/", AGENT_LEGACY_LOCATION],
      ["/plugin-api/agent/v1", AGENT_PLUGIN_API_LOCATION],
    ]) {
      const location = "location ^~ " + prefix + " {";
      if (source.includes(location)) {
        const start = source.indexOf(location);
        const end = source.indexOf("}", start);
        const existing = source.slice(start, end);
        if (
          !existing.includes("proxy_set_header X-Forwarded-For $agent_client_ip;") ||
          !existing.includes("proxy_set_header X-Forwarded-Proto $agent_forwarded_proto;")
        ) {
          throw new Error(name + ": incomplete Agent route " + prefix);
        }
        continue;
      }
      if (source.split(pluginMarker).length - 1 !== 1) {
        throw new Error(name + ": expected one Agent route insertion point");
      }
      source = source.replace(pluginMarker, block + pluginMarker);
    }
    fs.writeFileSync(file, source);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  patchNginxTemplates(process.env.TERMIX_NGINX_TEMPLATE_DIR || "/app/nginx");
}
