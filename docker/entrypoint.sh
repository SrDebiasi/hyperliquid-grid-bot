#!/usr/bin/env bash
set -e

cd /app

export PGDATA=/app/data/postgres
export PM2_HOME=/app/.pm2

if [ ! -f /app/.env ]; then
  echo "No .env found. Running first-time setup..."
  /app/docker/setup-env.sh
fi

set -a
. /app/.env
set +a

mkdir -p "$PGDATA" /app/logs "$PM2_HOME"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "Initializing PostgreSQL data directory..."
  chown -R postgres:postgres "$PGDATA"
  su - postgres -c "/usr/lib/postgresql/16/bin/initdb -D '$PGDATA'"
fi

echo "Starting PostgreSQL..."
chown -R postgres:postgres "$PGDATA"
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

echo "Starting API with PM2..."
exec pm2-runtime start ecosystem.config.cjs
