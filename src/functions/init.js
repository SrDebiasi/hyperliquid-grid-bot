/* eslint-disable no-unused-vars */
/* eslint-disable no-unreachable */
import {
  setApi,
  getExchange,
  retrieveConfig,
  retrieveInstance,
  saveTradeOrder,
  retrieveOrders,
  updateTradeOrder,
  updateTradeConfig,
  addProfit,
  addMessage,
  consoleLog,
  startHealthchecksPing,
} from './functions.js';

import { setPrices, setPrice, getInstanceId, setInstanceId, setLastOperation } from './state.js';
import { notifyTelegram, createTelegramBot } from './services/telegramService.js';
import {FEE_RATE_MAKER_PER_SIDE} from "./fees.js";

let wallet = null;
let enable = true;
let checking = [];
let timesExecuted = 0;
let lastPrices = [];
let prices = [];
let data = [];
let rangePrices = [];

const ORDER_STATUS_NOT_OPEN = 'NOT_OPEN_NO_FILL';
const ORDER_STATUS_FILLED = 'FILLED';
const ORDER_STATUS_OPEN = 'OPEN';

const QUOTE_ASSET = process.env.QUOTE_ASSET || 'USDC';
const BLOCK_USD_BUFFER = Number(process.env.BLOCK_USD_BUFFER ?? 50);
const BALANCE_SYNC_DELAY_MS = 700;

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
  void runCoins(coinIndex).catch((ex) => consoleLog(ex?.toString?.() ?? String(ex), 'red'));
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
 * Cancels the current "order block" (USDT-blocking BUY limit order) for a market, if present.
 *
 * The order block is used to reserve free USDT (by placing a BUY limit) so the bot does not
 * accidentally use that capital for grid orders. When the bot needs liquidity for a new grid
 * order, it cancels the block and clears `order_block_id` both in the database and in memory.
 *
 * @param {number} coinIndex - Index of the market configuration inside `data`.
 * @returns {Promise<void>}
 */
async function cancelOrderBlock(coinIndex) {
  if (!data[coinIndex].order_block_id) return;

  consoleLog(`Cancelling block order ${data[coinIndex].order_block_id}`);
  try {
    await getExchange().cancelOrder({
      orderId: data[coinIndex].order_block_id,
      symbol: data[coinIndex].pair,
    });
  } catch (e) {
    const details = e?.message ?? String(e);
    console.log(`Error cancelling block order: ${details}`);
  }

  try {
    await updateTradeConfig({
      trade_instance_id: data[coinIndex].trade_instance_id,
      pair: data[coinIndex].pair,
      order_block_id: null,
    });

    // Keep local cache consistent with the database
    data[coinIndex].order_block_id = null;
  } catch (e) {
    const details = e?.message ?? String(e);
    console.log(`Error clearing block order in DB: ${details}`);
  }
}


function getQuoteBalance() {
  return wallet?.find((o) => o.asset === QUOTE_ASSET) ?? null;
}

/**
 * Creates a "quote block" BUY LIMIT order to reserve free quote balance (e.g., USDC).
 *
 * This helps prevent the bot from allocating all free quote balance to grid orders.
 * It cancels any previous block order, optionally runs rebuy, refreshes balances,
 * then places a BUY LIMIT at `order_block_price` using available funds minus a buffer.
 *
 * @param {number} coinIndex
 * @returns {Promise<void>}
 */
