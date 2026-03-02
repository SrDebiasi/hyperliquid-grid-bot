import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import moment from 'moment-timezone';

import { DateTime } from 'luxon';
import { calcExposureFromOrders } from '../reports/exposureService.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

const BOT_TZ = process.env.BOT_TZ || 'America/Edmonton';

if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
if (!chatId) throw new Error('Missing TELEGRAM_CHAT_ID');

import {
  getExchange,
  retrieveConfig,
  retrieveOrders,
  retrieveTradeProfit,
} from '../functions/functions.js';
import { getInstanceId, getLastOperation } from '../functions/state.js';

import {
  periodDay,
  periodWeek,
  periodMonth,
  periodMonthToDate,
  periodPreviousDay,
  periodPreviousWeek,
  periodPreviousMonth,
  periodYear,
} from '../functions/datePeriods.js';

function mustGetTelegramToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  return token;
}

function isAllowedChat(msg) {
  return String(msg.chat.id) === chatId;
}

function eM(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function formatUSD(value) {
  const n = Number(value || 0);
  return `$${n.toFixed(2)}`;
}

function formatNumber(value, decimals = 8) {
  const n = Number(value || 0);
  return n.toFixed(decimals);
}

function toNumberSafe(v) {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Bucket a row into a BOT_TZ local day.
 * Prefers date_transaction if present.
 */
function rowLocalDay(row) {
  const raw = row?.date_transaction;
  if (!raw) return null;

  // If it's already a Date, treat it as an instant and convert to BOT_TZ for bucketing
  if (raw instanceof Date) {
    const dt = DateTime.fromJSDate(raw, { zone: 'utc' }).setZone(BOT_TZ);
    return dt.isValid ? dt.toFormat('yyyy-LL-dd') : null;
  }

  const s = String(raw).trim();

  // ISO (with Z / offset)
  if (s.includes('T') || /[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) {
    let dt = DateTime.fromISO(s, { setZone: true });
    if (!dt.isValid) dt = DateTime.fromSQL(s, { setZone: true });
    if (!dt.isValid) return null;
    return dt.setZone(BOT_TZ).toFormat('yyyy-LL-dd');
  }

  // SQL-ish "YYYY-MM-DD HH:mm:ss(.sss...)" -> assume BOT_TZ local wall time
  const noMicros = s.replace(/\.\d{1,6}$/, '');
  let dt = DateTime.fromFormat(noMicros, 'yyyy-LL-dd HH:mm:ss', { zone: BOT_TZ });
  if (!dt.isValid) dt = DateTime.fromSQL(noMicros, { zone: BOT_TZ });
  if (!dt.isValid) return null;

  return dt.toFormat('yyyy-LL-dd');
}

function groupProfitByDay(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const map = new Map(); // ymd -> { total, count }

  for (const r of list) {
    const v = Number(r?.value || 0);
    const day = rowLocalDay(r) ?? 'unknown';

    const cur = map.get(day) || { total: 0, count: 0 };
    cur.total += v;
    cur.count += 1;
    map.set(day, cur);
  }

  const days = Array.from(map.entries())
      .filter(([date]) => date !== 'unknown')
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, x]) => ({ date, total: x.total, count: x.count }));

  const monthTotal = days.reduce((acc, d) => acc + d.total, 0);
  const monthCount = days.reduce((acc, d) => acc + d.count, 0);

  return { days, monthTotal, monthCount };
}

function buildDailyProfitMessage({ period, days, monthTotal, monthCount }) {
  const lines = [
    `*${eM('Daily profit (month-to-date)')}*`,
    `${eM(period.label)}`,
    `${eM('Range')}: *${eM(period.from)}* ${eM('to')} *${eM(period.to)}*`,
    ``,
    `*${eM('Days')}*`,
    ...days.map(
        d =>
            `${eM('•')} *${eM(d.date)}*: *${eM(formatUSD(d.total))}* \\(${eM(
                String(d.count),
            )} ${eM('trades')}\\)`,
    ),
    ``,
    `*${eM('Month-to-date total')}*: *${eM(formatUSD(monthTotal))}* \\(${eM(
        String(monthCount),
    )} ${eM('trades')}\\)`,
  ];

  return lines.join('\n');
}

