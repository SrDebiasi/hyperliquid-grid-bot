#!/usr/bin/env bash
set -e

cd /app

echo "Checking for latest code..."
git config --global --add safe.directory /app
git pull || echo "Warning: git pull failed, continuing with current code..."

echo "Installing dependencies..."
npm install --silent

export PGDATA=/app/data/postgres
export PM2_HOME=/app/.pm2

if [ ! -f /app/.env ]; then
  echo "No .env found. Generating default config..."
  cat > /app/.env <<EOF
API_HOST=0.0.0.0
API_PORT=3000

API_ENV=local
API_URL_LOCAL=http://127.0.0.1:3000/api/
API_URL_AWS=

DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=botgrid
DB_USER=postgres
DB_PASS=postgres
DB_SSL=false

FEE_RATE_MAKER_PER_SIDE=0.000384
FEE_RATE_TAKER_PER_SIDE=0.000672

HEALTHCHECKS_PING_URL=
HEALTHCHECKS_PING_INTERVAL_MS=0

WALLET_ADDRESS=
PRIVATE_KEY=

GRID_ORDERS_WINDOW_DEFAULT=70
GRID_ORDERS_WINDOW_CLEANUP=100

BLOCK_USD_BUFFER=50
BLOCK_BASE_BUFFER=0.001

DEFAULT_RESERVE_QUOTE_OFFSET_PERCENT=30
DEFAULT_RESERVE_BASE_OFFSET_PERCENT=30

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

BOT_TZ=America/Edmonton
HYPERLIQUID_TESTNET=0
EOF
  echo ".env created with defaults. Configure your wallet and settings via the dashboard."
fi

set -a
. /app/.env
set +a

mkdir -p "$PGDATA" /app/logs "$PM2_HOME"
chown -R postgres:postgres "$PGDATA" /app/logs

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Initializing PostgreSQL data directory..."
  su - postgres -c "/usr/lib/postgresql/16/bin/initdb -D '$PGDATA'"
fi

echo "Starting PostgreSQL..."
su - postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D '$PGDATA' -l /app/logs/postgres.log -o \"-p ${DB_PORT:-5432}\" start"

echo "Waiting for PostgreSQL..."
until su - postgres -c "/usr/lib/postgresql/16/bin/pg_isready -h 127.0.0.1 -p ${DB_PORT:-5432}" >/dev/null 2>&1; do
  sleep 1
done

echo "Ensuring postgres user password..."
su - postgres -c "psql -p ${DB_PORT:-5432} -d postgres -c \"ALTER USER ${DB_USER:-postgres} WITH PASSWORD '${DB_PASS:-postgres}';\"" || true

echo "Running DB setup..."
node scripts/db_create.js
node scripts/db_seed.js

echo "Running migrations..."
node scripts/migrate.js

echo "Starting API with PM2..."
exec pm2-runtime start ecosystem.config.cjs