async function createOrderBlock(coinIndex) {
  await balanceCheck();

  const cfg = data[coinIndex];
  const quote = getQuoteBalance();
  if (!quote) return;

  const freeQuote = Number(quote.free);
  const spendable = freeQuote - BLOCK_USD_BUFFER;

  if (spendable <= 0) {
    consoleLog(`Not enough ${QUOTE_ASSET} to block. free=${freeQuote.toFixed(2)}`);
    return;
  }

  await cancelOrderBlock(coinIndex);

  // Optional: rebuy may change available quote balance
  await sleep(BALANCE_SYNC_DELAY_MS);
  await handleRebuyFromProfit(coinIndex, 0);
  await sleep(BALANCE_SYNC_DELAY_MS);

  await balanceCheck();

  const quoteAfter = getQuoteBalance();
  if (!quoteAfter) return;

  const freeAfter = Number(quoteAfter.free);
  const spendableAfter = freeAfter - BLOCK_USD_BUFFER;

  if (spendableAfter <= 0) {
    consoleLog(`Not enough ${QUOTE_ASSET} to block after rebuy. free=${freeAfter.toFixed(2)}`);
    return;
  }

  const blockPrice = Number(cfg.order_block_price);
  if (!Number.isFinite(blockPrice) || blockPrice <= 0) {
    consoleLog(`Invalid order_block_price: ${cfg.order_block_price}`, 'red');
    return;
  }

  const quantity = truncate(spendableAfter / blockPrice, cfg.decimal_quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    consoleLog(`Invalid block quantity calculated: ${quantity}`, 'red');
    return;
  }

  consoleLog(
    `Placing ${QUOTE_ASSET} reserve order at ${blockPrice} for ${quantity} units (available balance: ${spendableAfter.toFixed(2)})`,
  );

  let newOrder;
  try {
    newOrder = await createOrderLimit({
      side: 'BUY',
      quantity,
      price: blockPrice,
      symbol: cfg.pair,
    });
  } catch (e) {
    const details = e?.message ?? String(e);
    console.log(`Error creating block order: ${details}`);
    return;
  }

  const blockOrderId = newOrder?.orderId;
  if (!blockOrderId) return;

  try {
    await updateTradeConfig({ id: cfg.id, order_block_id: blockOrderId });
    cfg.order_block_id = blockOrderId; // keep local cache consistent
    consoleLog(`Updated order_block_id to ${blockOrderId}`);
  } catch (e) {
    const details = e?.message ?? String(e);
    console.log(`Error saving block order in DB: ${details}`);
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
  consoleLog(`Creating a ${String(side).toLowerCase()} order at ${price}`);
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
const updatePrices = async function() {
  try {
    const exchangePrices = await getExchange().getPrices();
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
  const above = []; // Orders above current price (SELL side)
  const below = []; // Orders below current price (BUY side)

  const execMin = coinData.execution_price_min
    ? parseFloat(coinData.execution_price_min)
    : null;

  const execMax = coinData.execution_price_max
    ? parseFloat(coinData.execution_price_max)
    : null;

  for (const o of orders) {
    const buy = parseFloat(o.buy_price);
    const sell = parseFloat(o.sell_price);

    const buyAllowed = !execMin || buy >= execMin;
    const sellAllowed = !execMax || sell <= execMax;

    // below price
    if (buy <= currentPrice && buyAllowed) {
      below.push(o);
    }

    // above price
    if (sell >= currentPrice && sellAllowed) {
      above.push(o);
    }
  }

  below.sort((a, b) => b.buy_price - a.buy_price);   // maior BUY mais perto
  above.sort((a, b) => a.sell_price - b.sell_price); // menor SELL mais perto

  const selectedBelow = below.slice(0, limit);
  const selectedAbove = above.slice(0, limit);

  const selected = [...selectedBelow, ...selectedAbove];
  const selectedIds = new Set(selected.map(o => o.id));

  if (cleanup) {
    for (const o of orders) {
      if (selectedIds.has(o.id)) continue;

      try {
        if (o.buy_order) {
          consoleLog(`Cancel BUY order ${o.buy_order}`);
          const orderInfo = await getExchange().getOrder({ orderId: o.buy_order });

          if (orderInfo.status === ORDER_STATUS_OPEN) {
            await getExchange().cancelOrder({
              orderId: o.buy_order,
              symbol: coinData.pair,
            });
            await new Promise(r => setTimeout(r, 120));
          }
        }
        if (o.sell_order) {
          consoleLog(`Cancel SELL order ${o.sell_order}`);
          const orderInfo = await getExchange().getOrder({ orderId: o.sell_order });

          if (orderInfo.status === ORDER_STATUS_OPEN) {
            await getExchange().cancelOrder({
              orderId: o.sell_order,
              symbol: coinData.pair,
            });
            await new Promise(r => setTimeout(r, 120));
          }
        }
      } catch (e) {
        console.log('Cancel error:', e);
      }

      try {
        await updateTradeOrder({
          id: o.id,
          buy_order: null,
          sell_order: null,
        });
      } catch (e) {
        console.log('DB cleanup error:', e);
      }
    }
  }

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
 * Loads grid orders from the database and optionally performs cleanup.
 *
 * Cleanup is intentionally NOT executed on every loop iteration to avoid excessive
 * exchange/API calls. It runs only on the first execution and then every N cycles.
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
  consoleLog(`Loaded ${orders.length} total orders from DB`);

  const CLEANUP_EVERY = 100; // run cleanup on first loop and then every N cycles
  const shouldCleanup = timesExecuted === 1 || timesExecuted % CLEANUP_EVERY === 0;

  const limit = shouldCleanup ? ORDERS_WINDOW_CLEANUP : ORDERS_WINDOW_DEFAULT;

  const filtered = await filterAndCleanupOrders(orders, currentPrice, cfg, limit, shouldCleanup);
  consoleLog(`Filtered to ${filtered.length} orders around price`);

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
  data = await retrieveConfig({ trade_instance_id: getInstanceId() }).catch((ex) => console.log(ex));

  const cfg = data[coinIndex];
  const pair = cfg.pair;
  const tradeInstanceId = cfg.trade_instance_id;
  const dp = cfg.decimal_price;
  const dq = cfg.decimal_quantity;

  // Skip execution if the bot is disabled or the market is not ready to be checked yet.
  if (!enable || !checking[pair]) {
    runWithTime(coinIndex, 5000);
    return;
  }

  timesExecuted++;

  await updatePrices();

  const priceKey = String(pair).replace(/[\/\-_]/g, '');
  const currentPrice = prices[priceKey];

  consoleLog(`Current price: ${Number(currentPrice).toFixed(dp)}`);
  lastPrices[priceKey] = currentPrice;

  const orders = await loadAndFilterOrders({
    pair,
    tradeInstanceId,
    currentPrice,
    cfg,
    timesExecuted,
  });

  let orderFilled = false;
  let timeToExecute = 20000;

  try {
    for (const order of orders) {
      await sleep(100);

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
            `${order.last_side ? `Last side ${order.last_side}` : 'No last side'}, creating ${side} at ${price}`,
          );

          await cancelOrderBlock(coinIndex);

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
        const orderInfo = await getExchange().getOrder({ orderId: order.sell_order });

        if (orderInfo.status === ORDER_STATUS_FILLED) {
          orderFilled = true;
          setLastOperation(pair);

          const sellMsg = `Sell order filled ${order.sell_order} at ${order.sell_price}`;
          consoleLog(sellMsg, 'yellow');

          const quantityToBuy = parseFloat(order.quantity);

          consoleLog(`Creating BUY limit order at ${order.buy_price}`);
          await cancelOrderBlock(coinIndex);

          const newOrder = await createOrderLimit({
            side: 'BUY',
            quantity: quantityToBuy,
            price: order.buy_price,
            symbol: order.pair,
          });

          // Persist and update in-memory state
          void updateTradeOrder({
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
              target_percent: cfg.target_percent,
              price_intermediate: order.buy_price,
              price_final: order.sell_price,
            });

            await handleRebuyFromProfit(coinIndex, profitReal);
          } else {
            void notifyTelegram(sellMsg);
          }
          // Needs to update after the last_operation check
          order.last_operation = !order.last_operation;

          if (currentPrice >= order.entry_price) calculateFirstProfit(order);
        }

        // We have an orderId locally, but the order is not open on the exchange.
        if (orderInfo.status === ORDER_STATUS_NOT_OPEN) {
          void updateTradeOrder({ id: order.id, sell_order: null }).catch((ex) => console.log(ex));
          order.sell_order = null;
        }
      }

      // Existing BUY order path
      if (hasBuy(order)) {
        const orderInfo = await getExchange().getOrder({ orderId: order.buy_order });

        if (orderInfo.status === ORDER_STATUS_FILLED) {
          orderFilled = true;
          setLastOperation(pair);

          const buyMsg = `Buy order filled ${order.buy_order} at ${order.buy_price}`;
          const quantityToSell = parseFloat(order.quantity);

          consoleLog(buyMsg, 'yellow');

          consoleLog(`Creating SELL limit order at ${order.sell_price}`);
          await cancelOrderBlock(coinIndex);

          const newOrder = await createOrderLimit({
            side: 'SELL',
            quantity: quantityToSell,
            price: order.sell_price,
            symbol: order.pair,
          });

          // Persist and update in-memory state
          void updateTradeOrder({
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
              name: data[coinIndex].name,
              pair: order.pair,
              profit: 'BUY',
              value: profitReal,
              target_percent: data[coinIndex].target_percent,
              price_intermediate: order.buy_price,
              price_final: order.sell_price,
            });
            // Needs to update after the last_operation check
            order.last_operation = !order.last_operation;

            await handleRebuyFromProfit(coinIndex, profitReal);

            if (currentPrice >= order.entry_price) calculateFirstProfit(order);
          } else {
            void notifyTelegram(buyMsg);
          }
        }

        // We have an orderId locally, but the order is not open on the exchange.
        if (orderInfo.status === ORDER_STATUS_NOT_OPEN) {
          void notifyTelegram(`Order ${order.buy_order} not found.`);

          void updateTradeOrder({ id: order.id, buy_order: null }).catch((ex) => console.log(ex));
          order.buy_order = null;
        }
      }
    }

    const { minPrice, maxPrice } = computeRange(pair, orders, cfg);
    consoleLog(`New price check between ${minPrice} and ${maxPrice}`);

    await createOrderBlock(coinIndex);
    if (orderFilled) {
      timeToExecute = 3000; // fast call after a fill
    } else {
      timeToExecute = 1000 * 60 * 3; // slower call when idle
    }
  } catch (e) {
    consoleLog(`runCoins error (${pair ?? 'unknown'}): ${e?.message ?? e}`, 'red');
    timeToExecute = 60000; // retry after error
  } finally {
    if (pair) {
      checking[pair] = false;
      setTimeout(() => {
        checking[pair] = true;
      }, timeToExecute);
    }
    runWithTime(coinIndex, timeToExecute);
  }
};

