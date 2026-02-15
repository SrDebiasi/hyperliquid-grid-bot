# First Setup (Local)
This is the quickest way to get the project running locally.
## 1) Install PostgreSQL
Install PostgreSQL (v13+ recommended) and make sure the service is running.
- Windows: ensure the “PostgreSQL” service is started
- macOS:
```bash
brew services start postgresql
```
- Linux: use your distro service manager
## 2) Create your .env
Copy `.env` from `.env.example` file in the project root:
### Wallet + Secret Key (Important)
For local usage, you can keep credentials in `.env`.
For multi-account setups, use the `trade_instance` table.
If you only want to run one account locally, set:
```bash
WALLET_ADDRESS=your_wallet_address
SECRET_KEY=your_secret_key
```
If these env vars are set, the bot can run without requiring `wallet_address` / `private_key` to be filled in the database (useful for keeping secrets local).
## 3) Install dependencies
```bash
npm install
```
## 4) Create DB schema (runs db/db.sql)
```bash
npm run db:create
```
## 5) Seed initial data (trade_instance + trade_config defaults)
```bash
npm run db:seed
```
This inserts a basic default config (BTC/USDC) that you can adjust later directly in the database.
## 6) Create the grid range (required)
Before starting the API, you need to generate the grid levels for your pair.
Run a dry-run first (does NOT save anything):
```bash
npm run create 1 BTC/USDC no
```
This will print an estimate (BTC needed, USD needed, records generated). Example:
```bash
13:55:00 - Finished BTC/USDC working between 60000 and 100000
13:55:00 - Total 494 records | target=1.8% | spacing=0.1% | usd_per_order=50
13:55:00 - Current BTC price 69973.5 | base_needed=0.218280 | base_value_usd=15273.82
13:55:00 - Quote needed for downtrend: 6850.00 USD
13:55:00 - Profit if buying required amount today and selling at exit (100000): 6554.18 USD
13:55:00 -  - Buy value today: 15273.82 USD
13:55:00 -  - Sell value at range top: 21828.00 USD
13:55:00 - Gross profit per operation: 0.90 USD
13:55:00 - Estimated fees per operation: 0.07 USD
13:55:00 - Estimated net profit per operation: 0.83 USD
13:55:00 - Estimated total USD needed: 22123.82
```

If you are OK with the estimate, re-run with YES to persist the generated rows into the database:
```bash
npm run create 1 BTC/USDC yes
```
### Adjusting the range
The default seeded config currently uses:
- entry_price = 60000
- exit_price = 100000
  You can adjust `entry_price` / `exit_price` (and other parameters) in the `trade_config` table, then re-run create again.
## 7) Start the server API
```bash
npm run api
```
## 8) Start the bot
```bash
npm run start
```
## Troubleshooting
### “password authentication failed”
Double-check DB_USER/DB_PASS and that Postgres is running.
### “database does not exist”
Run:
```bash
npm run db:create
```
### Rerun seed
Seeding is idempotent (won’t duplicate). You can re-run:
```bash
npm run db:seed
```
