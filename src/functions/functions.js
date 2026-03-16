import axios from 'axios';
import moment from 'moment-timezone';

import { notifyTelegram } from '../services/telegramService.js';
import HyperliquidAdapter from '../exchange/HyperliquidAdapter.js';

// ─── Config & Setup ────────────────────────────────────────────────────────────

let apiUrl = process.env.API_URL_LOCAL || 'http://127.0.0.1/api/';
const headers = { headers: { 'Content-Type': 'application/json' }, validateStatus: false };
const headersput = { headers: { 'Content-Type': 'application/json' }, validateStatus: false };

let _botInstanceCfg = null;
export function setBotInstanceConfig(cfg) { _botInstanceCfg = cfg || null; }

function nowTz() {
  return moment().tz(_botInstanceCfg?.bot_tz || 'America/Edmonton');
}

const setApi = () => {
  const env = (process.env.API_ENV || 'local').toLowerCase();

  const apiUrlByEnv = {
    local: process.env.API_URL_LOCAL,
    aws: process.env.API_URL_AWS,
  };

  const resolved = apiUrlByEnv[env];

  if (!resolved) {
    throw new Error(
      `API not configured. API_ENV=${env}, expected env vars: API_URL_LOCAL and API_URL_AWS`,
    );
  }

  apiUrl = resolved.endsWith('/') ? resolved : `${resolved}/`;
  console.log(`Running on ${env}`);
};

// ─── Logging ───────────────────────────────────────────────────────────────────

const consoleLog = (message, color = null) => {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    'red bg': '\x1b[30m\x1b[41m',
    'green bg': '\x1b[30m\x1b[42m',
    'yellow bg': '\x1b[30m\x1b[43m',
  };

  const colorCode = colors[color] || '';
  const timestamp = nowTz().format('HH:mm:ss');
  console.log(`${colorCode}${timestamp} - ${message}\x1b[0m`);
};

// ─── Exchange ──────────────────────────────────────────────────────────────────

let exchange = null;
const getExchange = () => exchange;

function isConnRefusedToLocalhost(err) {
  const code = err?.code;
  const msg = String(err?.message || err || '');
  const url = String(err?.config?.url || '');

  const looksLikeLocalApi =
    url.includes('127.0.0.1:3000') ||
    url.includes('localhost:3000') ||
    msg.includes('127.0.0.1:3000') ||
    msg.includes('localhost:3000');

  return code === 'ECONNREFUSED' && looksLikeLocalApi;
}

const initExchange = (data) => new Promise((resolve, reject) => {
  axios.get(apiUrl + 'trade-instance', { params: { id: data.id } }, headers)
    .then(async (result) => {
      const userAddress = process.env.WALLET_ADDRESS || result.data.wallet_address || '';
      const privateKey = process.env.PRIVATE_KEY || result.data.private_key || '';
      consoleLog('Private Key loaded.');

      if (!privateKey) throw new Error('Missing HYPERLIQUID PRIVATE KEY');

      const isTestnet = _botInstanceCfg?.hyperliquid_testnet === true
        || _botInstanceCfg?.hyperliquid_testnet === 1;

      exchange = new HyperliquidAdapter({ userAddress, privateKey, isTestnet });

      await exchange.init();
      resolve(result.data);
    })
    .catch((err) => {
      if (isConnRefusedToLocalhost(err)) {
        return reject({
          error: `API server offline (did you run "npm run api"?)`,
          code: err.code,
        });
      }
      reject({ error: err?.toString?.() || String(err) });
    });
});

// ─── API Client — Reads ────────────────────────────────────────────────────────

const retrieveInstance = async (data) => {
  const result = await axios.get(apiUrl + 'trade-instance', { params: { id: data.id } }, headers);
  return [result.data];
};

const retrieveOrders = async (data) => {
  const result = await axios.get(apiUrl + 'trade-order', { params: data }, headers);
  return result.data;
};

const retrieveTradeProfit = async (data) => {
  const params = { trade_instance_id: data.trade_instance_id };
  if (data.pair) params.pair = data.pair;
  if (data.date_start) params.date_start = String(data.date_start).slice(0, 10);
  if (data.date_end) params.date_end = String(data.date_end).slice(0, 10);

  const result = await axios.get(apiUrl + 'trade-profit', { params }, headers);
  return result.data;
};

const retrieveTradeCycles = async (data) => {
  const params = { trade_instance_id: data.trade_instance_id };
  if (data.pair) params.pair = data.pair;
  if (data.date_start) params.date_start = String(data.date_start).slice(0, 10);
  if (data.date_end) params.date_end = String(data.date_end).slice(0, 10);

  const result = await axios.get(apiUrl + 'trade-cycle', { params }, headers);
  return result.data;
};

