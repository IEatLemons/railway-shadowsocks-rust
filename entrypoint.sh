#!/bin/sh
set -eu

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

APP_ROLE="${APP_ROLE:-all}"
SERVICE_ROLE="${SERVICE_ROLE:-all}"
ADMIN_PORT="${ADMIN_PORT:-${PORT:-3000}}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
DATA_DIR="${DATA_DIR:-/data}"
SS_METHOD="${SS_METHOD:-aes-256-gcm}"
SS_PORT="${SS_PORT:-8388}"
SS_TIMEOUT="${SS_TIMEOUT:-300}"
SS_BIND_ADDRESS="${SS_BIND_ADDRESS:-::}"
SS_MODE="${SS_MODE:-tcp_only}"
SS_MANAGER_BIND_ADDRESS="${SS_MANAGER_BIND_ADDRESS:-::}"
SS_MANAGER_PORT="${SS_MANAGER_PORT:-6100}"
SS_MANAGER_HOST="${SS_MANAGER_HOST:-::1}"
PUBLIC_SS_HOST="${PUBLIC_SS_HOST:-}"
PUBLIC_SS_PORT="${PUBLIC_SS_PORT:-}"
SS_PASSWORD_CONFIGURED="${SS_PASSWORD_CONFIGURED:-true}"

case "${APP_ROLE}" in
  all) ;;
  node-agent)
    : "${ADMIN_BASE_URL:?ADMIN_BASE_URL is required}"
    : "${NODE_ID:?NODE_ID is required}"
    : "${NODE_TOKEN:?NODE_TOKEN is required}"
    SERVICE_ROLE="node-agent"
    ;;
  *)
    echo "APP_ROLE must be one of: all, node-agent" >&2
    exit 64
    ;;
esac

case "${SERVICE_ROLE}" in
  node|admin|all|node-agent) ;;
  *)
    echo "SERVICE_ROLE must be one of: node, admin, all" >&2
    exit 64
    ;;
esac

if [ "${SERVICE_ROLE}" = "node" ] || [ "${SERVICE_ROLE}" = "admin" ] || [ "${SERVICE_ROLE}" = "all" ]; then
  : "${SS_PASSWORD:?SS_PASSWORD is required}"
fi
if [ "${SERVICE_ROLE}" = "admin" ] || [ "${SERVICE_ROLE}" = "all" ]; then
  : "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required for SERVICE_ROLE=${SERVICE_ROLE}}"
fi

SS_PASSWORD_JSON="$(json_escape "${SS_PASSWORD:-}")"
SS_METHOD_JSON="$(json_escape "$SS_METHOD")"
SS_BIND_ADDRESS_JSON="$(json_escape "$SS_BIND_ADDRESS")"
SS_MODE_JSON="$(json_escape "$SS_MODE")"
SS_MANAGER_BIND_ADDRESS_JSON="$(json_escape "$SS_MANAGER_BIND_ADDRESS")"

if [ "${SERVICE_ROLE}" = "node" ] || [ "${SERVICE_ROLE}" = "all" ] || [ "${SERVICE_ROLE}" = "node-agent" ]; then
  mkdir -p /etc/shadowsocks-rust
  if [ "${SERVICE_ROLE}" = "node-agent" ]; then
    cat > /etc/shadowsocks-rust/config.json <<EOF
{
  "manager_address": "${SS_MANAGER_BIND_ADDRESS_JSON}",
  "manager_port": ${SS_MANAGER_PORT},
  "servers": []
}
EOF
  else
    cat > /etc/shadowsocks-rust/config.json <<EOF
{
  "manager_address": "${SS_MANAGER_BIND_ADDRESS_JSON}",
  "manager_port": ${SS_MANAGER_PORT},
  "servers": [
    {
      "server": "${SS_BIND_ADDRESS_JSON}",
      "server_port": ${SS_PORT},
      "password": "${SS_PASSWORD_JSON}",
      "timeout": ${SS_TIMEOUT},
      "method": "${SS_METHOD_JSON}",
      "mode": "${SS_MODE_JSON}"
    }
  ]
}
EOF
  fi
fi

if [ "${SERVICE_ROLE}" = "admin" ] || [ "${SERVICE_ROLE}" = "all" ]; then
  mkdir -p "${DATA_DIR}" || DATA_DIR="/tmp/railway-shadowsocks-admin"
  mkdir -p "${DATA_DIR}"
fi

