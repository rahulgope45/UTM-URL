#!/usr/bin/env bash
# Run the UTM attribution app locally.
#
#   ./start-local.sh            install deps if needed, seed demo data on first run, start the server
#   ./start-local.sh --seed     wipe the database and re-seed demo data before starting
#   ./start-local.sh --dev      restart automatically when files change
#   ./start-local.sh --port 4000
#
# Settings come from .env if it exists (see .env.example).
set -euo pipefail

cd "$(dirname "$0")"

RESEED=false
DEV=false
PORT_OVERRIDE=""

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed) RESEED=true ;;
    --dev) DEV=true ;;
    --port)
      [[ $# -ge 2 ]] || { echo "error: --port needs a value" >&2; exit 1; }
      PORT_OVERRIDE="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown option '$1'" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

# 1. Node.js 22.13+ (needed for the built-in node:sqlite)
if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js is not installed. Install Node.js 22.13 or newer: https://nodejs.org" >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  echo "error: Node.js 22.13+ required, found $(node --version)" >&2
  exit 1
fi

# 2. Settings: .env (optional), then command-line overrides
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
[[ -n "$PORT_OVERRIDE" ]] && export PORT="$PORT_OVERRIDE"
export PORT="${PORT:-3000}"
export DB_FILE="${DB_FILE:-data/utm.db}"

# 3. Dependencies: install when missing or when package-lock.json changed
if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
  echo "→ Installing dependencies..."
  npm ci --no-audit --no-fund
fi

# 4. Demo data: on first run, or when --seed is given
if [[ "$RESEED" == true || ! -f "$DB_FILE" ]]; then
  echo "→ Seeding demo data into $DB_FILE..."
  node scripts/seed.js
fi

# 5. Start (exec so Ctrl+C reaches the server directly)
echo "→ Starting on http://localhost:$PORT  (Ctrl+C to stop)"
if [[ "$DEV" == true ]]; then
  exec node --watch src/server.js
else
  exec node src/server.js
fi