// ─── API Client — Writes ───────────────────────────────────────────────────────

const saveTradeOrder = async (data) => {
  const result = await axios.post(apiUrl + 'trade-order', data, headers);
  return result.data;
};

const updateTradeOrder = async (data) => {
  const result = await axios.put(apiUrl + 'trade-order/' + data.id, data, headersput);
  return result.data;
};

const updateTradeInstance = async (data) => {
  const result = await axios.put(apiUrl + 'trade-instance/' + data.id + '/config', data, headersput);
  return result.data;
};

// ─── Bot Events ────────────────────────────────────────────────────────────────

const addMessage = (message, color = null) => {
  consoleLog(message, color);

  const now = nowTz().format('YYYY-MM-DD HH:mm:ss');
  const data = {
    message: `${now} - ${message}`,
    date: now,
  };

  axios.post(apiUrl + 'message', data, headers)
    .catch(() => consoleLog('Error on addMessage'));
};

const addCycle = (data) => {
  const payload = {
    pair: data.pair,
    side: data.side,
    name: data.name,
    price: data.price,
    trade_instance_id: data.trade_instance_id,
    date_transaction_utc: moment.utc().toISOString(),
    date_transaction: moment().tz(_botInstanceCfg?.bot_tz || 'America/Edmonton').toISOString(true),
  };

  axios.post(apiUrl + 'trade-cycle', payload, headers)
    .catch((err) => {
      console.log(err);
      consoleLog('Error on addCycle');
    });
};

const addProfit = (data) => {
  const payload = {
    pair: data.pair,
    profit: data.profit,
    name: data.name,
    value: data.value,
    trade_instance_id: data.trade_instance_id,
    target_percent: data.target_percent,
    fee: null,
    price_intermediate: data.price_intermediate,
    price_final: data.price_final,
    date_transaction_utc: moment.utc().toISOString(),
    date_transaction: moment().tz(_botInstanceCfg?.bot_tz || 'America/Edmonton').toISOString(true),
  };

  const profitStr = Number.parseFloat(data.value).toFixed(2);
  const priceStr = Number.parseFloat(data.price_final).toFixed(2);
  const msg = `New $${profitStr} profit on ${data.name} at ${priceStr}`;

  addMessage(msg, 'green bg');
  notifyTelegram(msg);

  axios.post(apiUrl + 'trade-profit', payload, headers)
    .catch((err) => {
      console.log(err);
      consoleLog('Error on addProfit');
    });
};

// ─── Market Data ───────────────────────────────────────────────────────────────

async function fetchHyperliquidAllMids() {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  });

  if (!res.ok) throw new Error(`Hyperliquid allMids failed: ${res.status}`);
  return res.json(); // { BTC: "66155.5", ... }
}

function baseSymbolFromPair(pair) {
  return String(pair || '').split('/')[0].trim().toUpperCase();
}

async function fetchHyperliquidMidFromPair(pair) {
  try {
    const mids = await fetchHyperliquidAllMids();
    const base = baseSymbolFromPair(pair);

    const candidates = [
      base,               // BTC
      base.replace(/^U/, ''), // UBTC -> BTC
      `U${base}`,         // BTC -> UBTC
    ];

    for (const k of candidates) {
      const n = Number(mids?.[k]);
      if (Number.isFinite(n)) return n;
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ─── Health Checks ─────────────────────────────────────────────────────────────

let healthchecksTimer = null;

function startHealthchecksPing(
  pingUrl = _botInstanceCfg?.healthchecks_ping_url,
  intervalMs = Number(_botInstanceCfg?.healthchecks_ping_interval_ms || 60000),
) {
  if (intervalMs === 0 || !pingUrl) return;
  try {
    clearInterval(healthchecksTimer);
    const base = String(pingUrl).replace(/\/+$/, '');
    const ping = () => fetch(base).catch(() => {});
    void ping();
    consoleLog('Start pinging healthchecks');
    healthchecksTimer = setInterval(ping, intervalMs);
    healthchecksTimer.unref?.();
  } catch (ex) {
    console.log('Error on pinging healthchecks.io');
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────────

export {
  // Setup
  setApi,
  // Logging
  consoleLog,
  // Exchange
  getExchange,
  initExchange,
  // API reads
  retrieveInstance,
  retrieveOrders,
  retrieveTradeProfit,
  retrieveTradeCycles,
  // API writes
  saveTradeOrder,
  updateTradeOrder,
  updateTradeInstance,
  // Bot events
  addMessage,
  addCycle,
  addProfit,
  // Market data
  fetchHyperliquidMidFromPair,
  // Health checks
  startHealthchecksPing,
};
