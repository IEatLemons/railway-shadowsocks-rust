#!/bin/sh
set -eu

: "${SS_PASSWORD:?SS_PASSWORD is required}"

SS_METHOD="${SS_METHOD:-aes-256-gcm}"
SS_PORT="${SS_PORT:-8388}"
SS_TIMEOUT="${SS_TIMEOUT:-300}"

mkdir -p /etc/shadowsocks-rust

cat > /etc/shadowsocks-rust/config.json <<EOF
{
  "server": "0.0.0.0",
  "server_port": ${SS_PORT},
  "password": "${SS_PASSWORD}",
  "timeout": ${SS_TIMEOUT},
  "method": "${SS_METHOD}"
}
EOF

exec ssserver -c /etc/shadowsocks-rust/config.json
