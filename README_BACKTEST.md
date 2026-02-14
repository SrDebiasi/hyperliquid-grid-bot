# Grid Strategy Backtest

This module simulates a grid trading strategy over historical candle data and provides detailed performance metrics, capital requirements, and
performance projections.

It is designed to evaluate how a grid configuration would have performed over a given time range using real market data.

------------------------------------------------------------------------

## Overview

The backtest engine:

1. Fetches historical candles
2. Builds a grid between an entry and exit range
3. Simulates BUY → SELL and SELL → BUY cycles
4. Applies trading fees per side
5. Tracks:
    - Counted cycles
    - Total PnL
    - Capital requirements
    - Daily summaries
    - Performance projections

**Important:**\
Profit is only counted when a full cycle is completed:

- BUY → SELL
- SELL → BUY

Partial legs are not considered realized profit.

------------------------------------------------------------------------

## How It Works

Each grid level behaves independently.

At initialization:

- The first candle open determines the initial direction (BUY or SELL side).
- Each level starts waiting for its trigger price.

When price touches:

- BUY level → opens sell order
- SELL level → opens buy order

When the opposite side is touched:

- The cycle closes
- Fees are applied
- Profit is realized

Cycles are counted using the same logic as the live trading system.

------------------------------------------------------------------------

## Example Usage

``` js
const { result, grid } = await runBacktest({
  symbol: "BTCUSDT",
  interval: "1m",
  startDate: "01/02/2026",
  endDate: "10/02/2026",
  entry_price: 62000,
  exit_price: 102000,
  margin_percent: 0.1,
  target_percent: 1.8,
  simulationConfig: {
    baseUsdPerOrder: 100,
    feeRatePerSide: 0.00015,
    enableLogs: true,
  }
});
```

------------------------------------------------------------------------

## Parameters

### Market Configuration

Parameter Description
  ------------- ----------------------------------
`symbol`      Trading pair (ex: BTCUSDT)\
`interval`    Candle interval (ex: 1m, 5m, 1h)\
`startDate`   Backtest start date (DD/MM/YYYY)\
`endDate`     Backtest end date (DD/MM/YYYY)

------------------------------------------------------------------------

### Grid Configuration

Parameter Description
  ------------------ ----------------------------------------------
`entry_price`      Lower boundary of grid\
`exit_price`       Upper boundary of grid\
`margin_percent`   Distance between grid levels\
`target_percent`   Profit target between buy/sell of each level

------------------------------------------------------------------------

### Simulation Configuration

Parameter Description
  ------------------- -------------------------------------
`baseUsdPerOrder`   USD allocated per grid level
`feeRatePerSide`    Fee per side (ex: 0.00015 = 0.015%)
`enableLogs`        Enables detailed logging
`dailyReport`       Enables daily capital report

------------------------------------------------------------------------

## Output Metrics

When logging is enabled, the engine prints:

### Core Performance

- Grid levels
- Base USD per level
- Total allocated notional
- Total counted cycles
- Total PnL (USD)
- PnL percentage
- Average PnL per cycle
- Fee rate

------------------------------------------------------------------------

### Capital Insight

Daily reports include:

- Pending BUY count
- Pending SELL count
- Required capital (USD equivalent)
- Active capital locked in open positions

This helps evaluate capital efficiency and maximum exposure.

------------------------------------------------------------------------

## Performance Projections

Based on the backtest period:

- Daily PnL
- Weekly PnL
- Monthly PnL
- Yearly PnL

Projections assume a linear continuation of average daily performance
(non-compounded).

------------------------------------------------------------------------

## Example Output

      BACKTEST SUMMARY
      =========================================
      Grid levels: 499
      Period: 2025-12-01 → 2026-02-02
      Base USD per level: $100.00
      Total allocated notional: $49900.00
      Period: 63.00 days
      Counted cycles: 644
      PnL: $1106.55 (2.22%)
      Avg PnL per cycle: $1.7183
      Fee rate per side: 0.0384%
      --- Projections (assuming same performance rate) ---
      Per day:   $17.56 (0.04%)
      Per week:  $122.95 (0.25%)
      Per month: $526.94 (1.06%)
      Per year:  $6411.06 (12.85%)
      =========================================
      BACKTEST RESULT
      =========================================
      Symbol: BTCUSDT
      Grid Levels: 499
      Total Cycles: 644
      Total Profit: $1106.55
      =========================================

------------------------------------------------------------------------

## Important Notes

- PnL is net of fees
- Only completed cycles are counted
- Projections are linear (not compounded)
- Allocated notional is not equal to maximum capital requirement
- Real capital requirement depends on simultaneous active levels

------------------------------------------------------------------------

## Recommended Use

This tool is intended for:

- Strategy validation
- Grid parameter optimization
- Fee sensitivity testing
- Capital efficiency analysis
- Comparing `target_percent` and `margin_percent` combinations

------------------------------------------------------------------------

