#!/bin/sh
set -eu

: "${SS_PASSWORD:?SS_PASSWORD is required}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

ADMIN_PORT="${ADMIN_PORT:-3000}"
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

SS_PASSWORD_JSON="$(json_escape "$SS_PASSWORD")"
SS_METHOD_JSON="$(json_escape "$SS_METHOD")"
SS_BIND_ADDRESS_JSON="$(json_escape "$SS_BIND_ADDRESS")"
SS_MODE_JSON="$(json_escape "$SS_MODE")"
SS_MANAGER_BIND_ADDRESS_JSON="$(json_escape "$SS_MANAGER_BIND_ADDRESS")"

mkdir -p /etc/shadowsocks-rust
mkdir -p "${DATA_DIR}" || DATA_DIR="/tmp/railway-shadowsocks-admin"
mkdir -p "${DATA_DIR}"

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

shutdown() {
  echo "Stopping services"
  if [ -n "${ADMIN_PID:-}" ]; then
    kill "${ADMIN_PID}" 2>/dev/null || true
  fi
  if [ -n "${SSMANAGER_PID:-}" ]; then
    kill "${SSMANAGER_PID}" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap shutdown INT TERM

echo "Starting shadowsocks-rust manager on ${SS_MANAGER_BIND_ADDRESS}:${SS_MANAGER_PORT}; proxy port ${SS_PORT}/${SS_MODE}"
ssmanager -c /etc/shadowsocks-rust/config.json &
SSMANAGER_PID="$!"

echo "Starting admin web on 0.0.0.0:${ADMIN_PORT}"
(
  cd /app/admin
  ADMIN_USERNAME="${ADMIN_USERNAME}" \
  ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  DATA_DIR="${DATA_DIR}" \
  NODE_ENV=production \
  PORT="${ADMIN_PORT}" \
  PUBLIC_SS_HOST="${PUBLIC_SS_HOST}" \
  PUBLIC_SS_PORT="${PUBLIC_SS_PORT}" \
  SS_MANAGER_HOST="${SS_MANAGER_HOST}" \
  SS_MANAGER_PORT="${SS_MANAGER_PORT}" \
  SS_METHOD="${SS_METHOD}" \
  SS_PASSWORD_CONFIGURED="${SS_PASSWORD_CONFIGURED}" \
  SS_PORT="${SS_PORT}" \
  SS_TIMEOUT="${SS_TIMEOUT}" \
  node --experimental-strip-types src/server.ts
) &
ADMIN_PID="$!"

while :; do
  if ! kill -0 "${SSMANAGER_PID}" 2>/dev/null; then
    echo "ssmanager exited"
    shutdown
    status=0
    wait "${SSMANAGER_PID}" || status="$?"
    exit "${status}"
  fi

  if ! kill -0 "${ADMIN_PID}" 2>/dev/null; then
    echo "admin web exited"
    shutdown
    status=0
    wait "${ADMIN_PID}" || status="$?"
    exit "${status}"
  fi

  sleep 2
done
