# README — How to Setup (Local)

This guide gets the project running locally with **PostgreSQL**, the **Dashboard UI**, and the **PM2-controlled bot**.

---

## 1) Install PostgreSQL

Install PostgreSQL (**v13+ recommended**) and make sure the service is running.

- **Windows:** ensure the **PostgreSQL** service is started
- **macOS:**
  ```bash
  brew services start postgresql
  ```
- **Linux:** use your distro service manager (systemd, etc.)

---

## 2) Create your `.env`

Copy `.env.example` to `.env` in the project root.

### Wallet + Secret Key (Important)

Create your Hyperliquid account (referral):
- https://app.hyperliquid.xyz/join/BOTGRID  
Use the **BOTGRID** referral to get fee discounts.

#### Local (single account) setup
For local usage, you can keep credentials in `.env`:

```bash
WALLET_ADDRESS=your_wallet_address
SECRET_KEY=your_secret_key
```

If these env vars are set, the bot can run **without** requiring `wallet_address` / `private_key` to be filled in the database (useful for keeping secrets local).

#### Multi-account setup
For multi-account setups, use the `trade_instance` table to store:
- `wallet_address`
- `private_key`

---

## 3) Install dependencies

```bash
npm install
```

---

## 4) Create Db and seed

Creates the schema using `db/db.sql`.

```bash
npm run db:setup
```

---

## 5) Start the API server

```bash
npm run api
```

Open the Dashboard:

- http://127.0.0.1:3000/dashboard

---

## 6) Configure the bot in the Dashboard

### 6.1 Update your config
In the **Config** section, adjust your parameters (example):
- Pair (e.g., `BTC/USDC`)
- Entry price / Exit price
- Target percent
- Margin percent
- USD per order
- Decimal precision

### 6.2 Simulate (recommended)
Use **Simulate** to preview how many levels will be generated, capital estimates, and profit estimates.

Example output you may see:

```
GRID SUMMARY (BTC/USDC)
Range: 62000 → 102000
Levels (orders): 481
Per order: $99.00 | Profit target per level: 1.8% | Grid spacing: 0.1%

CAPITAL NEEDED (ESTIMATE)
Current price: 66828.50
If price goes UP: need ~0.520060 (≈ $34754.83)
If price goes DOWN: need ~$5742.00

POTENTIAL UPSIDE (IF IT REACHES THE TOP)
If you buy the required amount now and price reaches 102000:
- Buy cost today: $34754.83
- Value at 102000: $53046.12
- Potential gain: $18291.29

PER-TRADE PROFIT (ESTIMATE)
Gross profit per completed cycle: $1.78
Estimated fees per cycle: $0.15
Estimated net profit per operation: $1.63
Total estimated capital required: $40496.83
```

### 6.3 Generate the grid
If the simulation looks correct, click **Generate Grid**.

This will create the grid rows in the database (trade orders / levels) for the selected config.

---

## 7) Start / Stop the bot (Dashboard)

The Dashboard provides **Start** and **Stop** buttons for your instance.  
Under the hood, it uses **PM2** to run the bot process (so it survives crashes and can be controlled cleanly).

### Verify status from terminal (optional)

```bash
npx pm2 status
```

View logs:

```bash
npx pm2 logs gridbot-1 --lines 200
npx pm2 logs gridbot-1 --err --lines 200
```

> Process naming pattern: `gridbot-<instanceId>` (example: `gridbot-1`).

---

## Optional: CLI commands (keep for terminal usage)

You can still run bot actions directly from terminal if you prefer.

### Start the bot (foreground)
```bash
npm run start -- 1
```

### List open orders for a pair
```bash
npm run openOrders -- 1 BTC/USDC
```

### Cancel open orders for a pair
```bash
npm run cancelOrders -- 1 BTC/USDC
```

---

## Telegram

For notifications and commands, read:

- `README_TELEGRAM.md`

---

## Troubleshooting

### “password authentication failed”
- Double-check `DB_USER` / `DB_PASS`
- Confirm Postgres is running

### “database does not exist”
Run:
```bash
npm run db:create
```

### Re-run seed
Seeding is idempotent (won’t duplicate). You can re-run:
```bash
npm run db:seed
```

### PM2 shows nothing running
If you started via Dashboard but PM2 shows nothing:
- Check your API logs
- Confirm the Start button is calling the correct POST route
- Try:
  ```bash
  npx pm2 status
  npx pm2 logs --err --lines 200
  ```

### Bot starts but immediately stops / restarts
Check error logs:
```bash
npx pm2 logs gridbot-1 --err --lines 200
```
Most common causes:
- missing env vars (wallet/keys)
- wrong DB config