shutdown() {
  echo "Stopping services"
  if [ -n "${ADMIN_PID:-}" ]; then
    kill "${ADMIN_PID}" 2>/dev/null || true
  fi
  if [ -n "${AGENT_PID:-}" ]; then
    kill "${AGENT_PID}" 2>/dev/null || true
  fi
  if [ -n "${HEALTH_PID:-}" ]; then
    kill "${HEALTH_PID}" 2>/dev/null || true
  fi
  if [ -n "${SSMANAGER_PID:-}" ]; then
    kill "${SSMANAGER_PID}" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap shutdown INT TERM

if [ "${SERVICE_ROLE}" = "node" ] || [ "${SERVICE_ROLE}" = "all" ] || [ "${SERVICE_ROLE}" = "node-agent" ]; then
  echo "Starting shadowsocks-rust manager on ${SS_MANAGER_BIND_ADDRESS}:${SS_MANAGER_PORT}; proxy port ${SS_PORT}/${SS_MODE}"
  ssmanager -c /etc/shadowsocks-rust/config.json &
  SSMANAGER_PID="$!"
fi

if [ "${SERVICE_ROLE}" = "node-agent" ]; then
  echo "Starting node agent for ${NODE_ID}"
  (
    cd /app/admin
    ADMIN_BASE_URL="${ADMIN_BASE_URL}" \
    AGENT_INTERVAL_MS="${AGENT_INTERVAL_MS:-15000}" \
    NODE_ID="${NODE_ID}" \
    NODE_TOKEN="${NODE_TOKEN}" \
    SS_BIND_ADDRESS="${SS_BIND_ADDRESS}" \
    SS_MANAGER_HOST="${SS_MANAGER_HOST}" \
    SS_MANAGER_PORT="${SS_MANAGER_PORT}" \
    SS_MANAGER_TIMEOUT_MS="${SS_MANAGER_TIMEOUT_MS:-2500}" \
    node --experimental-strip-types src/nodeAgent.ts
  ) &
  AGENT_PID="$!"
fi

if [ "${SERVICE_ROLE}" = "admin" ] || [ "${SERVICE_ROLE}" = "all" ]; then
  echo "Starting admin web on 0.0.0.0:${ADMIN_PORT}"
  (
    cd /app/admin
    ADMIN_USERNAME="${ADMIN_USERNAME}" \
    ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    DATA_DIR="${DATA_DIR}" \
    DATABASE_URL="${DATABASE_URL:-}" \
    NODE_ENV=production \
    PORT="${ADMIN_PORT}" \
    PUBLIC_SS_HOST="${PUBLIC_SS_HOST}" \
    PUBLIC_SS_PORT="${PUBLIC_SS_PORT}" \
    SS_PASSWORD="${SS_PASSWORD}" \
    SS_MANAGER_HOST="${SS_MANAGER_HOST}" \
    SS_MANAGER_PORT="${SS_MANAGER_PORT}" \
    SS_METHOD="${SS_METHOD}" \
    SS_PASSWORD_CONFIGURED="${SS_PASSWORD_CONFIGURED}" \
    SS_PORT="${SS_PORT}" \
    SS_TIMEOUT="${SS_TIMEOUT}" \
    node --experimental-strip-types src/server.ts
  ) &
  ADMIN_PID="$!"
fi

if [ "${SERVICE_ROLE}" = "node" ]; then
  echo "Starting node health endpoint on 0.0.0.0:${PORT:-3000}"
  PORT="${PORT:-3000}" node /app/node-health.mjs &
  HEALTH_PID="$!"
fi

echo "Service role: ${SERVICE_ROLE}"

while :; do
  if [ -n "${SSMANAGER_PID:-}" ] && ! kill -0 "${SSMANAGER_PID}" 2>/dev/null; then
    echo "ssmanager exited"
    shutdown
    status=0
    wait "${SSMANAGER_PID}" || status="$?"
    exit "${status}"
  fi

  if [ -n "${ADMIN_PID:-}" ] && ! kill -0 "${ADMIN_PID}" 2>/dev/null; then
    echo "admin web exited"
    shutdown
    status=0
    wait "${ADMIN_PID}" || status="$?"
    exit "${status}"
  fi

  if [ -n "${AGENT_PID:-}" ] && ! kill -0 "${AGENT_PID}" 2>/dev/null; then
    echo "node agent exited"
    shutdown
    status=0
    wait "${AGENT_PID}" || status="$?"
    exit "${status}"
  fi

  if [ -n "${HEALTH_PID:-}" ] && ! kill -0 "${HEALTH_PID}" 2>/dev/null; then
    echo "node health endpoint exited"
    shutdown
    status=0
    wait "${HEALTH_PID}" || status="$?"
    exit "${status}"
  fi

  sleep 2
done
