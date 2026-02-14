# Grid Trading Bot

## Overview

This Grid Trading Bot is designed to generate passive income from market volatility while operating strictly within a defined price range.

Instead of predicting direction, the bot:

- Works inside a configurable price range
- Buys low and sells high repeatedly
- Accumulates more BTC (or base asset) over time
- Generates realized profit per completed cycle
- Avoids leverage (no liquidation risk)
- Can operate continuously in ranging markets

The idea is simple but powerful: **volatility becomes income**.

------------------------------------------------------------------------

## Real Backtest Performance (BTC Grid Example)

To demonstrate the effectiveness of this strategy, here is a real backtest using BTC:

**Period:** 2025-11-01 → 2026-02-02 (93 days)  
**Grid Levels:** 614  
**Base USD per level:** $100  
**Total Value Locked (BTC + USD):** $61,400

### Results

- Total Cycles Completed: 1,254
- Total Profit: **$2,121.83**
- Return on Total Capital: **3.46%**
- Average Profit per Cycle: $1.69
- Fee rate per side: 0.0384%

### Performance Breakdown

- Per day:   **$22.81** (0.04%)
- Per week:  **$159.64** (0.26%)
- Per month: **$684.16** (1.11%)
- Per year:  **$8,323.96** (13.56%)

---

### Why This Is Powerful

- 13.56% yearly return without leverage
- No liquidation risk
- Capital always inside a controlled price range
- Profit generated purely from volatility
- Scales linearly with capital

The bot does not need trend prediction.  
It simply monetizes market movement.

------------------------------------------------------------------------

## Why This Strategy Is Strong

1. No Stop-Loss Required - The bot operates inside a predefined range. It does not rely on stop-loss mechanisms to function.

2. No Liquidation Risk - The strategy is spot-based (or non-liquidated environment). There is no leverage exposure.

3. Profits From Volatility - Sideways markets are ideal. Every oscillation between grid levels produces income.

4. BTC Accumulation - When configured with rebuy logic, realized profits can be reinvested automatically, increasing long-term BTC exposure.

5. Passive Structure - After setup, the bot runs automatically: - Places limit orders - Detects fills - Reverses side - Tracks profits - Manages capital allocation

------------------------------------------------------------------------

## How The Bot Works (Concept Explained)

The bot creates multiple micro price ranges inside a larger defined range.

Each micro range generates a fixed profit target.

Instead of predicting direction, the bot waits for price oscillation.

Every time price moves up and down inside the grid, it earns a fixed percentage.

--------------------------------------------------

Step-by-Step Logic

1) You define a price range:

- entry_price (bottom)
- exit_price (top)

2) The bot divides this range into multiple grid levels.

3) For each level:

- It places a BUY order at a lower price.
- It places a SELL order above it (target_percent higher).

4) When BUY is filled:
   → It immediately places the SELL above.

5) When SELL is filled:
   → Profit is realized. → A new BUY is placed below. → The cycle continues.

(It may also operate as SELL → BUY if you start while already holding the asset and the price is in the middle of the range.)

The important point is that profit is only realized and accounted for when a full cycle is completed:

BUY → SELL  
or  
SELL → BUY

A partial movement does not count as profit. Only when the cycle closes is the gain officially recorded.

--------------------------------------------------

Example (Simple BTC Scenario)

Imagine:

- BTC price = 60,000
- target_percent = 1.8%
- usd_transaction = 100 USDC

Bot places:

BUY at 60,000 SELL at 61,080  (1.8% profit)

If price moves:

60,000 → 61,080

The SELL fills.

Profit ≈ 1.8 USDC (minus fees).

Then the bot places:

New BUY at 60,000 (or next grid level)

If price oscillates:

60,000 ↔ 61,080 ↔ 60,000 ↔ 61,080

The bot earns 1.8% repeatedly.

--------------------------------------------------

Why This Works

Markets often move sideways.

Instead of waiting for a huge breakout, the bot monetizes small movements.

Volatility becomes income.

--------------------------------------------------

What Happens in a Downtrend?

If price drops:

The bot keeps buying lower grid levels.

No liquidation risk (spot-based). You accumulate BTC.

When price eventually rebounds, the SELL levels above start filling again.

--------------------------------------------------

What Happens in a Strong Uptrend?

If price moves above your exit_price:

The bot stops creating new grid levels. You hold accumulated BTC.

You can then:

- Adjust the range upward.
- Or restart the grid higher.

--------------------------------------------------

Core Idea

This bot does NOT try to predict direction.

It harvests volatility.

Every oscillation inside your range generates income.

The more healthy sideways movement, the more consistent the returns.