async function getProfitTotalForPeriod(periodFn) {
  const instanceId = getInstanceId();
  const period = periodFn();

  const rows = await retrieveTradeProfit({
    trade_instance_id: instanceId,
    date_start: period.from,
    date_end: period.to,
  });

  const { total, count } = sumProfit(rows);
  return { period, total, count };
}

function pctOrZero(numerator, denominator) {
  if (!denominator || denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}


async function getAggregatedStatusSnapshot() {
  const instanceId = getInstanceId();

  // config
  let cfg = await retrieveConfig({ trade_instance_id: instanceId });
  cfg = cfg?.[0];
  if (!cfg?.pair) throw new Error('Missing pair in config');

  // price
  const exchangePrices = await getExchange().getPrices();
  const currentPrice = toNumberSafe(
      exchangePrices[cfg.pair] ?? exchangePrices[cfg.pair.replace('/', '')],
  );

  // orders
  const orders =
      (await retrieveOrders({
        pair: cfg.pair,
        trade_instance_id: instanceId,
      })) || [];

  const waitingCycles = orders.filter(o => o.last_operation == true).length;

  // exposure (open capital)
  const exposure = calcExposureFromOrders(orders, currentPrice);

  // expected range (from orders)
  const expectedRange = getExpectedRangeFromOrders(orders);

  let buyPct = null;
  let sellPct = null;

  if (expectedRange.highestBuy) {
    buyPct = ((currentPrice - expectedRange.highestBuy) / currentPrice) * 100; // down
  }
  if (expectedRange.lowestSell) {
    sellPct = ((expectedRange.lowestSell - currentPrice) / currentPrice) * 100; // up
  }

  // position in total grid range
  const rangeMin = toNumberSafe(cfg.entry_price);
  const rangeMax = toNumberSafe(cfg.exit_price);

  let gridPositionPct = null;
  if (rangeMax > rangeMin) {
    gridPositionPct =
        ((currentPrice - rangeMin) / (rangeMax - rangeMin)) * 100;
    gridPositionPct = Math.max(0, Math.min(100, gridPositionPct));
  }

  // profits
  const today = await getProfitTotalForPeriod(periodDay);
  const month = await getProfitTotalForPeriod(periodMonth);

  // estimate (month)
  const mtd = await getProfitTotalForPeriod(periodMonthToDate);
  const daysElapsed = Number(mtd.period?.meta?.dayOfMonth || 0);
  const daysInMonth = Number(mtd.period?.meta?.daysInMonth || 0);

  const avgPerDay = daysElapsed > 0 ? mtd.total / daysElapsed : 0;
  const estMonth = daysInMonth > 0 ? avgPerDay * daysInMonth : 0;

  // pnl % based on exposure
  const pnlCurrentMonthPct = pctOrZero(month.total, exposure.totalExposureUsd);
  const pnlEstimateMonthPct = pctOrZero(estMonth, exposure.totalExposureUsd);

  // last operation date (from state)
  const lastOpAt = getLastOperation(cfg.pair);

  return {
    isRunning: true,
    symbol: cfg.pair,
    rangeMin,
    rangeMax,
    currentPrice,
    gridPositionPct,
    waitingCycles,
    rebuyActive: cfg.rebuy_profit,
    rebuyPercent: cfg.rebuy_percent,
    expectedRange,
    buyPct,
    sellPct,
    lastOpAt,
    totalReboughtValueUsd: toNumberSafe(cfg.rebought_value),
    totalReboughtCoin: toNumberSafe(cfg.rebought_coin),
    profitTodayUsd: today.total,
    profitMonthUsd: month.total,
    estimateMonthUsd: estMonth,
    exposureTotalUsd: exposure.totalExposureUsd,
    pnlCurrentMonthPct,
    pnlEstimateMonthPct,
  };
}

function formatDateTime(d) {
  if (!d) return 'N/A';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return 'N/A';
  return dt.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function getExpectedRangeFromOrders(orders) {
  const list = Array.isArray(orders) ? orders : [];

  const hasBuyOrder = o => !!o.buy_order;
  const hasSellOrder = o => !!o.sell_order;

  let highestBuy = null;
  let lowestSell = null;

  for (const o of list) {
    const buy = toNumberSafe(o.buy_price);
    if (hasBuyOrder(o) && buy > 0 && (highestBuy === null || buy > highestBuy)) {
      highestBuy = buy;
    }

    const sell = toNumberSafe(o.sell_price);
    if (
        hasSellOrder(o) &&
        sell > 0 &&
        (lowestSell === null || sell < lowestSell)
    ) {
      lowestSell = sell;
    }
  }

  return { highestBuy, lowestSell };
}

function buildStatusMessage(snapshot) {
  const {
    isRunning,
    symbol,
    rangeMin,
    rangeMax,
    currentPrice,
    gridPositionPct = null,
    waitingCycles,

    expectedRange = {},
    buyPct = null,
    sellPct = null,

    lastOpAt = null,

    profitTodayUsd = 0,
    profitMonthUsd = 0,
    estimateMonthUsd = 0,
    exposureTotalUsd = 0,
    pnlCurrentMonthPct = 0,
    pnlEstimateMonthPct = 0,
    rebuyActive = false,
    rebuyPercent = 0,

    totalReboughtValueUsd,
    totalReboughtCoin,
  } = snapshot;

  const avgPrice =
    totalReboughtCoin > 0 ? (totalReboughtValueUsd / totalReboughtCoin) : 0;

  const currentValue =
    totalReboughtCoin > 0 ? (totalReboughtCoin * currentPrice) : 0;

  const rebuyPnlUsd = currentValue - totalReboughtValueUsd;

  const rebuyPnlPct =
    totalReboughtValueUsd > 0 ? (rebuyPnlUsd / totalReboughtValueUsd) * 100 : 0;

  const rebuyUsdSign = rebuyPnlUsd >= 0 ? '+' : '-';
  const rebuyPctSign = rebuyPnlPct >= 0 ? '+' : '-';

  const curPctSign = pnlCurrentMonthPct >= 0 ? '+' : '-';
  const estPctSign = pnlEstimateMonthPct >= 0 ? '+' : '-';

  const fmtPct = (v) => (v === null ? eM('N/A') : eM(v.toFixed(2) + '%'));
  const fmtGridPos = (v) => (v === null ? eM('N/A') : eM(v.toFixed(1) + '%'));

  const expBuy = expectedRange.highestBuy ?? null;
  const expSell = expectedRange.lowestSell ?? null;
  const rebuyLabel = rebuyActive ? 'Yes' : 'No';
  const pctLabel = Number(rebuyPercent).toFixed(0);


  const lines = [
    `*${eM('Grid bot status')}*`,
    ``,
    `${eM('•')} ${eM('Bot running')}: *${isRunning ? 'YES' : 'NO'}*`,
    `${eM('•')} ${eM('Range between')}: *${eM(String(rangeMin))}* ${eM('and')} *${eM(String(rangeMax))}* ${eM('on')} *${eM(symbol)}*`,
    `${eM('•')} ${eM('Current')} ${eM(symbol)} ${eM('price')}: *${eM(String(currentPrice))}*`,
    `${eM('•')} ${eM('Price position in grid')}: *${fmtGridPos(gridPositionPct)}*`,
    `${eM('•')} ${eM('Expected sell')}: *${eM(String(expSell ?? 'N/A'))}* \\(${eM('up')} ${fmtPct(sellPct)}\\)`,
    `${eM('•')} ${eM('Expected buy')}: *${eM(String(expBuy ?? 'N/A'))}* \\(${eM('down')} ${fmtPct(buyPct)}\\)`,
    `${eM('•')} ${eM('Amount of waiting cycles')}: *${eM(String(waitingCycles))}*`,
    `${eM('•')} ${eM('Last operation')}: *${eM(formatDateTime(lastOpAt))}*`,
    ``,
    `*${eM('Summary')}*`,
    `${eM('•')} ${eM('Profit today')}: *${eM(formatUSD(profitTodayUsd))}*`,
    `${eM('•')} ${eM('Month profit')}: *${eM(formatUSD(profitMonthUsd))}*`,
    `${eM('•')} ${eM('PnL current month')}: *${eM(curPctSign + Math.abs(pnlCurrentMonthPct).toFixed(2) + '%')}*`,
    `${eM('•')} ${eM('PnL estimate month')}: *${eM(estPctSign + Math.abs(pnlEstimateMonthPct).toFixed(2) + '%')}*`,
    `${eM('•')} ${eM('Month estimate')}: *${eM(formatUSD(estimateMonthUsd))}*`,
    `${eM('•')} ${eM('Exposure total')}: *${eM(formatUSD(exposureTotalUsd))}*`,
    ``,
    `*${eM(`Rebuy summary - ${rebuyLabel} - ${pctLabel}%`)}*`,
    `${eM('•')} ${eM('Total rebought value')}: *${eM(formatUSD(totalReboughtValueUsd))}*`,
    `${eM('•')} ${eM('Total rebought coin')}: *${eM(formatNumber(totalReboughtCoin, 8))}*`,
    `${eM('•')} ${eM('Rebought average price')}: *${eM(formatUSD(avgPrice))}*`,
    `${eM('•')} ${eM('Rebought PnL')}: *${eM(rebuyPctSign + Math.abs(rebuyPnlPct).toFixed(2) + '%')}* \\(${eM(rebuyUsdSign + formatUSD(Math.abs(rebuyPnlUsd)))}\\)`,
  ];

  return lines.join('\n');
}

function buildEstimateMessage({ period, total, count, avgPerDay, estDay, estWeek, estMonth }) {
  const daysElapsed = period?.meta?.dayOfMonth || 0;
  const daysInMonth = period?.meta?.daysInMonth || 0;

  const lines = [
    `*${eM('Profit estimate')}*`,
    `${eM(period.label)}`,
    `${eM('Range')}: *${eM(period.from)}* ${eM('to')} *${eM(period.to)}*`,
    ``,
    `${eM('•')} ${eM('Month-to-date profit')}: *${eM(formatUSD(total))}*`,
    `${eM('•')} ${eM('Trades count')}: *${eM(String(count))}*`,
    `${eM('•')} ${eM('Days elapsed')}: *${eM(String(daysElapsed))}* ${eM('/')} *${eM(String(daysInMonth))}*`,
    ``,
    `*${eM('Estimates')}*`,
    `${eM('•')} ${eM('Avg per day')}: *${eM(formatUSD(avgPerDay))}*`,
    `${eM('•')} ${eM('Estimate per week')}: *${eM(formatUSD(estWeek))}*`,
    `${eM('•')} ${eM('Estimate month total')}: *${eM(formatUSD(estMonth))}*`,
  ];

  return lines.join('\n');
}


function sign(n) {
  return Number(n || 0) >= 0 ? '+' : '-';
}

async function getPnlForPeriod(periodFn) {
  const instanceId = getInstanceId();
  const period = periodFn();

  // config (symbol)
  let cfg = await retrieveConfig({ trade_instance_id: instanceId });
  cfg = cfg?.[0];
  if (!cfg?.pair) throw new Error('Missing pair in config');

  // price (current)
  const exchangePrices = await getExchange().getPrices();
  const currentPrice = toNumberSafe(exchangePrices[cfg.pair] ?? exchangePrices[cfg.pair.replace('/', '')]);

  // orders + exposure (now includes avgEntryPrice)
  const orders = (await retrieveOrders({
    pair: cfg.pair,
    trade_instance_id: instanceId,
  })) || [];

  const exposure = calcExposureFromOrders(orders, currentPrice);

  // realized profit for the period
  const rows = await retrieveTradeProfit({
    trade_instance_id: instanceId,
    date_start: period.from,
    date_end: period.to,
  });
  const { total: profitUsd, count: trades } = sumProfit(rows);

  // equity now vs equity at entry (for open coin blocks only)
  const currentEquityUsd = exposure.coinQty * currentPrice + exposure.reservedUsd;
  const entryEquityUsd = exposure.coinCostUsd + exposure.reservedUsd;

  // unrealized relative to avg entry (weighted)
  const unrealizedUsd = (exposure.coinQty * currentPrice) - exposure.coinCostUsd;

  // view 1: based on current value
  const currentValuePct = pctOrZero(profitUsd, currentEquityUsd || exposure.totalExposureUsd);

  // view 2: based on entry
  const entryBasedUsd = profitUsd + unrealizedUsd;
  const entryBasedPct = pctOrZero(entryBasedUsd, entryEquityUsd);

  return {
    symbol: cfg.pair,
    currentPrice,
    exposure,
    period,
    profitUsd,
    trades,
    unrealizedUsd,
    currentValuePct,
    entryBasedUsd,
    entryBasedPct,
  };
}

function buildHelpMessage() {
  // MarkdownV2
  const lines = [
    `*${eM('Bot commands')}*`,
    ``,
    `${eM('/help')} ${eM('- show this help')}`,
    `${eM('/status')} ${eM('- show grid bot status (all-in-one)')}`,
    `${eM('/exposure')} ${eM('- shows open capital currently running in the grid')}`,
    ``,
    `*${eM('Profit summaries')}*`,
    `${eM('/day')} ${eM('- profit summary for today (00:00 to 23:59)')}`,
    `${eM('/daily_profit')} ${eM('- daily profit list for current month (day 1 to today)')}`,
    `${eM('/week')} ${eM('- profit summary for this week (Mon to Sun)')}`,
    `${eM('/month')} ${eM('- profit summary for this month (day 1 to end)')}`,
    `${eM('/estimate')} ${eM('- estimate monthly profit based on month-to-date average')}`,
    ``,
    `*${eM('Previous periods')}*`,
    `${eM('/previous_day')} ${eM('- profit summary for previous day')}`,
    `${eM('/previous_week')} ${eM('- profit summary for previous week')}`,
    `${eM('/previous_month')} ${eM('- profit summary for previous month')}`,
  ];

  return lines.join('\n');
}

function sumProfit(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.reduce((acc, r) => acc + Number(r.value || 0), 0);
  return { total, count: list.length };
}

function formatPct(n) {
  return `${n.toFixed(2)}%`;
}

function buildProfitSummaryMessage({ title, period, total, count, exposure, pnlPct }) {
  const lines = [
    `*${eM(title)}*`,
    `${eM(period.label)}`,
    `${eM('Range')}: *${eM(period.from)}* ${eM('to')} *${eM(period.to)}*`,
    ``,
    `${eM('•')} ${eM('Profit total')}: *${eM(formatUSD(total))}*`,
    `${eM('•')} ${eM('Trades count')}: *${eM(String(count))}*`,
  ];

  const totalExposureUsd = toNumberSafe(exposure?.totalExposureUsd);
  if (totalExposureUsd > 0) {
    lines.push(`${eM('•')} ${eM('Exposure')}: *${eM(formatUSD(totalExposureUsd))}*`);
  }

  if (Number.isFinite(pnlPct)) {
    lines.push(`${eM('•')} ${eM('PnL')}: *${eM(formatPct(pnlPct))}*`);
  }

  return lines.join('\n');
}

async function handleProfitSummaryCommand(msg, { title, periodFn }) {
  const instanceId = getInstanceId();
  const period = periodFn();

  const rows = await retrieveTradeProfit({
    trade_instance_id: instanceId,
    date_start: period.from,
    date_end: period.to,
  });

  const { total, count } = sumProfit(rows);

  // Exposure snapshot (now) to compute PnL %
  let exposure = null;
  let pnlPct = null;

  try {
    const res = await getCurrentExposure(); // returns { exposure, currentPrice } like /exposure
    exposure = res?.exposure ?? null;

    const denom = toNumberSafe(exposure?.totalExposureUsd);
    if (denom > 0) {
      pnlPct = Math.max(0, (total / denom) * 100);
    }
  } catch (_) {
    exposure = null;
    pnlPct = null;
  }

  return buildProfitSummaryMessage({
    title,
    period,
    total,
    count,
    exposure,
    pnlPct,
  });
}

function buildPnlMessage({ symbol, currentPrice, exposure, periods }) {
  const avgEntry = toNumberSafe(exposure.avgEntryPrice);

  const lines = [
    `*${eM('PnL summary')}*`,
    `${eM('Symbol')}: *${eM(symbol)}*`,
    `${eM('Current price')}: *${eM(String(currentPrice))}*`,
    `${eM('Avg entry (open coin blocks)')}: *${eM(formatUSD(avgEntry))}*`,
    `${eM('Coin qty')}: *${eM(formatNumber(exposure.coinQty, 8))}*`,
    `${eM('USDT reserved')}: *${eM(formatUSD(exposure.reservedUsd))}*`,
    `${eM('Current exposure')}: *${eM(formatUSD(exposure.totalExposureUsd))}*`,
    ``,
    ``,
    `*${eM('How to read')}*`,
    `${eM('•')} ${eM('Current-value PnL')} ${eM('= period profit / current equity')}`,
    `${eM('•')} ${eM('Entry-based PnL')} ${eM('= period profit + unrealized vs avg entry')}`,
    ``,
    ``,
    `*${eM('Periods')}*`,
    ...periods.flatMap(p => ([
      `*${eM(p.title)}*`,
      `${eM(p.period.label)}`,
      `${eM('Range')}: *${eM(p.period.from)}* ${eM('to')} *${eM(p.period.to)}*`,
      `${eM('•')} ${eM('Profit')} : *${eM(formatUSD(p.profitUsd))}* \\(${eM(String(p.trades))} ${eM('trades')}\\)`,
      `${eM('•')} ${eM('Current-value')} : *${eM(sign(p.currentValuePct) + Math.abs(p.currentValuePct).toFixed(2) + '%')}*`,
      `${eM('•')} ${eM('Entry-based')} : *${eM(sign(p.entryBasedPct) + Math.abs(p.entryBasedPct).toFixed(2) + '%')}* \\(${eM(sign(p.entryBasedUsd) + formatUSD(Math.abs(p.entryBasedUsd)))}\\)`,
      ``,
      ``,
    ])),
  ].filter(Boolean);

  return lines.join('\n');
}

function buildExposureMessage({ currentPrice, exposure }) {
  const lines = [
    `*${eM('Grid exposure')}*`,
    `${eM('Symbol')}: *${eM(getCurrentSymbol())}*`,
    `${eM('Current price')}: *${eM(String(currentPrice))}*`,
    ``,
    `*${eM('Open capital')}*`,
    `${eM('•')} ${eM('Coin qty (sell above price)')}: *${eM(formatNumber(exposure.coinQty, 8))}*`,
    `${eM('•')} ${eM('Coin value (at current)')}: *${eM(formatUSD(exposure.coinValueUsd))}*`,
    `${eM('•')} ${eM('USDT reserved (buys)')}: *${eM(formatUSD(exposure.reservedUsd))}*`,
    ``,
    `${eM('•')} ${eM('Total exposure')}: *${eM(formatUSD(exposure.totalExposureUsd))}*`,
  ];

  return lines.join('\n');
}

function msUntilNext2359() {
  const now = DateTime.now().setZone(BOT_TZ);

  let target = now.set({ hour: 23, minute: 59, second: 0, millisecond: 0 });
  if (target <= now) target = target.plus({ days: 1 });

  return target.toMillis() - now.toMillis();
}

async function sendStatusToChat(bot, toChatId) {
  try {
    const snapshot = await getAggregatedStatusSnapshot();
    const message = buildStatusMessage(snapshot);
    await bot.sendMessage(toChatId, message, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    await bot.sendMessage(
        toChatId,
        eM(`Failed to get status: ${err.message || err}`),
        { parse_mode: 'MarkdownV2' },
    );
  }
}

function scheduleDailyStatus(bot) {
  const delay = msUntilNext2359();

  setTimeout(async () => {
    try {
      await sendStatusToChat(bot, chatId);
    } catch (err) {
      console.error('Daily /status failed:', err?.message || err);
    } finally {
      scheduleDailyStatus(bot);
    }
  }, delay);
}

async function getCurrentSymbol() {
  const instanceId = getInstanceId();

  let cfg = await retrieveConfig({ trade_instance_id: instanceId });
  if (!cfg?.pair) throw new Error('Missing pair in config');
  return cfg.pair;
}

async function getCurrentExposure() {
  let cfg = await retrieveConfig({ trade_instance_id: getInstanceId() });
  cfg = cfg?.[0];
  if (!cfg?.pair) throw new Error('Missing pair in config');

  const prices = await getExchange().getPrices();

  const pair = cfg.pair;
  const currentPrice = toNumberSafe(prices[pair] ?? prices[pair.replace('/', '')]);

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error(`Invalid current price for ${pair}`);
  }

  const orders =
      (await retrieveOrders({
        pair,
        trade_instance_id: getInstanceId(),
      })) || [];

  const exposure = calcExposureFromOrders(orders, currentPrice);

  return { exposure, currentPrice, orders };
}

function createTelegramBot({ polling = true } = {}) {
  const token = mustGetTelegramToken();
  const bot = new TelegramBot(token, { polling });

  bot.onText(/\/help\b/, async msg => {
    if (!isAllowedChat(msg)) return;
    bot.sendMessage(msg.chat.id, buildHelpMessage(), { parse_mode: 'MarkdownV2' });
  });

  if (polling) {
    bot.onText(/\/status\b/, async msg => {
      if (!isAllowedChat(msg)) return;
      await sendStatusToChat(bot, msg.chat.id);
    });

    bot.onText(/\/day\b/, async msg => {
      if (!isAllowedChat(msg)) return;

      try {
        const message = await handleProfitSummaryCommand(msg, {
          title: 'Daily profit summary',
          periodFn: periodDay,
        });
        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
            msg.chat.id,
            eM(`Failed to get /day: ${err.message || err}`),
            { parse_mode: 'MarkdownV2' },
        );
      }
    });

    bot.onText(/\/daily_profits\b/, async msg => {
      if (!isAllowedChat(msg)) return;

      try {
        const instanceId = getInstanceId();
        const period = periodMonthToDate();

        const rows = await retrieveTradeProfit({
          trade_instance_id: instanceId,
          date_start: period.from,
          date_end: period.to,
        });

        const { days, monthTotal, monthCount } = groupProfitByDay(rows);

        const message = buildDailyProfitMessage({
          period,
          days,
          monthTotal,
          monthCount,
        });

        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
            msg.chat.id,
            eM(`Failed to get /daily_profits: ${err.message || err}`),
            { parse_mode: 'MarkdownV2' },
        );
      }
    });

    bot.onText(/\/week\b/, async msg => {
      if (!isAllowedChat(msg)) return;

      try {
        const message = await handleProfitSummaryCommand(msg, {
          title: 'Weekly profit summary',
          periodFn: periodWeek,
        });
        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
            msg.chat.id,
            eM(`Failed to get /week: ${err.message || err}`),
            { parse_mode: 'MarkdownV2' },
        );
      }
    });

    bot.onText(/\/month\b/, async msg => {
      if (!isAllowedChat(msg)) return;

      try {
        const message = await handleProfitSummaryCommand(msg, {
          title: 'Monthly profit summary',
          periodFn: periodMonth,
        });
        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
            msg.chat.id,
            eM(`Failed to get /month: ${err.message || err}`),
            { parse_mode: 'MarkdownV2' },
        );
      }
    });

    bot.onText(/\/previous_day\b/, async msg => {
      if (!isAllowedChat(msg)) return;

      try {
        const message = await handleProfitSummaryCommand(msg, {
          title: 'Previous day profit summary',
          periodFn: periodPreviousDay,
        });
        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
            msg.chat.id,
            eM(`Failed to get /previous_day: ${err.message || err}`),
            { parse_mode: 'MarkdownV2' },
        );
      }
    });

    bot.onText(/\/previous_week\b/, async msg => {
      if (!isAllowedChat(msg)) return;

      try {
        const message = await handleProfitSummaryCommand(msg, {
          title: 'Previous week profit summary',
          periodFn: periodPreviousWeek,
        });
        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
            msg.chat.id,
            eM(`Failed to get /previous_week: ${err.message || err}`),
            { parse_mode: 'MarkdownV2' },
        );
      }
    });

    bot.onText(/\/previous_month\b/, async msg => {
      if (!isAllowedChat(msg)) return;

      try {
        const message = await handleProfitSummaryCommand(msg, {
          title: 'Previous month profit summary',
          periodFn: periodPreviousMonth,
        });
        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
            msg.chat.id,
            eM(`Failed to get /previous_month: ${err.message || err}`),
            { parse_mode: 'MarkdownV2' },
        );
      }
    });

    bot.onText(/\/estimate\b/, async msg => {
      if (!isAllowedChat(msg)) return;

      try {
        const instanceId = getInstanceId();
        const period = periodMonthToDate();

        const rows = await retrieveTradeProfit({
          trade_instance_id: instanceId,
          date_start: period.from,
          date_end: period.to,
        });

        const { total, count } = sumProfit(rows);

        const daysElapsed = Number(period?.meta?.dayOfMonth || 0);
        const daysInMonth = Number(period?.meta?.daysInMonth || 0);

        const avgPerDay = daysElapsed > 0 ? total / daysElapsed : 0;

        const estWeek = avgPerDay * 7;
        const estMonth = daysInMonth > 0 ? avgPerDay * daysInMonth : 0;

        const message = buildEstimateMessage({
          period,
          total,
          count,
          avgPerDay,
          estDay: avgPerDay,
          estWeek,
          estMonth,
        });

        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
            msg.chat.id,
            eM(`Failed to get /estimate: ${err.message || err}`),
            { parse_mode: 'MarkdownV2' },
        );
      }
    });

    bot.onText(/\/exposure\b/, async (msg) => {
      if (!isAllowedChat(msg)) return;

      try {
        const { exposure, currentPrice } = getCurrentExposure();
        const message = buildExposureMessage({ currentPrice, exposure });

        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
          msg.chat.id,
          eM(`Failed to get /exposure: ${err.message || err}`),
          { parse_mode: 'MarkdownV2' },
        );
      }
    });

    bot.onText(/\/pnl\b/, async (msg) => {
      if (!isAllowedChat(msg)) return;

      try {
        const day = await getPnlForPeriod(periodDay);
        const week = await getPnlForPeriod(periodWeek);
        const month = await getPnlForPeriod(periodMonth);
        const year = await getPnlForPeriod(periodYear);

        // Use day header snapshot values (symbol/price/exposure) and show all periods below
        const message = buildPnlMessage({
          symbol: day.symbol,
          currentPrice: day.currentPrice,
          exposure: day.exposure,
          periods: [
            {
              title: 'Day',
              period: day.period,
              profitUsd: day.profitUsd,
              trades: day.trades,
              unrealizedUsd: day.unrealizedUsd,
              currentValuePct: day.currentValuePct,
              entryBasedUsd: day.entryBasedUsd,
              entryBasedPct: day.entryBasedPct,
            },
            {
              title: 'Week',
              period: week.period,
              profitUsd: week.profitUsd,
              trades: week.trades,
              unrealizedUsd: week.unrealizedUsd,
              currentValuePct: week.currentValuePct,
              entryBasedUsd: week.entryBasedUsd,
              entryBasedPct: week.entryBasedPct,
            },
            {
              title: 'Month',
              period: month.period,
              profitUsd: month.profitUsd,
              trades: month.trades,
              unrealizedUsd: month.unrealizedUsd,
              currentValuePct: month.currentValuePct,
              entryBasedUsd: month.entryBasedUsd,
              entryBasedPct: month.entryBasedPct,
            },
            {
              title: 'Year',
              period: year.period,
              profitUsd: year.profitUsd,
              trades: year.trades,
              unrealizedUsd: year.unrealizedUsd,
              currentValuePct: year.currentValuePct,
              entryBasedUsd: year.entryBasedUsd,
              entryBasedPct: year.entryBasedPct,
            },
          ],
        });

        bot.sendMessage(msg.chat.id, message, { parse_mode: 'MarkdownV2' });
      } catch (err) {
        bot.sendMessage(
          msg.chat.id,
          eM(`Failed to get /pnl: ${err.message || err}`),
          { parse_mode: 'MarkdownV2' },
        );
      }
    });

    if (polling) {
      scheduleDailyStatus(bot);
    }
  }

  return bot;
}

async function notifyTelegram(message) {
  const bot =
      createTelegramBot._senderSingleton ||
      (createTelegramBot._senderSingleton = createTelegramBot({ polling: false }));

  const ts = moment().tz(BOT_TZ).format('YYYY-MM-DD HH:mm:ss');
  const text = `${ts} - ${String(message)}`;

  try {
    await bot.sendMessage(chatId, text);
  } catch (err) {
    const details = err?.message ? err.message : String(err);
    console.error(`Error sending Telegram notification: ${details}`);
  }
}

export { createTelegramBot, notifyTelegram };