/**
 * Computes the nearest active BUY and SELL boundaries for a pair.
 * - minPrice: highest buy_price among rows with an active buy order
 * - maxPrice: lowest sell_price among rows with an active sell order
 *
 * Fallback:
 * - If minPrice is null, use cfg.entry_price
 * - If maxPrice is null, use cfg.exit_price
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

  // Fallback to configured range if no active boundaries exist
  const fallbackMin = Number(cfg?.entry_price);
  const fallbackMax = Number(cfg?.exit_price);

  const result = {
    minPrice: minPrice ?? (Number.isFinite(fallbackMin) ? fallbackMin : null),
    maxPrice: maxPrice ?? (Number.isFinite(fallbackMax) ? fallbackMax : null),
  };

  rangePrices[pair] = result;
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
  const allPairs = Array.from(new Set(data.map((o) => o.pair)));

  consoleLog(`Socket listening on ${allPairs.length} markets`, 'green');

  getExchange().subscribeAggTrades(allPairs, ({ symbol, price }) => {
    const { minPrice, maxPrice } = rangePrices[symbol] ?? {};
    if (minPrice == null || maxPrice == null) return;

    const priceKey = String(symbol).replace(/[\/\-_]/g, '');
    prices[priceKey] = price;
    setPrice(symbol, price);

    try {
      if (!checking[symbol] && (price >= maxPrice || price <= minPrice)) {
        consoleLog(
          `Triggering check: price=${price} outside range [${minPrice}, ${maxPrice}]`,
        );
        checking[symbol] = true;
      }
    } catch (e) {
      const details = e?.message ?? String(e);
      consoleLog(`Error evaluating price trigger for ${symbol}: ${details}`);
    }
  });
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

    consoleLog(`Testing rebuy: ${cfg.rebuy_profit ? 'true' : 'false'}`);
    if (!cfg.rebuy_profit) return;

    const profit = toNum(profitValue, 0);
    if (profit <= 0) return;

    // Add profit to the rebuy wallet
    const newRebuyValue = round(cfg.rebuy_value + profit, 8);
    consoleLog(`newRebuyValue ${newRebuyValue}`);

    await updateTradeConfig({ id: cfg.id, rebuy_value: newRebuyValue });
    cfg.rebuy_value = newRebuyValue;

    const amountToBuy = 10; // Quote currency amount per rebuy (e.g., USDC/USDT)
    if (cfg.rebuy_value + 1e-9 < amountToBuy) {
      consoleLog(`Not enough profit to rebuy. rebuy_value=${cfg.rebuy_value.toFixed(8)}`);
      return;
    }

    consoleLog(`Rebuy triggered: buying $${amountToBuy.toFixed(2)} of ${cfg.name}`);

    const order = await getExchange().placeOrder({
      symbol: cfg.pair,
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: amountToBuy.toFixed(2),
    });

    const qtyBought = toNum(order.executedQty, 0);
    const quoteSpent = toNum(order.cummulativeQuoteQty, amountToBuy);

    // Update values (numeric, rounded)
    const updatedRebuyValue = round(cfg.rebuy_value - quoteSpent, 8);
    const updatedReboughtValue = round(cfg.rebought_value + quoteSpent, 8);
    const updatedReboughtCoin = round(cfg.rebought_coin + qtyBought, 8);

    await updateTradeConfig({
      id: cfg.id,
      rebuy_value: updatedRebuyValue,
      rebought_value: updatedReboughtValue,
      rebought_coin: updatedReboughtCoin,
    });

    cfg.rebuy_value = updatedRebuyValue;
    cfg.rebought_value = updatedReboughtValue;
    cfg.rebought_coin = updatedReboughtCoin;

    consoleLog(
      `Rebuy completed: bought ${qtyBought.toFixed(8)} ${cfg.name} (spent ${quoteSpent.toFixed(2)} quote)`,
    );
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
const loadConfig = async function(pair, instance) {
  setApi();
  setInstanceId(instance);

  if (getInstanceId() == null) {
    consoleLog('Instance ID is mandatory.');
    process.exit();
  }

  // Load API credentials for the given instance
  await retrieveInstance({ id: getInstanceId() }).catch((ex) => {
    consoleLog('Unable to load private_key');
    console.log(ex);
    process.exit();
  });

  // Allow the exchange client to finish initialization
  await sleep(1000);

  data = await retrieveConfig({ pair, trade_instance_id: getInstanceId() }).catch((ex) => {
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
 * Builds grid configuration rows for a given market and optionally persists them in the database.
 *
 * This is primarily a CLI utility:
 * - Generates buy/sell levels from entry_price to exit_price using margin_percent and target_percent.
 * - Prints a table of generated levels.
 * - Estimates required capital for uptrend/downtrend scenarios.
 * - If `save` is enabled, inserts each generated row in the DB via `saveTradeOrder`.
 *
 * Backward compatibility:
 * - `save` can be boolean (true/false) or string ("YES"/"NO").
 *
 * @param {number|string} instance - Trade instance id.
 * @param {string} pair - Trading pair to generate grid for (e.g., 'BTCUSDT').
 * @param {boolean|string} save - Whether to persist generated rows (true/"YES" to save).
 * @returns {Promise<void>}
 */
