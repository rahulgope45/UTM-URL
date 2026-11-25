#!/usr/bin/env bash
# Interactive one-time configuration. Writes deploy/.env and deploy/auth.caddy.
#
#   ./setup.sh                 detect this server's public IP, ask a few questions
#   ./setup.sh --ip 1.2.3.4    use this IP instead of detecting it
#   ./setup.sh --local         use localhost hostnames (to test the stack on your own machine)
#   ./setup.sh --force         overwrite an existing .env
set -euo pipefail
cd "$(dirname "$0")"

IP=""
LOCAL=false
FORCE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ip) IP="${2:?--ip needs a value}"; shift ;;
    --local) LOCAL=true ;;
    --force) FORCE=true ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown option '$1'" >&2; exit 1 ;;
  esac
  shift
done

if [[ -f .env && "$FORCE" != true ]]; then
  echo "deploy/.env already exists. Use --force to recreate it (secrets will change)." >&2
  exit 1
fi
command -v docker >/dev/null || { echo "error: Docker is not installed (run bootstrap.sh)" >&2; exit 1; }

# --- Hostnames -------------------------------------------------------------
if [[ "$LOCAL" == true ]]; then
  APP_HOST=localhost
  KUTT_HOST=go.localhost
else
  if [[ -z "$IP" ]]; then
    # EC2 instance metadata (IMDSv2), falling back to an external lookup
    TOKEN=$(curl -fsS -m 2 -X PUT http://169.254.169.254/latest/api/token \
      -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null || true)
    if [[ -n "$TOKEN" ]]; then
      IP=$(curl -fsS -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" \
        http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
    fi
    [[ -n "$IP" ]] || IP=$(curl -fsS -m 5 https://checkip.amazonaws.com | tr -d '[:space:]')
  fi
  [[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: could not determine a public IPv4 address (got '$IP')" >&2; exit 1; }
  DASHED=${IP//./-}
  APP_HOST="app.${DASHED}.sslip.io"
  KUTT_HOST="go.${DASHED}.sslip.io"
  echo "Public IP: $IP"
  echo "  Make sure this is your Elastic IP. If it changes later, the URLs change too."
fi

# --- Questions ---------------------------------------------------------------
read -rp "Dashboard username [admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}
[[ "$ADMIN_USER" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "error: username may only contain letters, digits, . _ -" >&2; exit 1; }

read -rsp "Dashboard password (leave empty to generate one): " ADMIN_PASSWORD; echo
if [[ -z "$ADMIN_PASSWORD" ]]; then
  ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')
  GENERATED=true
else
  read -rsp "Repeat password: " CONFIRM; echo
  [[ "$ADMIN_PASSWORD" == "$CONFIRM" ]] || { echo "error: passwords do not match" >&2; exit 1; }
  [[ ${#ADMIN_PASSWORD} -ge 10 ]] || { echo "error: use at least 10 characters" >&2; exit 1; }
  GENERATED=false
fi

read -rp "Also run Kutt for short links? [Y/n]: " WANT_KUTT
read -rp "Load demo data (fake visits and sales)? [Y/n]: " WANT_SEED

# --- Write files -------------------------------------------------------------
echo "Hashing password..."
HASH=$(printf '%s' "$ADMIN_PASSWORD" | docker run --rm -i caddy:2 caddy hash-password 2>/dev/null | tail -n1)
[[ "$HASH" == \$2* ]] || { echo "error: could not hash the password with Caddy" >&2; exit 1; }

umask 077
cat > auth.caddy <<EOF
basic_auth @admin {
	${ADMIN_USER} ${HASH}
}
EOF

{
  echo "APP_HOST=${APP_HOST}"
  echo "KUTT_HOST=${KUTT_HOST}"
  [[ "${WANT_KUTT,,}" == n* ]] || echo "COMPOSE_PROFILES=kutt"
  echo "CONVERSION_SECRET=$(openssl rand -hex 32)"
  echo "ALLOWED_ORIGINS="
  echo "DEMO_STORE=true"
  echo "CURRENCY=INR"
  echo "LOOKBACK_DAYS=30"
  echo "KUTT_JWT_SECRET=$(openssl rand -hex 32)"
  if [[ "${WANT_KUTT,,}" == n* ]]; then
    echo "KUTT_URL="
  else
    echo "KUTT_URL=http://kutt:3000"
  fi
  echo "# Paste after creating it in Kutt (Settings -> API), then: docker compose up -d"
  echo "KUTT_API_KEY="
} > .env

[[ "${WANT_SEED,,}" == n* ]] || touch .seed-pending

echo
echo "Saved deploy/.env and deploy/auth.caddy (readable only by you)."
echo "  App:       https://${APP_HOST}"
[[ "${WANT_KUTT,,}" == n* ]] || echo "  Kutt:      https://${KUTT_HOST}"
echo "  Username:  ${ADMIN_USER}"
if [[ "$GENERATED" == true ]]; then
  echo "  Password:  ${ADMIN_PASSWORD}    <- save this now, it is not stored anywhere"
fi
