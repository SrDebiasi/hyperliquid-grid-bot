/* eslint-disable no-unused-vars */
/* eslint-disable no-unreachable */
import {
  setApi,
  getExchange,
  retrieveInstance,
  initExchange,
  retrieveOrders,
  updateTradeOrder,
  updateTradeInstance,
  addProfit,
  addCycle,
  addMessage,
  consoleLog,
  startHealthchecksPing,
  setBotInstanceConfig,
} from './functions.js';

import { setPrices, setPrice, getInstanceId, setInstanceId, setLastOperation } from './state.js';
import { notifyTelegram, createTelegramBot, setTelegramInstanceConfig } from '../services/telegramService.js';
import { ORDER_STATUS_NOT_OPEN , ORDER_STATUS_FILLED} from '../exchange/HyperliquidAdapter.js';
import { FEE_RATE_MAKER_PER_SIDE } from "./fees.js";

function applyInstanceConfig(cfg) {
  if (!cfg) return;
  setBotInstanceConfig(cfg);
  setTelegramInstanceConfig(cfg);
}

let wallet = null;
let enable = true;
let checking = {};
let timesExecuted = 0;
let prices = {};
let data = [];
let rangePrices = {};

const QUOTE_ASSET = process.env.QUOTE_ASSET || 'USDC';
const BLOCK_USD_BUFFER = Number(process.env.BLOCK_USD_BUFFER ?? 50);
const BLOCK_BASE_BUFFER = Number(process.env.BLOCK_BASE_BUFFER ?? 0.0001);
const DEFAULT_RESERVE_QUOTE_OFFSET_PERCENT = Number(process.env.DEFAULT_RESERVE_QUOTE_OFFSET_PERCENT ?? 30);
const DEFAULT_RESERVE_BASE_OFFSET_PERCENT  = Number(process.env.DEFAULT_RESERVE_BASE_OFFSET_PERCENT ?? 30);

let pairToIndex = {};

/**
 * Simple async delay helper.
 * @param {number} ms - Milliseconds to wait.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Checks whether a value should be treated as "missing" for order id fields.
 *
 * @param {unknown} v
 * @returns {boolean}
 */
const isBlank = (v) => v == null || v === '';

/**
 * Returns true if the grid row currently has an active BUY order id set.
 *
 * @param {object} o
 * @returns {boolean}
 */
const hasBuy = (o) => !isBlank(o.buy_order);

/**
 * Returns true if the grid row currently has an active SELL order id set.
 *
 * @param {object} o
 * @returns {boolean}
 */
const hasSell = (o) => !isBlank(o.sell_order);

/**
 * Returns true if the grid row has any active order id set (BUY or SELL).
 *
 * @param {object} o
 * @returns {boolean}
 */
const hasAnyOrder = (o) => hasBuy(o) || hasSell(o);

/**
 * Safely converts a value to a finite number.
 * Returns `fallback` if conversion fails (NaN / Infinity).
 *
 * @param {unknown} x
 * @param {number} [fallback=0]
 * @returns {number}
 */
