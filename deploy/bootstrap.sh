#!/usr/bin/env bash
# Install / update and start the stack on a fresh Ubuntu server. Safe to re-run.
#
#   git clone https://github.com/rahulgope45/UTM-URL.git && cd UTM-URL
#   sudo ./deploy/bootstrap.sh
#
# To update later:  git pull && sudo ./deploy/bootstrap.sh
set -euo pipefail
cd "$(dirname "$0")"

[[ $EUID -eq 0 ]] || { echo "error: run with sudo" >&2; exit 1; }
if ! docker info >/dev/null 2>&1 && command -v docker >/dev/null; then
  echo "error: Docker is installed but not usable as root (docker info failed)." >&2
  echo "       This script is meant for the EC2 server. Are you on your own computer?" >&2
  exit 1
fi

# 1. Docker (official convenience script; includes the compose plugin)
if ! command -v docker >/dev/null; then
  echo "→ Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  # let the normal login user run docker without sudo (takes effect on next login)
  [[ -n "${SUDO_USER:-}" ]] && usermod -aG docker "$SUDO_USER"
fi

# 2. Swap on small instances, so image builds don't run out of memory
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ $MEM_MB -lt 2500 ]] && ! swapon --show | grep -q .; then
  echo "→ Adding 2 GB swap (RAM: ${MEM_MB} MB)..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# 3. Configuration (first run only)
if [[ ! -f .env ]]; then
  ./setup.sh
  # the files belong to the user who ran sudo, not root
  [[ -n "${SUDO_USER:-}" ]] && chown "$SUDO_USER": .env auth.caddy && { [[ -f .seed-pending ]] && chown "$SUDO_USER": .seed-pending || true; }
fi

# 4. Build and start
echo "→ Building and starting containers (first time takes a few minutes)..."
docker compose up -d --build --remove-orphans
# Caddy reads Caddyfile/auth.caddy only at start, and git pull replaces those files,
# so restart it to apply any changes (a second or two of downtime).
docker compose restart caddy

# 5. Wait for the app to become healthy
echo -n "→ Waiting for the app"
for _ in $(seq 1 30); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 2
done

# 6. Demo data (only if chosen during setup, only once)
if [[ -f .seed-pending ]]; then
  echo "→ Loading demo data..."
  docker compose exec -T app node scripts/seed.js
  rm -f .seed-pending
fi

# shellcheck disable=SC1091
. ./.env
echo
echo "Done. Certificates can take up to a minute on first start."
echo "  Dashboard:   https://${APP_HOST}/dashboard/   (password protected)"
echo "  Demo store:  https://${APP_HOST}/store/"
if [[ "${COMPOSE_PROFILES:-}" == *kutt* ]]; then
  echo "  Kutt:        https://${KUTT_HOST}"
  if [[ -z "${KUTT_API_KEY:-}" ]]; then
    echo
    echo "  Next: open Kutt NOW and create the admin account (the first visitor becomes admin),"
    echo "  then Settings -> API -> create key, put it in deploy/.env as KUTT_API_KEY,"
    echo "  and run: sudo ./deploy/bootstrap.sh"
  fi
fi
echo
echo "Logs:   cd $(pwd) && docker compose logs -f"