const create = async function(instance, pair, save) {
  setInstanceId(instance);

  const shouldSave = parseSaveFlag(save);
  const cfgRows = await loadConfig(pair, getInstanceId());
  for (const c of cfgRows) {
    consoleLog(`Creating configuration for ${pair}`);
    if (shouldSave) await sleep(10);
    const records = [];
    let buyPrice = parseFloat(c.entry_price);
    let sellPrice = buyPrice + (buyPrice * c.target_percent) / 100;
    const priceKey = String(pair).replace(/[\/\-_]/g, '');
    const currentPrice = prices[priceKey];
    let sumQuantityCoin = 0; // Base asset required if price trends up (e.g., BTC)
    let sumQuantityUsd = 0;  // Quote required if price trends down (e.g., USDC/USDT)
    while (sellPrice < parseFloat(c.exit_price)) {
      if (shouldSave) await sleep(10);
      const quantity = parseFloat((c.usd_transaction / buyPrice).toFixed(c.decimal_quantity));
      if (sellPrice > currentPrice) sumQuantityCoin += quantity;
      else sumQuantityUsd += 1;
      records.push({
        buy_price: buyPrice,
        sell_price: sellPrice,
        quantity,
      });
      if (shouldSave) {
        void saveTradeOrder({
          pair: c.pair,
          buy_price: buyPrice.toFixed(c.decimal_price),
          sell_price: sellPrice.toFixed(c.decimal_price),
          quantity,
          entry_price: currentPrice,
          last_operation: false,
          trade_instance_id: getInstanceId(),
        }).catch((ex) => console.log(ex));
      }
      // Next grid level
      buyPrice = buyPrice + (buyPrice * c.margin_percent) / 100;
      sellPrice = buyPrice + (buyPrice * c.target_percent) / 100;
    }
    console.table(records);
    consoleLog(`Finished ${pair} working between ${c.entry_price} and ${c.exit_price}`);
    consoleLog(
      `Total ${records.length} records | target=${c.target_percent}% | spacing=${c.margin_percent}% | usd_per_order=${c.usd_transaction}`,
    );
    const totalCoinUsd = sumQuantityCoin * currentPrice;
    consoleLog(
      `Current ${c.name} price ${currentPrice} | base_needed=${sumQuantityCoin.toFixed(6)} | base_value_usd=${totalCoinUsd.toFixed(2)}`,
    );
    consoleLog(
      `Quote needed for downtrend: ${(sumQuantityUsd * c.usd_transaction).toFixed(2)} USD`,
    );
    const sellValueIfRangeTop = sumQuantityCoin * parseFloat(c.exit_price);
    const buyValueToday = sumQuantityCoin * currentPrice;
    const profitIfSoldAtTop = sellValueIfRangeTop - buyValueToday;
    consoleLog(
      `Profit if buying required amount today and selling at exit (${c.exit_price}): ${profitIfSoldAtTop.toFixed(2)} USD`,
    );
    consoleLog(` - Buy value today: ${buyValueToday.toFixed(2)} USD`);
    consoleLog(` - Sell value at range top: ${sellValueIfRangeTop.toFixed(2)} USD`);
    const orderValue = Number(c.usd_transaction);
    const grossProfitPerOp = orderValue * (Number(c.target_percent) / 100);
    // Note: this is an estimate; fee model depends on venue and maker/taker behavior.
    const exchangeFees = orderValue * 0.0015;
    const netProfitPerOp = grossProfitPerOp - exchangeFees;
    consoleLog(`Gross profit per operation: ${grossProfitPerOp.toFixed(2)} USD`);
    consoleLog(`Estimated fees per operation: ${exchangeFees.toFixed(2)} USD`);
    consoleLog(`Estimated net profit per operation: ${netProfitPerOp.toFixed(2)} USD`);
    consoleLog(`Estimated total USD needed: ${(sumQuantityUsd * c.usd_transaction + totalCoinUsd).toFixed(2)}`);
  }
};

