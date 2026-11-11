#!/bin/sh
set -eu

CONFIG_FILE=${1:?usage: configure-agent-trusted-proxies.sh nginx.conf}
BEGIN_MARKER="# BEGIN AGENT_TRUSTED_PROXIES"
END_MARKER="# END AGENT_TRUSTED_PROXIES"
BEGIN_COUNT=$(grep -cF "$BEGIN_MARKER" "$CONFIG_FILE" || true)
END_COUNT=$(grep -cF "$END_MARKER" "$CONFIG_FILE" || true)
if [ "$BEGIN_COUNT" -ne 1 ] || [ "$END_COUNT" -ne 1 ]; then
    echo "Agent trusted-proxy markers are missing or duplicated" >&2
    exit 1
fi

AGENT_PROXY_LINES=""
for proxy in $(printf '%s' "${TRUSTED_PROXIES:-}" | tr ',' ' '); do
    case "$proxy" in
        *[!0-9a-fA-F:./]*)
            echo "Ignoring invalid Agent TRUSTED_PROXIES entry: $proxy" >&2
            ;;
        127.0.0.1)
            ;;
        *)
            AGENT_PROXY_LINES="${AGENT_PROXY_LINES}        ${proxy} 1;
"
            ;;
    esac
done

TMP_FILE="${CONFIG_FILE}.agent.$$"
trap 'rm -f "$TMP_FILE"' EXIT HUP INT TERM
awk -v lines="$AGENT_PROXY_LINES" -v begin="$BEGIN_MARKER" -v end="$END_MARKER" '
    index($0, begin) { printf "%s", lines; skip = 1; next }
    index($0, end) { skip = 0; next }
    !skip { print }
' "$CONFIG_FILE" > "$TMP_FILE"
mv "$TMP_FILE" "$CONFIG_FILE"
trap - EXIT HUP INT TERM
