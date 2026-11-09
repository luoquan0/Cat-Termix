import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const AGENT_LEGACY_LOCATION = [
  "        # Legacy signed CloudSSH Agent clients keep their /agent/v1 URL.",
  "        # Do not trust client-supplied X-Forwarded-* headers for this route.",
  "        location ^~ /agent/ {",
  "            proxy_pass http://127.0.0.1:30001;",
  "            proxy_http_version 1.1;",
  "            proxy_set_header Host $http_host;",
  "            proxy_set_header X-Real-IP $realip_remote_addr;",
  "            proxy_set_header X-Termix-Proxy-Peer $realip_remote_addr;",
  "            proxy_set_header X-Forwarded-For $realip_remote_addr;",
  "            proxy_set_header X-Forwarded-Proto $scheme;",
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

export function patchNginxTemplates(root = "/app/nginx") {
  for (const name of ["nginx.conf.template", "nginx-https.conf.template"]) {
    const file = path.join(root, name);
    const source = fs.readFileSync(file, "utf8");
    const marker = "        location ^~ /plugin-api/ {";
    const route = "        location ^~ /agent/ {";
    if (source.includes(route)) {
      if (
        !source.includes("proxy_set_header X-Forwarded-For $realip_remote_addr;") ||
        !source.includes("proxy_set_header X-Forwarded-Proto $scheme;")
      ) {
        throw new Error(name + ": an incomplete /agent/ location already exists");
      }
      continue;
    }
    const count = source.split(marker).length - 1;
    if (count !== 1) {
      throw new Error(name + ": expected one insertion point, found " + count);
    }
    fs.writeFileSync(file, source.replace(marker, AGENT_LEGACY_LOCATION + marker));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  patchNginxTemplates(process.env.TERMIX_NGINX_TEMPLATE_DIR || "/app/nginx");
}