function toNum(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Rounds a number to a fixed number of decimal places.
 *
 * @param {number} n
 * @param {number} [dp=8] - Decimal places.
 * @returns {number}
 */
function round(n, dp = 8) {
  const p = 10 ** dp;
  return Math.round(n * p) / p;
}


/**
 * Starts the execution loop for a single market (by index) and logs any uncaught errors.
 *
 * This is a fire-and-forget entry point: it triggers `runCoins(coinIndex)` and ensures
 * exceptions are handled so they don't crash the process.
 *
 * @param {number} coinIndex - Index of the market configuration inside `data`.
 * @returns {void}
 */
function startMarket(coinIndex) {
  void runCoins(coinIndex)
      .catch((ex) => {
            console.log(`Error on runCoins`)
            console.log(ex)
      });
}

/**
 * Schedules the next execution of a market loop after a delay.
 *
 * This is used to control how often `startMarket()` runs per coin, allowing faster
 * retries after fills and slower polling during idle periods.
 *
 * @param {number} coinIndex - Index of the market configuration inside `data`.
 * @param {number} ms - Delay in milliseconds before starting the market again.
 * @returns {void}
 */
function runWithTime(coinIndex, ms) {
  setTimeout(() => startMarket(coinIndex), ms);
}

/**
 * Truncates a numeric value to a fixed number of decimal places (no rounding).
 *
 * This is useful for exchanges that require quantities/prices to respect step sizes,
 * where rounding up could cause an "invalid precision" or "insufficient balance" error.
 *
 * Notes:
 * - Accepts numbers or strings.
 * - If the value already has <= `decimals` decimal places, it is returned as a number unchanged.
 *
 * @param {number|string} amountAsString - The input value to truncate.
 * @param {number} [decimals=2] - Number of decimal places to keep.
 * @returns {number} The truncated numeric value.
 */
function truncate(amountAsString, decimals = 2) {
  amountAsString = String(amountAsString);
  const dotIndex = amountAsString.indexOf('.');
  const shouldTruncate = dotIndex !== -1 && amountAsString.length > dotIndex + decimals + 1;
  const factor = Math.pow(10, decimals);
  const raw = shouldTruncate
    ? amountAsString.slice(0, dotIndex + decimals + 1)
    : amountAsString;
  return shouldTruncate
    ? Math.floor(parseFloat(raw) * factor) / factor
    : parseFloat(amountAsString);
}

/**
 * Calculates the gross profit of a completed grid cycle (SELL - BUY),
 * without considering exchange fees.
 *
 * This represents the theoretical profit per operation before costs.
 *
 * @param {object} order - Trade order row containing buy_price and sell_price.
 * @param {number} quantity - Executed quantity for the cycle.
 * @returns {number} Gross profit in quote currency (e.g., USDT).
 */
function calculateProfit(order, quantity) {
  const sellValue = Number(order.sell_price) * quantity;
  const buyValue = Number(order.buy_price) * quantity;
  return sellValue - buyValue; // Gross profit (no fees)
}

/**
 * Calculates net profit (gross - fees) for a completed cycle.
 *
 * @param {object} order
 * @param {number} quantity
 * @param {number} feeRatePerSide - Decimal fee rate per side (e.g., 0.000384).
 * @returns {number}
 */
function calculateNetProfit(order, quantity, feeRatePerSide = FEE_RATE_MAKER_PER_SIDE) {
  const gross = calculateProfit(order, quantity);
  const notionalBuy = Number(order.buy_price) * quantity;
  const notionalSell = Number(order.sell_price) * quantity;
  const fees = (notionalBuy * feeRatePerSide) + (notionalSell * feeRatePerSide);
  return gross - fees;
}

/**
 * Persists the "first profit" for an order row once, if not already set.
 *
 * The first profit is used as a reference value for the grid row based on:
 * - gross profit between sell_price and entry_price, multiplied by quantity
 * - if that calculation is negative (unexpected), falls back to net profit using buy/sell prices
 *
 * Why this exists:
 * When the bot enters during a low market and price trends up without returning to the
 * original entry area, this value provides a baseline "profit if sold on the first up move"
 * for that grid row.
 *
 * Notes:
 * - Updates the database asynchronously (fire-and-forget).
 * - Does not modify the in-memory order beyond reading its fields.
 *
 * @param {object} order - Trade order row containing id, quantity, sell_price, entry_price, and first_profit.
 * @returns {void}
 */
function calculateFirstProfit(order) {
  if (order.first_profit == null || order.first_profit === '') {
    let firstProfit =
      Number(order.quantity) * Number(order.sell_price) -
      Number(order.quantity) * Number(order.entry_price);

    if (firstProfit < 0) {
      firstProfit = calculateNetProfit(order, Number(order.quantity));
    }

    consoleLog(`Calculating first profit for order ${order.id}: ${firstProfit}`);

    void updateTradeOrder({ id: order.id, first_profit: firstProfit }).catch((ex) => {
      const details = ex?.message ?? String(ex);
      console.log(`Error updating first_profit in DB: ${details}`);
    });
  }
}

/**
 * Cancels the current QUOTE reserve order (BUY limit far below market), if present.
 * This is the order that locks/freezes quote balance (e.g., USDC) so the bot doesn’t
 * allocate all free quote into grid orders.
 *
 * @param {number} coinIndex
 * @returns {Promise<void>}
 */
async function cancelReserveQuoteOrder(coinIndex) {
  const cfg = data[coinIndex];
  if (!cfg?.reserve_quote_order_id) return;

  consoleLog(`${timesExecuted}) Cancelling reserve quote order ${cfg.reserve_quote_order_id}`);

  try {
    await getExchange().cancelOrder({
      orderId: cfg.reserve_quote_order_id,
      symbol: cfg.pair,
    });
  } catch (e) {
    const details = e?.message ?? String(e);
    console.log(`Error cancelling reserve quote order: ${details}`);
  }

  try {
    await updateTradeInstance({
      id: cfg.id,
      reserve_quote_order_id: '',
    });

    // Keep local cache consistent with the database
    cfg.reserve_quote_order_id = null;
  } catch (e) {
    const details = e?.message ?? String(e);
    console.log(`Error clearing reserve quote order in DB: ${details}`);
  }
}

/**
 * Cancels the current BASE reserve order (SELL limit far above market), if present.
 * This is the order that locks/freezes base balance (e.g., BTC) so the bot doesn’t
 * allocate all free base into grid orders.
 *
 * @param {number} coinIndex
 * @returns {Promise<void>}
 */
async function cancelReserveBaseOrder(coinIndex) {
  const cfg = data[coinIndex];
  if (!cfg?.reserve_base_order_id) return;

  consoleLog(`${timesExecuted}) Cancelling reserve base order ${cfg.reserve_base_order_id}`);

  try {
    await getExchange().cancelOrder({
      orderId: cfg.reserve_base_order_id,
      symbol: cfg.pair,
    });
  } catch (e) {
    const details = e?.message ?? String(e);
    console.log(`${timesExecuted}) Error cancelling reserve base order: ${details}`);
  }

  try {
    await updateTradeInstance({
      id: cfg.id,
      reserve_base_order_id: '',
    });

    // Keep local cache consistent with the database
    cfg.reserve_base_order_id = null;
  } catch (e) {
    const details = e?.message ?? String(e);
    console.log(`${timesExecuted}) Error clearing reserve base order in DB: ${details}`);
  }
}

function getQuoteBalance() {
  return wallet?.find((o) => o.asset === QUOTE_ASSET) ?? null;
}

// Hyperliquid uses "U"-prefixed spot symbols for some assets (e.g., BTC -> UBTC).
// We map the most common ones explicitly (BTC/ETH/SOL), otherwise we fallback to `U${symbol}`.
// If nothing matches, we also try the raw symbol as-is.
function getBaseBalance(cfg) {
  const a = String(cfg?.name ?? '').trim().toUpperCase();
  if (!a) return null;

  const b = (a === 'BTC' ? 'UBTC' : a === 'ETH' ? 'UETH' : a === 'SOL' ? 'USOL' : `U${a}`);
  return wallet?.find(o => o.asset === b) ?? wallet?.find(o => o.asset === a) ?? null;
}

async function detectReserveOrdersByExtremes(cfg) {
  // 1) Exchange open orders first
  const open = await getExchange().getOpenOrders({});

  if (!open.length) return { action: 'none', reason: 'no_open_orders' };

  const list = open
      .map(o => {
        const priceNum = Number(o.price);
        const origNum = Number(o.origQty);

        return {
          orderId: Number(o.orderId),
          price: priceNum,
          qty: origNum,
          side: o.side,
          symbol: o.symbol,
        };
      })
      .filter(o =>
          Number.isFinite(o.orderId) &&
          Number.isFinite(o.price) &&
          Number.isFinite(o.qty) &&
          o.qty > 0
      )
      .sort((a, b) => a.price - b.price);

  if (!list.length) return { action: 'none', reason: 'no_valid_open_orders' };

  const openIds = new Set(list.map(o => o.orderId));

  const reserveBaseId = cfg.reserve_base_order_id ? Number(cfg.reserve_base_order_id) : null;
  const reserveQuoteId = cfg.reserve_quote_order_id ? Number(cfg.reserve_quote_order_id) : null;

  // 2) If the saved reserve IDs exist in open orders, skip verification for that side
  const baseIdIsPresent = reserveBaseId != null && openIds.has(reserveBaseId);
  const quoteIdIsPresent = reserveQuoteId != null && openIds.has(reserveQuoteId);

  // If both are present, we can skip everything
  if (baseIdIsPresent && quoteIdIsPresent) {
    return { action: 'skip', reason: 'reserve_ids_present_in_open_orders' };
  }

  // 3) Need DB orders to get baseline qty (only if we need to verify at least one side)
  const dbOrders = await retrieveOrders({
    pair: cfg.pair,
    trade_instance_id: cfg.id,
  });

  const maxDbQty = Math.max(0, ...dbOrders.map(o => Number(o.quantity) || 0));

  const lowest = list[0];
  const highest = list[list.length - 1];

  const cancels = [];
  const updates = {};

  // 4) BASE reserve check (highest price)
  if (!baseIdIsPresent) {
    const highestIsReserve = highest.qty > maxDbQty;

    if (highestIsReserve && reserveBaseId != null && highest.orderId !== reserveBaseId) {
      cancels.push({ orderId: highest.orderId, symbol: cfg.pair });
      updates.reserve_base_order_id = null;
      cfg.reserve_base_order_id = null;
    }
  }

  // 5) QUOTE reserve check (lowest price)
  if (!quoteIdIsPresent) {
    const lowestIsReserve = lowest.qty > maxDbQty;

    if (lowestIsReserve && reserveQuoteId != null && lowest.orderId !== reserveQuoteId) {
      cancels.push({ orderId: lowest.orderId, symbol: cfg.pair });
      updates.reserve_quote_order_id = null;
      cfg.reserve_quote_order_id = null;
    }
  }

  // 6) Apply cancels + DB updates
  if (cancels.length) {
    consoleLog(`Reserve mismatch ${cfg.pair}. Cancelling ${cancels.length} candidate(s).`, 'yellow');
    await getExchange().cancelOrders({ cancels });
  }

  if (Object.keys(updates).length) {
    await updateTradeInstance({
      id: cfg.id,
      pair: cfg.pair,
      ...updates,
    });
  }

  return {
    action: cancels.length || Object.keys(updates).length ? 'fixed' : 'none',
    baseIdIsPresent,
    quoteIdIsPresent,
    maxDbQty,
    lowest,
    highest,
    cancels,
    updates,
  };
}

async function dedupeOpenOrdersForPair(cfg) {
  let dbOrders = await retrieveOrders({ pair: cfg.pair, trade_instance_id: cfg.trade_instance_id })
  // 1) expected ids from DB
  const expected = new Set(
      dbOrders.flatMap(o => [o.buy_order, o.sell_order]).filter(Boolean).map(Number)
  );

  // 2) exchange open orders
  const open = await getExchange().getOpenOrders({}); // your adapter method
  // TODO: filter by cfg.pair if we are going to run in more than one pair
  // const openForPair = open.filter(o => o.pair === cfg.pair);
  const openForPair = open;

  // 3) group by side+price
  const groups = new Map(); // key -> list
  for (const o of openForPair) {
    const side = o.side; // BUY/SELL already normalized
    const priceKey = Number(o.price).toFixed(cfg.decimal_price);
    const key = `${side}:${priceKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  // 4) cancel duplicates not saved in DB
  const cancels = [];
  const dupes = [];

  for (const [key, list] of groups.entries()) {
    if (list.length <= 1) continue;

    // keep any that is expected; if multiple expected (shouldn't happen), keep the first and cancel rest
    const expectedOnes = list.filter(x => expected.has(Number(x.orderId)));
    let keepId = null;

    if (expectedOnes.length > 0) {
      keepId = Number(expectedOnes[0].orderId);
    }

    for (const x of list) {
      const id = Number(x.orderId);
      if (keepId != null && id === keepId) continue;

      // cancel everything else
      cancels.push({ orderId: id, symbol: cfg.pair }); // your adapter cancel expects symbol pair
      dupes.push({ key, keepId, cancelId: id });
    }
  }

  if (cancels.length) {
    consoleLog(`${timesExecuted}) Dedupe: cancelling ${cancels.length} duplicate open order(s)`, 'yellow');
    await getExchange().cancelOrders({ cancels });
  }

  return { cancelled: dupes };
}

/**
 * Creates reserve orders to lock funds away from the grid:
 * - QUOTE reserve: BUY LIMIT far below market to lock quote (e.g., USDC)
 * - BASE  reserve: SELL LIMIT far above market to lock base  (e.g., BTC)
 *
 * The offsets are percent-based, so these orders are very unlikely to fill.
 *
 * @param {number} coinIndex
 * @param {number|string} currentPrice
 * @returns {Promise<void>}
 */
async function createReserveOrders(coinIndex, currentPrice) {
  await balanceCheck();

  const cfg = data[coinIndex];

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    consoleLog(`Invalid last price for ${cfg.pair}: ${currentPrice}`, 'red');
    return;
  }

  const quoteOffsetPct = Number(cfg.reserve_quote_offset_percent ?? DEFAULT_RESERVE_QUOTE_OFFSET_PERCENT);
  const baseOffsetPct  = Number(cfg.reserve_base_offset_percent ?? DEFAULT_RESERVE_BASE_OFFSET_PERCENT);

  if (!Number.isFinite(quoteOffsetPct) || quoteOffsetPct <= 0) {
    consoleLog(`Invalid reserve_quote_offset_percent: ${cfg.reserve_quote_offset_percent}`, 'red');
    return;
  }
  if (!Number.isFinite(baseOffsetPct) || baseOffsetPct <= 0) {
    consoleLog(`Invalid reserve_base_offset_percent: ${cfg.reserve_base_offset_percent}`, 'red');
    return;
  }

  // Prices far from market so they likely won't fill
  const reserveBuyPrice = truncate(
      currentPrice * (1 - quoteOffsetPct / 100),
      cfg.decimal_price
  );

  const reserveSellPrice = truncate(
      currentPrice * (1 + baseOffsetPct / 100),
      cfg.decimal_price
  );

  if (!Number.isFinite(reserveBuyPrice) || reserveBuyPrice <= 0) {
    consoleLog(`Invalid reserve BUY price calculated: ${reserveBuyPrice}`, 'red');
    return;
  }
  if (!Number.isFinite(reserveSellPrice) || reserveSellPrice <= 0) {
    consoleLog(`Invalid reserve SELL price calculated: ${reserveSellPrice}`, 'red');
    return;
  }

  // Cancel old reserve orders first
  await cancelReserveQuoteOrder(coinIndex);
  await cancelReserveBaseOrder(coinIndex);
  await sleep(1000);

  // Refresh balances after cancels
  await balanceCheck();

  // ---- QUOTE RESERVE (locks quote by placing a BUY LIMIT) ----
  const quote = getQuoteBalance();
  if (quote) {
    const freeQuote = Number(quote.free);
    const spendableQuote = freeQuote - BLOCK_USD_BUFFER;

    if (spendableQuote > 0) {
      const buyQty = truncate(spendableQuote / reserveBuyPrice, cfg.decimal_quantity);

      if (Number.isFinite(buyQty) && buyQty > 0) {
        consoleLog(
            `${timesExecuted}) Reserve QUOTE: BUY ${cfg.pair} @ ${reserveBuyPrice} qty=${buyQty} (locks ~${spendableQuote.toFixed(2)} ${QUOTE_ASSET})`
        );

        try {
          const o = await createOrderLimit({
            side: 'BUY',
            quantity: buyQty,
            price: reserveBuyPrice,
            symbol: cfg.pair,
          });

          const id = o?.orderId;
          if (id) {
            await updateTradeInstance({ id: cfg.id, reserve_quote_order_id: id });
            cfg.reserve_quote_order_id = id;
            consoleLog(`${timesExecuted}) Updated reserve_quote_order_id to ${id}`);
          }
        } catch (e) {
          console.log(quote);
          consoleLog(`Error creating reserve QUOTE order: ${e?.message ?? String(e)}`, 'red');
        }
      }
    } else {
      consoleLog(`Not enough ${QUOTE_ASSET} to reserve. free=${freeQuote.toFixed(2)}`);
    }
  }

  // ---- BASE RESERVE (locks base by placing a SELL LIMIT) ----
  const base = getBaseBalance(cfg);
  if (base) {
    const freeBase = Number(base.free);
    const sellableBase = freeBase - BLOCK_BASE_BUFFER;

    if (sellableBase > 0) {
      const sellQty = truncate(sellableBase, cfg.decimal_quantity);

      if (Number.isFinite(sellQty) && sellQty > 0) {
        consoleLog(
            `${timesExecuted}) Reserve BASE: SELL ${cfg.pair} @ ${reserveSellPrice} qty=${sellQty} (locks ~${sellQty} base units)`
        );

        try {
          const o = await createOrderLimit({
            side: 'SELL',
            quantity: sellQty,
            price: reserveSellPrice,
            symbol: cfg.pair,
          });

          const id = o?.orderId;
          if (id) {
            await updateTradeInstance({ id: cfg.id, reserve_base_order_id: id });
            cfg.reserve_base_order_id = id;
            consoleLog(`${timesExecuted}) Updated reserve_base_order_id to ${id}`);
          }
        } catch (e) {
          console.log(base);
          consoleLog(`Error creating reserve BASE order: ${e?.message ?? String(e)}`, 'red');
        }
      }
    } else {
      consoleLog(`${timesExecuted}) Not enough base asset to reserve. free=${freeBase}`);
    }
  }
}

/**
 * Creates a LIMIT order and updates:
 * - the in-memory `order` object immediately (so the current loop can use it)
 * - the database row asynchronously (fire-and-forget)
 *
 * @param {object} order - Trade order row (mutated in-memory).
 * @param {number|string} quantity - Order quantity.
 * @param {'BUY'|'SELL'} side - Order side.
 * @param {number|string} price - Limit price.
 * @param {'buy_order'|'sell_order'} updateField - Which field to write the created order id to.
 * @param {'BUY'|'SELL'|''} [nextCycleSide] - Optional side to store when last_side is not defined.
 * @returns {Promise<boolean>} True if order was created and in-memory state updated.
 */
async function createOrderAndUpdate(order, quantity, side, price, updateField, nextCycleSide = '') {
  consoleLog(`${timesExecuted}) Creating a ${String(side).toLowerCase()} order at ${price}`);
  let newOrder;
  try {
    newOrder = await createOrderLimit({
      side,
      quantity,
      price,
      symbol: order.pair,
    });
  } catch (err) {
    const details = err?.message ?? String(err);
    const errorMessage = `Error creating order: ${details}`;
    console.log(errorMessage);
    void notifyTelegram(errorMessage);
    return false;
  }
  const orderId = newOrder?.orderId;
  if (!orderId) {
    console.log('Order creation returned empty orderId');
    return false;
  }
  // Update in-memory state immediately
  order[updateField] = orderId;
  if (nextCycleSide) order.side = nextCycleSide;
  // Persist in DB (do not block the main loop)
  void updateTradeOrder({
    id: order.id,
    [updateField]: orderId,
    ...(nextCycleSide ? { side: nextCycleSide } : {}),
  }).catch((ex) => {
    const details = ex?.message ?? String(ex);
    console.log(`Error updating trade order in DB: ${details}`);
  });
  return true;
}

/**
 * Fetches the latest prices from the exchange and updates both:
 * - the shared state store (via `setPrices`)
 * - the local `prices` cache used by this module
 *
 * This method is called periodically inside the main loop to keep pricing data fresh.
 *
 * @returns {Promise<void>}
 */
const updatePrices = async function(pairs = []) {
  try {
    const exchangePrices = await getExchange().getPrices(pairs);
    setPrices(exchangePrices);
    prices = exchangePrices;
  } catch (err) {
    const details = err?.message ?? String(err);
    console.log(`Error updating prices: ${details}`);
  }
};

/**
 * Rejects after `ms` milliseconds. Used to timebox slow exchange requests.
 *
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<never>}
 */
const timeoutAfter = (ms, message) =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));

/**
 * Refreshes `wallet` with the latest balances using a request timeout.
 *
 * @returns {Promise<void>}
 */
async function balanceCheck() {
  try {
    const result = await Promise.race([
      getBalance(),
      timeoutAfter(10_000, 'Balance request took more than 10 seconds'),
    ]);
    wallet = result?.balances ?? [];
  } catch (err) {
    const details = err?.message ?? String(err);
    consoleLog(`Balance check failed: ${details}`, 'red');
    throw err;
  }
}

/**
 * Fetches account info from the exchange.
 *
 * Expected return shape (normalized):
 * { balances: Array<{ asset: string, free: string|number, locked: string|number }> }
 *
 * @param {object} [params={}]
 * @returns {Promise<{ balances: Array<{ asset: string, free: string|number, locked: string|number }> }>}
 */
async function getBalance(params = {}) {
  return getExchange().getAccountInfo(params);
}

/**
 * Filters grid orders around the current market price and optionally cancels
 * out-of-range open orders.
 *
 * Purpose:
 * - Keeps only the nearest BUY and SELL levels around the current price.
 * - Reduces unnecessary open orders far from execution range.
 * - Improves capital efficiency and minimizes exposure during extreme moves.
 *
 * Originally introduced due to exchange open-order limits (e.g., Binance),
 * but still useful on exchanges without strict limits (e.g., Hyperliquid)
 * to control risk and API load.
 *
 * @param {Array<object>} orders - All grid rows from DB.
 * @param {number} currentPrice - Latest market price.
 * @param {object} coinData - Market configuration (may include execution limits).
 * @param {number} [limit=90] - Maximum BUY and SELL rows to keep near price.
 * @param {boolean} [cleanup=true] - Whether to cancel out-of-range orders.
 * @returns {Promise<Array<object>>} Filtered and sorted grid rows.
 */
async function filterAndCleanupOrders(orders, currentPrice, coinData, limit = 100, cleanup = true) {
  const above = [];
  const below = [];

  const execMin = coinData.execution_price_min ? parseFloat(coinData.execution_price_min) : null;
  const execMax = coinData.execution_price_max ? parseFloat(coinData.execution_price_max) : null;

  for (const o of orders) {
    const buy = parseFloat(o.buy_price);
    const sell = parseFloat(o.sell_price);

    const buyAllowed = !execMin || buy >= execMin;
    const sellAllowed = !execMax || sell <= execMax;

    if (buy <= currentPrice && buyAllowed) below.push(o);
    if (sell >= currentPrice && sellAllowed) above.push(o);
  }

  below.sort((a, b) => b.buy_price - a.buy_price);
  above.sort((a, b) => a.sell_price - b.sell_price);

  const selected = [...below.slice(0, limit), ...above.slice(0, limit)];
  const selectedIds = new Set(selected.map(o => o.id));

  if (cleanup) {
    // 1) collect out-of-range orders that have orderIds
    const toCleanup = orders.filter(o => !selectedIds.has(o.id) && (o.buy_order || o.sell_order));

    // 2) build list of all orderIds to query once
    const orderIds = toCleanup.flatMap(o => [o.buy_order, o.sell_order]).filter(Boolean);

    let statuses = new Map();
    try {
      statuses = await getExchange().getOrdersStatusMap({ orderIds });
    } catch (e) {
      console.log('StatusMap error:', e);
      // if we cannot fetch statuses, better to avoid blind cancelling
      statuses = new Map();
    }

    // 3) build cancel payloads only for OPEN orders
    const cancels = [];
    const toDbClear = [];

    for (const o of toCleanup) {
      let cleared = false;

      if (o.buy_order) {
        const st = statuses.get(Number(o.buy_order))?.status;
        if (st !== ORDER_STATUS_FILLED ) {
          cancels.push({ orderId: o.buy_order, symbol: coinData.pair });
        }
        cleared = true;
      }

      if (o.sell_order) {
        const st = statuses.get(Number(o.sell_order))?.status;
        if (st !== ORDER_STATUS_FILLED) {
          cancels.push({ orderId: o.sell_order, symbol: coinData.pair });
        }
        cleared = true;
      }

      if (cleared) toDbClear.push(o);
    }

    // 4) cancel in batch
    if (cancels.length) {
      consoleLog(`${timesExecuted}) Batch cancelling ${cancels.length} order(s)`, 'yellow');
      try {
        await getExchange().cancelOrders({ cancels });
      } catch (e) {
        console.log('Batch cancel error:', e);
      }
    }

    // 5) clear DB for those rows (parallel)
    // TODO optimize further with a single SQL UPDATE ... WHERE id IN (...)
    await Promise.allSettled(
        toDbClear.map(o =>
            updateTradeOrder({ id: o.id, buy_order: null, sell_order: null })
        )
    );
  }

  // de-dupe selected
  const uniqueSelected = [];
  const seen = new Set();
  for (const o of selected) {
    if (!seen.has(o.id)) {
      seen.add(o.id);
      uniqueSelected.push(o);
    }
  }

  uniqueSelected.sort((a, b) => b.sell_price - a.sell_price);
  return uniqueSelected;
}

function getIntEnv(name, fallback, { min = 1, max = 100000 } = {}) {
  const raw = process.env[name];
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.trunc(n);
  if (v < min) return fallback;
  if (v > max) return max;
  return v;
}

// Keep a larger window when cleanup is enabled (so we cancel fewer "useful" rows by mistake)
const ORDERS_WINDOW_DEFAULT = getIntEnv('GRID_ORDERS_WINDOW_DEFAULT', 70, { min: 10, max: 1000 });
const ORDERS_WINDOW_CLEANUP  = getIntEnv('GRID_ORDERS_WINDOW_CLEANUP', 100, { min: 10, max: 2000 });

/**
 * Loads grid orders from the database and filters them around the current price.
 *
 * Cleanup (canceling / pruning) is disabled by default to avoid excessive exchange/API calls
 * and request-credit throttling. Cleanup is only allowed when we are close to Hyperliquid's
 * open-order limit: if the DB has more than MAX_OPEN_ORDERS and the exchange also reports
 * at least SAFE_OPEN_THRESHOLD open orders.
 *
 * @param {object} params
 * @param {string} params.pair
 * @param {number|string} params.tradeInstanceId
 * @param {number} params.currentPrice
 * @param {object} params.cfg
 * @param {number} params.timesExecuted
 * @returns {Promise<Array<object>>} Filtered list of orders around the current price.
 */
async function loadAndFilterOrders({ pair, tradeInstanceId, currentPrice, cfg, timesExecuted }) {
  const orders = await retrieveOrders({ pair, trade_instance_id: tradeInstanceId });
  consoleLog(`${timesExecuted}) Loaded ${orders.length} total orders from DB`);

  const limit = ORDERS_WINDOW_DEFAULT;

  // Cleanup guards (avoid cancel/create spam)
  const MAX_OPEN_ORDERS = 1000;       // official default cap
  const SAFE_OPEN_THRESHOLD = 900;    // only cleanup if we're close-ish

  let shouldCleanup = false;

  // Only even consider cleanup if DB indicates we're beyond the cap.
  // (DB can drift, so we confirm with exchange open orders before canceling anything.)
  if (orders.length > MAX_OPEN_ORDERS) {
    try {
      const open = await getExchange().getOpenOrders({});
      const openCount = Array.isArray(open) ? open.length : 0;

      // If exchange also has a lot of open orders, cleanup is allowed.
      // If exchange is already < threshold, don't cleanup (DB likely has stale records).
      shouldCleanup = openCount >= SAFE_OPEN_THRESHOLD;

      consoleLog(
          `${timesExecuted}) Cleanup check: db=${orders.length} open=${openCount} -> shouldCleanup=${shouldCleanup}`
      );
    } catch (e) {
      // If we can't confirm, do NOT cleanup. Safer to avoid accidental spam cancels.
      consoleLog(`${timesExecuted}) Cleanup check failed, skipping cleanup: ${String(e?.message || e)}`, 'yellow');
      shouldCleanup = false;
    }
  }

  const filtered = await filterAndCleanupOrders(orders, currentPrice, cfg, limit, shouldCleanup);
  consoleLog(`${timesExecuted}) Filtered to ${filtered.length} orders around price`);

  return filtered;
}

/**
 * Executes one iteration of the grid loop for a given market index.
 *
 * Responsibilities:
 * - Loads market config and reads the latest price.
 * - Loads grid rows from DB, filters to the closest levels, and occasionally performs cleanup.
 * - Ensures each grid row has either a BUY or SELL order placed based on `last_side`.
 * - Detects filled orders and places the next order in the cycle.
 * - Tracks profit on alternating operations and optionally triggers rebuy.
 * - Updates the active price boundaries (min/max) used by the WS trigger logic.
 * - Schedules the next iteration with a short delay after fills and a longer delay otherwise.
 *
 * Notes:
 * - Logic is intentionally sequential per order to avoid rate-limit spikes.
 * - Some DB writes are fire-and-forget to keep the loop responsive.
 *
 * @param {number} coinIndex - Index of the market configuration inside `data`.
 * @returns {Promise<void>}
 */
const runCoins = async function(coinIndex) {
  // Lock acquired BEFORE any await — prevents concurrent executions even when
  // called simultaneously from multiple WS callbacks or timers. Previously the
  // lock was acquired after `await retrieveInstance`, leaving a race window where
  // two calls could both read checking[coinIndex] === false before either set it.
  if (checking[coinIndex]) { return; }
  checking[coinIndex] = true;

  let timeToExecute = 20000;
  let pair = 'unknown';
  try {
    data = await retrieveInstance({ id: getInstanceId() }).catch((ex) => console.log(ex));

    const cfg = data[coinIndex];
    if (!cfg) {
      timeToExecute = 60000;
      return;
    }
    pair = cfg.pair;
    const tradeInstanceId = cfg.id;
    const dp = cfg.decimal_price;
    const dq = cfg.decimal_quantity;

    if (!enable) {
      runWithTime(coinIndex, 5000);
      return;
    }

    timesExecuted++;

    await updatePrices([pair]);

    const currentPrice = prices[getExchange().normalizeSymbolForPrice(pair)];

    consoleLog(`${timesExecuted}) Current price: ${Number(currentPrice).toFixed(dp)}`);

    await dedupeOpenOrdersForPair(cfg)
    await detectReserveOrdersByExtremes(cfg)

    const orders = await loadAndFilterOrders({
      pair,
      tradeInstanceId,
      currentPrice,
      cfg,
      timesExecuted,
    });

    let orderFilled = false;

    const orderIds = orders
        .flatMap(o => [o.buy_order, o.sell_order])
        .filter(Boolean);

    const statuses = await getExchange().getOrdersStatusMap({ orderIds });

    for (let order of orders) {
      await sleep(100);
      order = await retrieveOrders({ id: order.id });

      // Place the initial order for this grid row if none exists.
      if (!hasAnyOrder(order)) {
        try {
          let side;
          let price;
          let field;
          let expectedLastSide;

          if (order.last_side === 'BUY') {
            side = 'SELL';
            price = order.sell_price;
            field = 'sell_order';
          } else if (order.last_side === 'SELL') {
            side = 'BUY';
            price = order.buy_price;
            field = 'buy_order';
          } else {
            // First operation: determine direction based on current position vs sell_price.
            const canSell = parseFloat(order.sell_price) >= parseFloat(order.entry_price);
            const shouldSell = currentPrice < parseFloat(order.sell_price) && canSell;

            side = shouldSell ? 'SELL' : 'BUY';
            price = shouldSell ? order.sell_price : order.buy_price;
            field = shouldSell ? 'sell_order' : 'buy_order';
            expectedLastSide = shouldSell ? 'BUY' : 'SELL';
          }

          consoleLog(
            `${timesExecuted}) ${order.last_side ? `Last side ${order.last_side}` : 'No last side'}, creating ${side} at ${price}`,
          );

          await cancelReserveBaseOrder(coinIndex);
          await cancelReserveQuoteOrder(coinIndex);

          await createOrderAndUpdate(
            order,
            order.quantity,
            side,
            price,
            field,
            expectedLastSide, // undefined when last_side exists (same behavior as before)
          );
        } catch (e) {
          console.log(e);
        }

        continue;
      }

      // Existing SELL order path
      if (hasSell(order)) {
        const sellStatus = statuses.get(Number(order.sell_order))?.status;
        if (sellStatus === ORDER_STATUS_FILLED) {
          orderFilled = true;
          setLastOperation(pair);

          const sellMsg = `Sell order filled ${order.sell_order} at ${order.sell_price}`;
          consoleLog(`${timesExecuted}) ${sellMsg}`, 'yellow');

          const quantityToBuy = parseFloat(order.quantity);

          consoleLog(`${timesExecuted}) Creating BUY limit order at ${order.buy_price}`);
          await cancelReserveQuoteOrder(coinIndex);

          const newOrder = await createOrderLimit({
            side: 'BUY',
            quantity: quantityToBuy,
            price: order.buy_price,
            symbol: order.pair,
          });

          // Persist and update in-memory state.
          // Awaited so the DB reflects the new state before the checking lock is released,
          // preventing a second runCoins cycle from reading stale data and double-processing.
          await updateTradeOrder({
            id: order.id,
            buy_order: newOrder.orderId,
            sell_order: null,
            last_side: 'SELL',
            last_operation: !order.last_operation,
          }).catch((ex) => console.log(ex));

          order.buy_order = newOrder.orderId;
          order.sell_order = null;
          order.last_side = 'SELL';

          if (order.last_operation == true) {
            const profitReal = parseFloat(
              calculateNetProfit(order, parseFloat(order.quantity)).toFixed(dq),
            );

            addProfit({
              trade_instance_id: tradeInstanceId,
              name: cfg.name,
              pair: order.pair,
              profit: 'SELL',
              value: profitReal,
              fee: calculateFeesForCycle(order),
              target_percent: cfg.target_percent,
              price_intermediate: order.buy_price,
              price_final: order.sell_price,
            });

            await handleRebuyFromProfit(coinIndex, profitReal);
          } else {
            void notifyTelegram(sellMsg);
            addCycle({
              trade_instance_id: tradeInstanceId,
              name: cfg.name,
              pair: order.pair,
              side: 'SELL',
              price: order.sell_price,
            });
          }
          // Needs to update after the last_operation check
          order.last_operation = !order.last_operation;

          if (currentPrice >= order.entry_price) calculateFirstProfit(order);
        }

        // We have an orderId locally, but the order is not open on the exchange.
        if (sellStatus === ORDER_STATUS_NOT_OPEN) {
          clearMissingOrder({ order, side: 'SELL', tradeOrderId: order.id });
        }
      }

      // Existing BUY order path
      if (hasBuy(order)) {
        const buyStatus  = statuses.get(Number(order.buy_order))?.status;
        if (buyStatus === ORDER_STATUS_FILLED) {
          orderFilled = true;
          setLastOperation(pair);

          const buyMsg = `Buy order filled ${order.buy_order} at ${order.buy_price}`;
          const quantityToSell = parseFloat(order.quantity);

          consoleLog(`${timesExecuted}) ${buyMsg}`, 'yellow');

          consoleLog(`${timesExecuted}) Creating SELL limit order at ${order.sell_price}`);
          await cancelReserveBaseOrder(coinIndex);

          const newOrder = await createOrderLimit({
            side: 'SELL',
            quantity: quantityToSell,
            price: order.sell_price,
            symbol: order.pair,
          });

          // Persist and update in-memory state.
          // Awaited so the DB reflects the new state before the checking lock is released,
          // preventing a second runCoins cycle from reading stale data and double-processing.
          await updateTradeOrder({
            id: order.id,
            sell_order: newOrder.orderId,
            buy_order: null,
            last_side: 'BUY',
            last_operation: !order.last_operation,
          }).catch((ex) => console.log(ex));

          // NOTE: keep the in-memory order consistent with the DB update
          order.sell_order = newOrder.orderId;
          order.buy_order = null;
          order.last_side = 'BUY';

          if (order.last_operation == true) {
            const profitReal = parseFloat(calculateNetProfit(order, quantityToSell).toFixed(dq));

            addProfit({
              trade_instance_id: tradeInstanceId,
              name: cfg.name,
              pair: order.pair,
              profit: 'BUY',
              value: profitReal,
              fee: calculateFeesForCycle(order),
              target_percent: cfg.target_percent,
              price_intermediate: order.buy_price,
              price_final: order.sell_price,
            });
            // Needs to update after the last_operation check
            order.last_operation = !order.last_operation;

            await handleRebuyFromProfit(coinIndex, profitReal);

            if (currentPrice >= order.entry_price) calculateFirstProfit(order);
          } else {
            void notifyTelegram(buyMsg);
            addCycle({
              trade_instance_id: tradeInstanceId,
              name: cfg.name,
              pair: order.pair,
              side: 'BUY',
              price: order.buy_price,
            });
          }
        }

        // We have an orderId locally, but the order is not open on the exchange.
        if (buyStatus === ORDER_STATUS_NOT_OPEN) {
          clearMissingOrder({ order, side: 'BUY', tradeOrderId: order.id, notify: true });
        }
      }
    }

    // Since we have some limits in HL to place orders and this keep creating/canceling, I'll comment this for now
    // await createReserveOrders(coinIndex, currentPrice)

    const { minPrice, maxPrice } = computeRange(pair, orders, cfg);
    consoleLog(`${timesExecuted}) New price check between ${minPrice} and ${maxPrice}`);
    if (orderFilled) {
      consoleLog(`${timesExecuted}) Order filled fast call called`);
      timeToExecute = 3000; // fast call after a fill
    } else {
      timeToExecute = 1000 * 60 * 10; // slower call when idle - 10m
    }
  } catch (e) {
    consoleLog(`${timesExecuted}) runCoins error (${pair ?? 'unknown'}): ${e?.message ?? e}`, 'red');
    timeToExecute = 60000; // retry after error
  } finally {
    checking[coinIndex] = false;
    runWithTime(coinIndex, timeToExecute);
  }
};

function calculateFeesForCycle(order, feeRatePerSide = FEE_RATE_MAKER_PER_SIDE) {
  const qty = Number(order.quantity);
  const notionalBuy = Number(order.buy_price) * qty;
  const notionalSell = Number(order.sell_price) * qty;
  return (notionalBuy * feeRatePerSide) + (notionalSell * feeRatePerSide);
}

function clearMissingOrder({ order, side, tradeOrderId, notify = false }) {
  const field = side === 'SELL' ? 'sell_order' : 'buy_order';
  const orderId = order[field];
  if (!orderId) return;

  if (notify) void notifyTelegram(`Order ${orderId} not found.`);
  void updateTradeOrder({ id: tradeOrderId, [field]: null }).catch(console.log);
  order[field] = null;
}

/**
 * Computes the nearest active BUY and SELL boundaries for a pair.
 * - minPrice: highest buy_price among rows with an active buy order
 * - maxPrice: lowest sell_price among rows with an active sell order
 *
 * @param {string} pair
 * @param {Array<object>} orders
 * @param {{ entry_price: number, exit_price: number }} cfg
 * @returns {{ minPrice: number|null, maxPrice: number|null }}
 */
function computeRange(pair, orders, cfg) {
  let maxPrice = null; // Lowest sell_price with an active sell_order
  let minPrice = null; // Highest buy_price with an active buy_order

  for (const o of orders) {
    const buy = Number(o.buy_price);
    const sell = Number(o.sell_price);

    if (hasSell(o) && Number.isFinite(sell)) {
      if (maxPrice === null || sell < maxPrice) maxPrice = sell;
    }
    if (hasBuy(o) && Number.isFinite(buy)) {
      if (minPrice === null || buy > minPrice) minPrice = buy;
    }
  }

  const execMin = Number(cfg?.execution_price_min);
  const execMax = Number(cfg?.execution_price_max);

  const result = {
    minPrice: minPrice ?? (Number.isFinite(execMin) ? execMin : null),
    maxPrice: maxPrice ?? (Number.isFinite(execMax) ? execMax : null),
  };

  rangePrices[getExchange().normalizeSymbolForPrice(pair)] = result;
  return result;
}


/**
 * Places a LIMIT order on the configured exchange.
 *
 * This is a thin wrapper around `getExchange().placeOrder()` that standardizes the
 * payload used by the bot.
 *
 * @param {object} param
 * @param {'BUY'|'SELL'} param.side - Order side.
 * @param {number|string} param.quantity - Order quantity.
 * @param {number|string} param.price - Limit price.
 * @param {string} param.symbol - Trading pair (e.g., 'BTCUSDT', 'BTC/USDC').
 * @returns {Promise<object>} Exchange order response (must include `orderId` when successful).
 */
const createOrderLimit = async (param) => {
  const { side, quantity, price, symbol } = param;

  const payload = {
    type: 'LIMIT',
    price,
    symbol,
    side,
    quantity,
  };

  return getExchange().placeOrder(payload);
};


let socketUnsubscribe = null;
let socketWatchdogInterval = null;
let socketRestarting = false;
let lastSocketTickAt = null;
let socketDropAlertSent = false;

function stopSocketPrices() {
  try {
    if (socketUnsubscribe) {
      socketUnsubscribe();
      socketUnsubscribe = null;
    }
  } catch (err) {
    consoleLog(`Error stopping socket: ${err?.message ?? err}`, 'red');
  }

  if (socketWatchdogInterval) {
    clearInterval(socketWatchdogInterval);
    socketWatchdogInterval = null;
  }

  if (wsTriggerInterval) {
    clearInterval(wsTriggerInterval);
    wsTriggerInterval = null;
  }
}

async function restartSocketPrices() {
  if (socketRestarting) return;
  socketRestarting = true;

  try {
    consoleLog('Restarting socket subscription...', 'yellow');
    stopSocketPrices();

    lastSocketTickAt = null;
    socketDropAlertSent = false;

    await sleep(1000);
    socketPrices();
  } catch (err) {
    consoleLog(`Socket restart error: ${err?.message ?? err}`, 'red');
  } finally {
    socketRestarting = false;
  }
}


// Pending WS triggers: sym → true when price crossed the grid boundary.
// The interval consumer (started in socketPrices) drains this and calls startMarket.
// Using a flag instead of enqueueing runCoins directly means any number of
// simultaneous WS callbacks (e.g. duplicate subscriptions) collapse into one trigger.
const wsTriggerPending = {};
let wsTriggerInterval = null;

/**
 * Subscribes to aggregated trade updates (price stream) for all configured pairs.
 *
 * On each price update:
 * - Updates the local/shared price cache.
 * - Triggers a market check when price crosses the active grid boundaries
 *   (minPrice / maxPrice computed from currently active orders).
 *
 * This is the "reactive" path that enables faster execution without polling.
 *
 * @returns {void}
 */
const socketPrices = () => {
  // Always clean up any existing subscription before creating a new one.
  // Prevents orphaned subscriptions if socketPrices() is ever called while one is active.
  if (socketUnsubscribe) {
    stopSocketPrices();
  }

  const allowedPairs = new Set(
      data.map((o) => getExchange().normalizeSymbolForPrice(o.pair))
  );
  const allPairs = Array.from(new Set(data.map((o) => o.pair)));

  consoleLog(`Socket listening on ${allPairs.length} markets`, 'green');

  lastSocketTickAt = Date.now();
  socketDropAlertSent = false;

  socketUnsubscribe = getExchange().subscribeAggTrades(allPairs, ({ symbol, price }) => {
    const sym = getExchange().normalizeSymbolForPrice(symbol);

    if (!allowedPairs.has(sym)) return;

    lastSocketTickAt = Date.now();
    socketDropAlertSent = false;
    const p = Number(price);
    if (!Number.isFinite(p)) return;

    prices[sym] = p;
    setPrice(sym, p);

    const range = rangePrices[sym];
    const minPrice = range?.minPrice;
    const maxPrice = range?.maxPrice;

    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return;
    if (p < minPrice || p > maxPrice) {
      if (!wsTriggerPending[sym]) {
        consoleLog(`WS trigger: price=${p} outside [${minPrice}, ${maxPrice}]`, 'yellow');
      }
      wsTriggerPending[sym] = true;
    }
  });

  // Drain pending WS triggers every 50 ms and call startMarket once per symbol.
  // Decoupling the WS callback from startMarket means any number of simultaneous
  // WS events (e.g. duplicate subscriptions) collapse into a single startMarket call.
  wsTriggerInterval = setInterval(() => {
    for (const sym of Object.keys(wsTriggerPending)) {
      delete wsTriggerPending[sym];
      const idx = pairToIndex[sym];
      if (idx != null) startMarket(idx);
    }
  }, 50);

  if (socketWatchdogInterval) {
    clearInterval(socketWatchdogInterval);
    socketWatchdogInterval = null;
  }

  socketWatchdogInterval = setInterval(async () => {
    try {
      if (!lastSocketTickAt) return;

      const diffMs = Date.now() - lastSocketTickAt;
      const diffMinutes = diffMs / 1000 / 60;

      if (diffMinutes > 10 && !socketDropAlertSent) {
        const msg = `Socket may be dropped. No price updates received for ${diffMinutes.toFixed(1)} minutes. Restarting socket.`;
        consoleLog(msg, 'red');
        socketDropAlertSent = true;

        await restartSocketPrices();
      }
    } catch (err) {
      consoleLog(`Socket watchdog error: ${err?.message ?? err}`, 'red');
    }
  }, 60 * 1000);
};

/**
 * Accumulates realized profit into a "rebuy wallet" and optionally executes a market rebuy.
 *
 * How it works:
 * - If `cfg.rebuy_profit` is enabled, profit from completed cycles is added to `cfg.rebuy_value`.
 * - When `rebuy_value` reaches the threshold (`amountToBuy`), the bot buys a fixed amount
 *   of the base asset at market and tracks the totals in:
 *   - `rebuy_value` (remaining quote reserved for future rebuys)
 *   - `rebought_value` (total quote spent on rebuys)
 *   - `rebought_coin` (total base asset acquired via rebuys)
 *
 * Notes:
 * - Updates DB and then syncs the in-memory `cfg` object.
 * - Uses a fixed quote amount per rebuy.
 *
 * @param {number} coinIndex - Index of the market configuration inside `data`.
 * @param {number|string} profitValue - Realized profit amount in quote currency for the cycle.
 * @returns {Promise<void>}
 */
async function handleRebuyFromProfit(coinIndex, profitValue) {
  try {
    const cfg = data[coinIndex];

    // Normalize types for safe arithmetic
    cfg.rebuy_profit = !!cfg.rebuy_profit;
    cfg.rebuy_value = toNum(cfg.rebuy_value, 0);
    cfg.rebought_value = toNum(cfg.rebought_value, 0);
    cfg.rebought_coin = toNum(cfg.rebought_coin, 0);

    if (!cfg.rebuy_profit) return;
    const rebuyPercent = Math.max(0, Math.min(100, toNum(cfg.rebuy_percent, 0)));
    const rebuyShare = rebuyPercent / 100;

    const profit = toNum(profitValue, 0);
    const rebuyProfitPortion = round(profit * rebuyShare, 8);

    // Add only the configured percent of profit to the rebuy wallet
    const newRebuyValue = round(cfg.rebuy_value + rebuyProfitPortion, 8);
    await updateTradeInstance({ id: cfg.id, rebuy_value: newRebuyValue });
    cfg.rebuy_value = newRebuyValue;

    const amountToBuyQuote = 15; // quote currency per rebuy (e.g., USDC/USDT)
    if (cfg.rebuy_value + 1e-9 < amountToBuyQuote) return;

    // Get latest prices so we can convert quote -> base quantity
    await updatePrices([cfg.pair]);

    const priceKey = String(cfg.pair).replace(/[\/\-_]/g, '');
    const currentPrice = toNum(prices?.[priceKey], 0);
    if (!currentPrice || currentPrice <= 0) {
      consoleLog(`Rebuy aborted: invalid currentPrice for ${cfg.pair} (key=${priceKey})`);
      return;
    }

    const qtyDecimals = Number.isFinite(Number(cfg.decimal_quantity))
        ? Number(cfg.decimal_quantity)
        : 8;

    // Convert the rebuy quote amount into base qty using current price
    const qtyToBuy = round(amountToBuyQuote / currentPrice, qtyDecimals);
    if (!qtyToBuy || qtyToBuy <= 0) {
      consoleLog(`Rebuy aborted: invalid qtyToBuy=${qtyToBuy} price=${currentPrice}`);
      return;
    }

    // Force fill using IOC price with 0.5% slippage buffer
    const slippage = 0.005; // 0.5%
    const iocPrice = Number((currentPrice * (1 + slippage)).toFixed(cfg.decimal_price));

    // Update local + DB bookkeeping immediately (fire-and-forget approach)
    // We assume: spent = amountToBuyQuote, bought = qtyToBuy
    const updatedRebuyValue = round(cfg.rebuy_value - amountToBuyQuote, 8);
    const updatedReboughtValue = round(cfg.rebought_value + amountToBuyQuote, 8);
    const updatedReboughtCoin = round(cfg.rebought_coin + qtyToBuy, 8);

    await updateTradeInstance({
      id: cfg.id,
      rebuy_value: updatedRebuyValue,
      rebought_value: updatedReboughtValue,
      rebought_coin: updatedReboughtCoin,
    });

    cfg.rebuy_value = updatedRebuyValue;
    cfg.rebought_value = updatedReboughtValue;
    cfg.rebought_coin = updatedReboughtCoin;

    let rebuyMsg = `Rebuy profit triggered: $${amountToBuyQuote.toFixed(2)} -> ${qtyToBuy.toFixed(qtyDecimals)} ${cfg.name} at ${iocPrice}`;
    consoleLog(rebuyMsg);
    void notifyTelegram(rebuyMsg);

    // Place IOC order and do not wait for/parse fills.
    // If it errors, we revert the bookkeeping.
    try {
      await getExchange().placeOrder({
        symbol: cfg.pair,
        side: 'BUY',
        type: 'MARKET',      // your adapter maps this to LIMIT + Ioc
        quantity: qtyToBuy,  // base qty
        price: iocPrice,     // aggressive price to force fill
        postOnly: false,
      });
    } catch (err) {
      // Revert accounting on failure
      const revertedRebuyValue = round(cfg.rebuy_value + amountToBuyQuote, 8);
      const revertedReboughtValue = round(cfg.rebought_value - amountToBuyQuote, 8);
      const revertedReboughtCoin = round(cfg.rebought_coin - qtyToBuy, 8);

      await updateTradeInstance({
        id: cfg.id,
        rebuy_value: revertedRebuyValue,
        rebought_value: revertedReboughtValue,
        rebought_coin: revertedReboughtCoin,
      });

      cfg.rebuy_value = revertedRebuyValue;
      cfg.rebought_value = revertedReboughtValue;
      cfg.rebought_coin = revertedReboughtCoin;

      consoleLog(`Rebuy failed (reverted): ${err?.message ?? String(err)}`);
    }
  } catch (e) {
    console.log(e?.message ?? String(e));
  }
}


/**
 * Loads bot configuration for a specific pair and instance id, then fetches initial prices.
 *
 * This function is used by CLI helpers (create/openOrders/cancelOrders/accountBalance)
 * to bootstrap the exchange client, validate the instance id, load the instance secrets,
 * and retrieve the configuration rows for the requested market.
 *
 * Side effects:
 * - Calls `setApi()` and `setInstanceId(i)`.
 * - Updates module-level `data` and `prices`.
 * - Exits the process if the instance id or instance secrets cannot be loaded.
 *
 * @param {string} pair - Trading pair to load (e.g., 'BTCUSDT').
 * @param {number|string} instance - Trade instance id.
 * @returns {Promise<Array<object>>} Configuration rows for the given pair.
 */
const loadInstance = async function(pair, instance) {
  setApi();
  setInstanceId(instance);

  if (getInstanceId() == null) {
    consoleLog('Instance ID is mandatory.');
    process.exit();
  }

  // Apply per-instance DB settings to process.env before services start
  const rawEarly = await retrieveInstance({ id: getInstanceId() }).catch(() => null);
  applyInstanceConfig(rawEarly?.[0] ?? null);

  // Load API credentials for the given instance
  await initExchange({ id: getInstanceId() }).catch((ex) => {
    consoleLog('Unable to load private_key');
    console.log(ex);
    process.exit();
  });

  // Allow the exchange client to finish initialization
  await sleep(1000);

  data = await retrieveInstance({ id: getInstanceId() }).catch((ex) => {
    console.log(ex);
    return [];
  });

  data = data.filter((o) => o.pair == pair);

  try {
    const exchangePrices = await getExchange().getPrices();
    consoleLog('Prices loaded.');
    prices = exchangePrices;
  } catch (err) {
    const details = err?.message ?? String(err);
    console.log(`Error loading initial prices: ${details}`);
  }

  return data;
};

function parseSaveFlag(save) {
  if (typeof save === 'boolean') return save;
  if (save == null) return false;
  return String(save).trim().toUpperCase() === 'YES';
}

/**
 * Starts all configured markets with a small delay between each one.
 * This reduces startup bursts and initializes the price socket once.
 *
 * @returns {Promise<void>}
 */
async function startCoinsStaggered() {
  if (!data?.length) return;

  addMessage('Bot grid initiated.');
  socketPrices();
  await sleep(1000)

  for (let idx = 0; idx < data.length; idx++) {
    const coin = data[idx];
    pairToIndex[getExchange().normalizeSymbolForPrice(coin.pair)] = idx;
    if (checking[idx] == null) checking[idx] = false;

    // Trigger once when bot is started
    await handleRebuyFromProfit(idx, 0);
    consoleLog(`Starting market ${coin.pair}`);
    startMarket(idx);

    await sleep(500);
  }

  consoleLog(`Running in ${data.length} markets`);
}

/**
 * Main bot entry point for a trade instance.
 *
 * Initializes:
 * - instance id and API client
 * - Telegram bot (polling) and startup notification
 * - instance credentials
 * - configuration and initial prices
 * - initial last price cache
 * - price socket and per-market execution loops
 *
 * @param {number|string} instance - Trade instance id.
 * @returns {Promise<void>}
 */
const start = async function(instance) {
  setInstanceId(instance);
  setApi();

  if (getInstanceId() == null) {
    console.log('Instance ID is mandatory.');
    process.exit();
  }

  // Load instance early so DB values override process.env before any service starts
  const rawEarly = await retrieveInstance({ id: getInstanceId() }).catch(() => null);
  applyInstanceConfig(rawEarly?.[0] ?? null);

  createTelegramBot({ polling: true });
  startHealthchecksPing();

  consoleLog('Retrieving coin data.');
  await initExchange({ id: getInstanceId() }).catch((ex) => {
    console.log(ex);
    console.log('Unable to load private_key');
    process.exit();
  });
  void notifyTelegram('Bot grid initiated.');

  data = await retrieveInstance({ id: getInstanceId() }).catch((ex) => {
    console.log(ex);
    return [];
  });

  consoleLog(`${data.length} coin(s) loaded.`);

  await updatePrices(data.map(o=>o.pair));

  await startCoinsStaggered();
};

/**
 * Fetches and prints all currently open orders for the configured exchange/account.
 *
 * This is a CLI helper used for quick debugging. It bootstraps the instance config
 * (credentials + initial prices) and then prints the raw open orders returned by the adapter.
 *
 * @param {number|string} instance - Trade instance id.
 * @param {string} pair - Trading pair used to load config (e.g., 'BTCUSDT').
 * @returns {Promise<void>}
 */
const openOrders = async function(instance, pair) {
  setInstanceId(instance);
  consoleLog('Checking open orders.', 'green');

  await loadInstance(pair, getInstanceId());

  try {
    const rows = await getExchange().getOpenOrders({});
    console.table(rows);
  } catch (e) {
    console.log(e?.message ?? String(e));
  }
};

/**
 * Cancels all open orders for a given market (pair) and instance.
 *
 * This is a CLI helper. It loads config for the pair to initialize credentials,
 * then cancels open orders through the exchange adapter.
 *
 * @param {number|string} instance - Trade instance id.
 * @param {string} pair - Trading pair (e.g., 'BTCUSDT').
 * @returns {Promise<void>}
 */
const cancelOrders = async function( instance, pair) {
  setInstanceId(instance);

  await loadInstance(pair, getInstanceId());

  consoleLog(`Cancelling all open orders for ${pair}...`, 'yellow');

  try {
    const res = await getExchange().cancelOpenOrders({ symbol: pair });
    consoleLog(`Cancelled ${res?.cancelled ?? 0} order(s) for ${pair}`, 'green');
  } catch (e) {
    consoleLog(`Error cancelling open orders for ${pair}: ${e?.message ?? String(e)}`, 'red');
  }
};

/**
 * CLI usage examples:
 *
 * - Start bot (runs the grid engine):
 *   npm run start -- <instanceId>
 *
 * - List open orders (raw adapter output):
 *   npm run openOrders -- <instanceId> <pair>
 *
 * - Cancel open orders for a pair:
 *   npm run cancelOrders -- <instanceId> <pair>
 */
export {
  start,
  openOrders,
  cancelOrders
};
