#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Deploy one role to an existing Railway service.

Usage:
  ./scripts/deploy.sh <node|admin|all> --service <service> [options]

Roles:
  node   Shadowsocks node plus an HTTP health endpoint
  admin  Admin/control-plane web service only
  all    Node and admin in one container (backward-compatible default)

Options:
  -s, --service NAME       Railway service name (or RAILWAY_SERVICE)
  -e, --environment NAME   Railway environment name
      --detach             Return after uploading instead of following logs
      --dry-run            Print commands without changing Railway
  -h, --help               Show this help

Examples:
  ./scripts/deploy.sh node --service ss-node
  ./scripts/deploy.sh admin --service ss-admin --environment production
EOF
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 64
fi

role="$1"
shift

case "$role" in
  node|admin|all) ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown role: $role" >&2
    usage >&2
    exit 64
    ;;
esac

service="${RAILWAY_SERVICE:-}"
environment=""
detach=false
dry_run=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--service)
      [[ $# -ge 2 ]] || { echo "$1 requires a value" >&2; exit 64; }
      service="$2"
      shift 2
      ;;
    -e|--environment)
      [[ $# -ge 2 ]] || { echo "$1 requires a value" >&2; exit 64; }
      environment="$2"
      shift 2
      ;;
    --detach)
      detach=true
      shift
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

if [[ -z "$service" ]]; then
  echo "Railway service is required; pass --service or set RAILWAY_SERVICE." >&2
  exit 64
fi

if ! $dry_run && ! command -v railway >/dev/null 2>&1; then
  echo "Railway CLI is not installed or is not on PATH." >&2
  echo "Install it, log in, and link this directory to a Railway project first." >&2
  exit 127
fi

railway_scope=(--service "$service")
if [[ -n "$environment" ]]; then
  railway_scope+=(--environment "$environment")
fi

variables_cmd=(railway variable set "SERVICE_ROLE=$role" "${railway_scope[@]}" --skip-deploys)
deploy_cmd=(railway up "${railway_scope[@]}")
if $detach; then
  deploy_cmd+=(--detach)
fi

print_command() {
  printf '%q ' "$@"
  printf '\n'
}

echo "Deploy target: role=$role service=$service${environment:+ environment=$environment}"

if $dry_run; then
  print_command "${variables_cmd[@]}"
  print_command "${deploy_cmd[@]}"
  exit 0
fi

"${variables_cmd[@]}"
"${deploy_cmd[@]}"
