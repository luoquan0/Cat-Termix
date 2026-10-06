#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

if [ "$(id -u)" = "0" ]; then
    if [ "$PUID" = "0" ]; then
        echo "Running as root (PUID=0, PGID=$PGID)"
        chown -R root:root /app/data /app/uploads /tmp/nginx 2>/dev/null || true
    else
        echo "Setting up user permissions (PUID: $PUID, PGID: $PGID)..."

        groupmod -o -g "$PGID" node 2>/dev/null || true
        usermod -o -u "$PUID" node 2>/dev/null || true

        chown -R node:node /app/data /app/uploads /app/html /tmp/nginx 2>/dev/null || true

        echo "User node is now UID: $PUID, GID: $PGID"

        exec gosu node:node "$0" "$@"
    fi
fi

DATA_DIR=${DATA_DIR:-/app/data}

RUNTIME_ENABLE_SSL_SET=${ENABLE_SSL+x}
RUNTIME_ENABLE_SSL=${ENABLE_SSL-}
RUNTIME_SSL_PORT_SET=${SSL_PORT+x}
RUNTIME_SSL_PORT=${SSL_PORT-}
RUNTIME_SSL_CERT_PATH_SET=${SSL_CERT_PATH+x}
RUNTIME_SSL_CERT_PATH=${SSL_CERT_PATH-}
RUNTIME_SSL_KEY_PATH_SET=${SSL_KEY_PATH+x}
RUNTIME_SSL_KEY_PATH=${SSL_KEY_PATH-}
RUNTIME_SSL_DOMAIN_SET=${SSL_DOMAIN+x}
RUNTIME_SSL_DOMAIN=${SSL_DOMAIN-}

if [ -f "$DATA_DIR/.env" ]; then
    echo "Loading persisted SSL settings from $DATA_DIR/.env"
    set -a
    . "$DATA_DIR/.env"
    set +a
fi

[ "$RUNTIME_ENABLE_SSL_SET" = "x" ] && ENABLE_SSL=$RUNTIME_ENABLE_SSL
[ "$RUNTIME_SSL_PORT_SET" = "x" ] && SSL_PORT=$RUNTIME_SSL_PORT
[ "$RUNTIME_SSL_CERT_PATH_SET" = "x" ] && SSL_CERT_PATH=$RUNTIME_SSL_CERT_PATH
[ "$RUNTIME_SSL_KEY_PATH_SET" = "x" ] && SSL_KEY_PATH=$RUNTIME_SSL_KEY_PATH
[ "$RUNTIME_SSL_DOMAIN_SET" = "x" ] && SSL_DOMAIN=$RUNTIME_SSL_DOMAIN

export PORT=${PORT:-8080}
export ENABLE_SSL=${ENABLE_SSL:-false}
export SSL_PORT=${SSL_PORT:-8443}
export SSL_CERT_PATH=${SSL_CERT_PATH:-/app/data/ssl/termix.crt}
export SSL_KEY_PATH=${SSL_KEY_PATH:-/app/data/ssl/termix.key}
export TERMIX_SSL_TERMINATED_BY_NGINX=true