------------------------------------------------------------------------

## Capital Protection

### Order Block System

The bot can place a reserve BUY limit to "block" free USDC and prevent over-allocation.

### Cleanup Logic

Old grid levels far from price are periodically cleaned to:

- Reduce open orders
- Improve efficiency
- Prevent unnecessary capital exposure

------------------------------------------------------------------------

## Rebuy Logic

When enabled:

- Profit accumulates in a rebuy wallet
- Once threshold is reached
- A MARKET BUY is executed
- BTC accumulation increases
- Stats are persisted

This compounds volatility into long-term asset growth.

------------------------------------------------------------------------

## Exchange Adapter

The bot is exchange-agnostic.

Current supported:

- Hyperliquid

Adapter responsibilities:

- placeOrder()
- cancelOrder()
- getOrder()
- getOpenOrders()
- getPrices()
- subscribeAggTrades()
- getAccountInfo()

The engine does not depend on exchange-specific logic.

------------------------------------------------------------------------

## Websocket Logic

subscribeAggTrades()

- Updates price cache
- Monitors min/max active range
- Triggers fast execution when price exits boundary

This allows reactive execution without constant polling.

------------------------------------------------------------------------

## Environment Variables

Check .env.example

------------------------------------------------------------------------

## Main CLI Commands

Start api:

    npm run api

Create grid:

    npm run create -- <pair> <instanceId> true

Start bot:

    npm run start -- <instanceId>

------------------------------------------------------------------------

## Hyperliquid Setup (API Wallet + Keys)

This bot uses Hyperliquid "API Wallet" credentials (agent wallet).

Important:

- `wallet_address` must be your MAIN / linked account address on Hyperliquid (the one that actually holds funds).
- `private_key` must be the API Wallet PRIVATE KEY generated on Hyperliquid (agent wallet private key).
- Do NOT use the API wallet address as `wallet_address`.

### Generate Hyperliquid API Wallet Private Key

1) Log in to Hyperliquid.
2) Open the API page:
   https://app.hyperliquid.xyz/API
3) Create a new API Wallet:

- Enter a name
- Click Generate
- Click "Authorize API Wallet" (do not skip authorization)

4) Copy the Private Key shown (this is what you store as `private_key` in the bot).
5) Copy your MAIN account address (top-right account dropdown / wallet shown in UI). That is what you store as `wallet_address` in the bot.

Notes:

- Some setups require you to deposit funds before you can authorize an API wallet.
- Treat the API wallet private key like a password.
- NEVER SHARE IT WITH ANYONE.
- If someone gets access to your API wallet private key:
  • They cannot withdraw your funds. • BUT they can place trades. • They can intentionally execute bad trades and destroy your balance.

If you believe your private key has been exposed:

1. Go to the Hyperliquid API page.
2. Revoke the compromised API wallet.
3. Generate a new API wallet.
4. Update your database immediately.

------------------------------------------------------------------------

### Deployment Recommendation (Security)

We strongly recommend running this bot locally (your own PC / private server you fully control).

Reason:

- This bot uses sensitive credentials (exchange private key + Telegram token).
- The safest setup is keeping everything on a machine you control.

If you decide to run it in the cloud (AWS, etc.):

- DO NOT store private keys or tokens inside .env files committed to disk.
- Use a secrets manager (example: AWS Secrets Manager / Parameter Store).
- Load secrets at runtime from the secrets manager.
- Lock down access:
    - restrict IAM permissions to minimum required
    - restrict server/network access (firewalls, allowed IPs, etc.)
- Never log secrets to console or to files.

------------------------------------------------------------------------

## Database Setup (PostgreSQL)

Check README_HOW_TO_SETUP.md

## Profit target

We strongly recommend starting with:

- target_percent = 1.8

Why:

- It gives a decent profit per cycle while avoiding too many trades.
- It reduces fee impact compared to very small targets (fees become a big part of the profit).
- It behaves well in real volatility and avoids over-trading.

Notes:

- margin_percent controls the spacing between grid levels (how dense the grid is).
- target_percent controls the profit target for each completed BUY->SELL (or SELL->BUY) cycle.
- A common approach is margin_percent <= target_percent (so orders are not too dense compared to the profit target).

------------------------------------------------------------------------

## Final Notes

This bot:

- Does not predict direction
- Monetizes volatility
- Avoids leverage risk
- Accumulates BTC over time
- Produces steady grid-based income in ranging markets

It performs best in sideways or oscillating conditions.

Long-term trending markets require appropriate range adjustments.

------------------------------------------------------------------------

Built for disciplined volatility harvesting.