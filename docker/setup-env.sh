#!/usr/bin/env bash
set -e

ENV_FILE="/app/.env"

ask_default() {
  local prompt="$1"
  local default="$2"
  local value
  read -r -p "$prompt [$default]: " value
  echo "${value:-$default}"
}

ask_yes_no() {
  local prompt="$1"
  local default="${2:-Y}"
  local answer
  read -r -p "$prompt [$default/n]: " answer
  answer="${answer:-$default}"

  case "$answer" in
    Y|y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

echo ""
echo "======================================"
echo " Hyperliquid Grid Bot - Docker Setup "
echo "======================================"
echo ""

API_PORT=$(ask_default "Dashboard/API port" "3000")
DB_PORT=$(ask_default "Postgres port" "5432")
DB_NAME=$(ask_default "Database name" "botgrid")
DB_USER=$(ask_default "Database user" "postgres")
DB_PASS=$(ask_default "Database password" "postgres")

BOT_TZ=$(ask_default "Bot timezone" "America/Edmonton")
HYPERLIQUID_TESTNET=$(ask_default "Use Hyperliquid testnet? 1=yes, 0=no" "0")

HEALTHCHECKS_PING_URL=""
HEALTHCHECKS_PING_INTERVAL_MS="0"
WALLET_ADDRESS=""
PRIVATE_KEY=""
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""

if ask_yes_no "Do you want to setup Hyperliquid wallet and secret now?" "Y"; then
  read -r -p "Wallet address: " WALLET_ADDRESS
  read -r -p "Private key: " PRIVATE_KEY
fi

if ask_yes_no "Do you want to setup Telegram now?" "Y"; then
  read -r -p "Telegram bot token: " TELEGRAM_BOT_TOKEN
  read -r -p "Telegram chat id: " TELEGRAM_CHAT_ID
fi

if ask_yes_no "Do you want to setup Healthchecks.io now?" "Y"; then
  read -r -p "Healthchecks ping URL: " HEALTHCHECKS_PING_URL
  HEALTHCHECKS_PING_INTERVAL_MS=$(ask_default "Healthchecks ping interval ms" "60000")
fi

cat > "$ENV_FILE" <<EOF
API_HOST=0.0.0.0
API_PORT=$API_PORT

API_ENV=local
API_URL_LOCAL=http://127.0.0.1:$API_PORT/api/
API_URL_AWS=

DB_HOST=127.0.0.1
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DB_SSL=false

FEE_RATE_MAKER_PER_SIDE=0.000384
FEE_RATE_TAKER_PER_SIDE=0.000672

HEALTHCHECKS_PING_URL=$HEALTHCHECKS_PING_URL
HEALTHCHECKS_PING_INTERVAL_MS=$HEALTHCHECKS_PING_INTERVAL_MS

WALLET_ADDRESS=$WALLET_ADDRESS
PRIVATE_KEY=$PRIVATE_KEY

GRID_ORDERS_WINDOW_DEFAULT=70
GRID_ORDERS_WINDOW_CLEANUP=100

BLOCK_USD_BUFFER=50
BLOCK_BASE_BUFFER=0.001

DEFAULT_RESERVE_QUOTE_OFFSET_PERCENT=30
DEFAULT_RESERVE_BASE_OFFSET_PERCENT=30

TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID

BOT_TZ=$BOT_TZ
HYPERLIQUID_TESTNET=$HYPERLIQUID_TESTNET
EOF

echo ""
echo ".env created successfully at /app/.env"