normalize_cloudssh_proxy_cidrs() {
    node - "$1" <<'NODE'
const { isIP } = require("node:net");

const values = String(process.argv[2] || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (values.length > 64) process.exit(1);

const normalized = [];
for (const value of values) {
  const slash = value.lastIndexOf("/");
  const address = slash >= 0 ? value.slice(0, slash) : value;
  const version = isIP(address);
  if (!version) process.exit(1);
  let prefix = version === 4 ? 32 : 128;
  if (slash >= 0) {
    const raw = value.slice(slash + 1);
    if (!/^\d+$/.test(raw)) process.exit(1);
    prefix = Number(raw);
    if (prefix < 0 || prefix > (version === 4 ? 32 : 128)) process.exit(1);
  }
  const cidr = `${address}/${prefix}`;
  if (!normalized.includes(cidr)) normalized.push(cidr);
}
process.stdout.write(normalized.join("\n"));
NODE
}

NORMALIZED_CLOUDSSH_TRUSTED_PROXY_CIDRS=""
if [ -n "${CLOUDSSH_TRUSTED_PROXY_CIDR:-}" ]; then
    if ! NORMALIZED_CLOUDSSH_TRUSTED_PROXY_CIDRS=$(normalize_cloudssh_proxy_cidrs "$CLOUDSSH_TRUSTED_PROXY_CIDR"); then
        echo "ERROR: CLOUDSSH_TRUSTED_PROXY_CIDR must contain valid comma-separated IP addresses or CIDRs" >&2
        exit 1
    fi
fi

CLOUDSSH_TRUSTED_PROXY_SET_REAL_IP=$(
    if [ -n "$NORMALIZED_CLOUDSSH_TRUSTED_PROXY_CIDRS" ]; then
        printf '%s\n' "$NORMALIZED_CLOUDSSH_TRUSTED_PROXY_CIDRS" |
            sed 's/^/    set_real_ip_from /; s/$/;/'
    fi
)
export CLOUDSSH_TRUSTED_PROXY_SET_REAL_IP

echo "Configuring web UI to run on port: $PORT"

if [ "$ENABLE_SSL" = "true" ]; then
    echo "SSL enabled - using HTTPS configuration with redirect"
    NGINX_CONF_SOURCE="/app/nginx/nginx-https.conf.template"
else
    echo "SSL disabled - using HTTP-only configuration (default)"
    NGINX_CONF_SOURCE="/app/nginx/nginx.conf.template"
fi

mkdir -p /tmp/nginx
envsubst '${PORT} ${SSL_PORT} ${SSL_CERT_PATH} ${SSL_KEY_PATH} ${CLOUDSSH_TRUSTED_PROXY_SET_REAL_IP}' < "$NGINX_CONF_SOURCE" > /tmp/nginx/nginx.conf

if [ "$ENABLE_SSL" = "true" ] && [ "$PORT" = "$SSL_PORT" ]; then
    echo "HTTP and HTTPS use port $SSL_PORT; disabling the HTTP redirect listener"
    sed -i '/# BEGIN HTTP_REDIRECT_SERVER/,/# END HTTP_REDIRECT_SERVER/d' /tmp/nginx/nginx.conf
fi

mkdir -p /app/data /app/uploads
chmod 755 /app/data /app/uploads 2>/dev/null || true

if [ -w /app/data ]; then
    echo "Data directory is writable"
else
    echo "WARNING: Data directory is not writable. Plugins that keep files (OPKSSH, recordings) may fail."
    ls -ld /app/data
fi

if [ "$ENABLE_SSL" = "true" ]; then
    echo "Checking SSL certificate configuration..."
    mkdir -p /app/data/ssl
    chmod 755 /app/data/ssl 2>/dev/null || true

    DOMAIN=${SSL_DOMAIN:-localhost}
    
    if [ -f "/app/data/ssl/termix.crt" ] && [ -f "/app/data/ssl/termix.key" ]; then
        echo "SSL certificates found, checking validity..."
        
        if openssl x509 -in /app/data/ssl/termix.crt -checkend 2592000 -noout >/dev/null 2>&1; then
            echo "SSL certificates are valid and will be reused for domain: $DOMAIN"
        else
            SUBJECT=$(openssl x509 -in /app/data/ssl/termix.crt -noout -subject 2>/dev/null | sed 's/^subject=//')
            ISSUER=$(openssl x509 -in /app/data/ssl/termix.crt -noout -issuer 2>/dev/null | sed 's/^issuer=//')
            # Only replace our own self-signed certificate. A CA-issued one is
            # kept until it expires, even when nothing renews it.
            if [ -n "$SUBJECT" ] && [ "$SUBJECT" = "$ISSUER" ]; then
                echo "Self-signed SSL certificate is expired or expiring soon, regenerating..."
                rm -f /app/data/ssl/termix.crt /app/data/ssl/termix.key
            else
                echo "WARNING: SSL certificate expires within 30 days and was not issued by Termix. Renew it."
            fi
        fi
    else
        echo "SSL certificates not found, will generate new ones..."
    fi
    
    if [ ! -f "/app/data/ssl/termix.crt" ] || [ ! -f "/app/data/ssl/termix.key" ]; then
        echo "Generating SSL certificates for domain: $DOMAIN"

        cat > /app/data/ssl/openssl.conf << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C=US
ST=State
L=City
O=Termix
OU=IT Department
CN=$DOMAIN

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = $DOMAIN
DNS.2 = localhost
DNS.3 = 127.0.0.1
IP.1 = 127.0.0.1
IP.2 = ::1
IP.3 = 0.0.0.0
EOF

        openssl genrsa -out /app/data/ssl/termix.key 2048

        openssl req -new -x509 -key /app/data/ssl/termix.key -out /app/data/ssl/termix.crt -days 365 -config /app/data/ssl/openssl.conf -extensions v3_req

        chmod 600 /app/data/ssl/termix.key
        chmod 644 /app/data/ssl/termix.crt

        rm -f /app/data/ssl/openssl.conf
        
        echo "SSL certificates generated successfully for domain: $DOMAIN"
    fi
fi

echo "Starting nginx..."
nginx -c /tmp/nginx/nginx.conf

# Inject runtime BASE_PATH into frontend if configured
if [ -n "$BASE_PATH" ]; then
    echo "Injecting BASE_PATH: $BASE_PATH"
    # Strip trailing slash for use as a path prefix
    CLEAN_BASE_PATH="${BASE_PATH%/}"
    case "$CLEAN_BASE_PATH" in
        /*) ;;
        *) echo "BASE_PATH must start with /" >&2; exit 1 ;;
    esac
    case "$CLEAN_BASE_PATH" in
        *[!A-Za-z0-9_./~-]*) echo "BASE_PATH contains unsupported characters" >&2; exit 1 ;;
    esac
    find /app/html -name "index.html" -exec sed -i "s|name=\"termix-base-path\" content=\"\"|name=\"termix-base-path\" content=\"$CLEAN_BASE_PATH\"|g" {} \;
    # Patch sw.js static asset paths with the base path prefix
    find /app/html -name "sw.js" -exec sed -i "s|__TERMIX_SW_BASE_PATH__|$CLEAN_BASE_PATH|g" {} \;
else
    # No base path - replace placeholder with empty string so paths stay absolute from root
    find /app/html -name "sw.js" -exec sed -i "s|__TERMIX_SW_BASE_PATH__||g" {} \;
fi

echo "Starting backend services..."
cd /app
export NODE_ENV=production

if [ -f "package.json" ]; then
    VERSION=$(grep '"version"' package.json | sed 's/.*"version": *"\([^"]*\)".*/\1/')
    if [ -n "$VERSION" ]; then
        export VERSION
    else
        echo "Warning: Could not extract version from package.json"
    fi
else
    echo "Warning: package.json not found"
fi

exec node dist/backend/backend/starter.js
