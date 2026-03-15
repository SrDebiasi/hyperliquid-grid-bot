# Running with Docker

No coding knowledge required. Just follow the steps below in order.

---

## Prerequisites

Install **Docker Desktop** and make sure it is running before you begin.

- [Download Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## Step 1 — Download the project

Clone or download this repository to your computer and open a terminal in that folder.

---

## Step 2 — Start the bot

```bash
docker compose up -d
```

That's it. The first time this runs it will build the image (takes a few minutes). After that it starts instantly.

Open the dashboard in your browser: **http://localhost:3000/dashboard**

Configure your wallet, API keys, and other settings directly from the dashboard.

---

## Daily use

**Stop the bot:**
```bash
docker compose down
```

**Start it again:**
```bash
docker compose up -d
```

> After a restart, the trading bot process will not auto-resume. Open the dashboard and click **Start bot** to resume trading.

---

## View logs

**Live container logs (API startup, errors):**
```bash
docker compose logs -f
```

**PostgreSQL logs:**
```bash
docker compose exec bot cat /app/logs/postgres.log
```

**Trading bot logs (PM2):**
```bash
docker compose exec bot npx pm2 logs gridbot-api
```

Press `Ctrl+C` to stop following logs.

---

## Update to a new version

```bash
docker compose down
git pull
docker compose build
docker compose up -d
```

Your database and settings are preserved — no need to reconfigure.

---

## Expose PostgreSQL to your computer (optional)

If you want to connect to the database from a tool like pgAdmin or DBeaver, edit `docker compose.yml` and add a port mapping under `ports`:

```yaml
ports:
  - "3000:3000"
  - "5432:5432"
```

Then restart with `docker compose up -d`.
