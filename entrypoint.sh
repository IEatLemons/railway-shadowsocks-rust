#!/bin/sh
set -eu

: "${SS_PASSWORD:?SS_PASSWORD is required}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

SS_METHOD="${SS_METHOD:-aes-256-gcm}"
SS_PORT="${SS_PORT:-8388}"
SS_TIMEOUT="${SS_TIMEOUT:-300}"
SS_BIND_ADDRESS="${SS_BIND_ADDRESS:-::}"
SS_MODE="${SS_MODE:-tcp_only}"
SS_MANAGER_BIND_ADDRESS="${SS_MANAGER_BIND_ADDRESS:-::}"
SS_MANAGER_PORT="${SS_MANAGER_PORT:-6100}"

SS_PASSWORD_JSON="$(json_escape "$SS_PASSWORD")"
SS_METHOD_JSON="$(json_escape "$SS_METHOD")"
SS_BIND_ADDRESS_JSON="$(json_escape "$SS_BIND_ADDRESS")"
SS_MODE_JSON="$(json_escape "$SS_MODE")"
SS_MANAGER_BIND_ADDRESS_JSON="$(json_escape "$SS_MANAGER_BIND_ADDRESS")"

mkdir -p /etc/shadowsocks-rust

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

echo "Starting shadowsocks-rust manager on ${SS_MANAGER_BIND_ADDRESS}:${SS_MANAGER_PORT}; proxy port ${SS_PORT}/${SS_MODE}"

exec ssmanager -c /etc/shadowsocks-rust/config.json