/**
 * Boots the bot runtime for a given instance id (dev/CLI helper).
 *
 * This helper is mainly used to validate that:
 * - instance credentials can be loaded
 * - exchange client is reachable
 * - prices can be fetched
 * - Telegram notifications are working
 *
 * It intentionally does not start the full grid loop; it only initializes dependencies.
 *
 * @param {number|string} i - Trade instance id.
 * @returns {Promise<void>}
 */
const startBot = async function(instance) {
  setInstanceId(instance);
  setApi();

  // Allow the exchange client to finish initialization
  await sleep(1000);

  await retrieveInstance({ id: getInstanceId() }).catch((ex) => {
    consoleLog('Unable to load private_key');
    console.log(ex);
    process.exit();
  });

  await updatePrices();

  createTelegramBot({ polling: true });
  void notifyTelegram('Grid bot initialized telegram interface.');
};

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

  for (let idx = 0; idx < data.length; idx++) {
    const coin = data[idx];

    if (checking[coin.pair] == null) checking[coin.pair] = true;

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

  createTelegramBot({ polling: true });

  startHealthchecksPing()
  if (getInstanceId() == null) {
    console.log('Instance ID is mandatory.');
    process.exit();
  }
  consoleLog('Retrieving coin data.');
  await retrieveInstance({ id: getInstanceId() }).catch((ex) => {
    console.log(ex);
    console.log('Unable to load private_key');
    process.exit();
  });
  void notifyTelegram('Bot grid initiated.');

  data = await retrieveConfig({ id: getInstanceId() }).catch((ex) => {
    console.log(ex);
    return [];
  });

  consoleLog(`${data.length} coin(s) loaded.`);

  await updatePrices();

  for (const c of data) {
    const priceKey = String(c.pair).replace(/[\/\-_]/g, '');
    lastPrices[priceKey] = prices[priceKey];
  }

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

  await loadConfig(pair, getInstanceId());

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

  await loadConfig(pair, getInstanceId());

  consoleLog(`Cancelling all open orders for ${pair}...`, 'yellow');

  try {
    const res = await getExchange().cancelOpenOrders({ symbol: pair });
    consoleLog(`Cancelled ${res?.cancelled ?? 0} order(s) for ${pair}`, 'green');
  } catch (e) {
    consoleLog(`Error cancelling open orders for ${pair}: ${e?.message ?? String(e)}`, 'red');
  }
};


const test = async function(instance) {
  setInstanceId(instance);
  addProfit({
    trade_instance_id: 1,
    name: 'btc',
    pair: 'btc/usdc',
    profit: 'BUY',
    value: 1,
    target_percent: 1.8,
    price_intermediate: 65000,
    price_final: 65000,
  });
};

/**
 * CLI usage examples:
 *
 * - Start bot (runs the grid engine):
 *   npm run start -- <instanceId>
 *
 * - Create grid rows (dry-run / print only):
 *   npm run create -- <instanceId> <pair>  false
 *
 * - Create grid rows (persist to DB):
 *   npm run create -- <instanceId> <pair>  true
 *
 * - List open orders (raw adapter output):
 *   npm run openOrders -- <instanceId> <pair>
 *
 * - Cancel open orders for a pair:
 *   npm run cancelOrders -- <instanceId> <pair>
 */
export {
  start,
  create,
  test,
  openOrders,
  cancelOrders,
  startBot,
};
