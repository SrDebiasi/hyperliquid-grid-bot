import axios from 'axios';
import moment from 'moment-timezone';

import { notifyTelegram } from '../services/telegramService.js';
import HyperliquidAdapter from '../exchange/HyperliquidAdapter.js';

let apiUrl = process.env.API_URL_LOCAL || 'http://127.0.0.1/api/';

let headers = { headers: { 'Content-Type': 'application/json' }, validateStatus: false };

const BOT_TZ = process.env.BOT_TZ || 'America/Vancouver';

function nowTz() {
  return moment().tz(BOT_TZ);
}

let exchange = null;
let healthchecksTimer = null;
const getExchange = () => exchange;

const retrieveInstance = (data) => new Promise((resolve, reject) => {
  axios.get(apiUrl + 'trade-instance', { params: { id: data.id } }, headers)
      .then(async (result) => {
        const userAddress = process.env.WALLET_ADDRESS ?? result.data.wallet_address ?? '';
        const privateKey = process.env.PRIVATE_KEY ?? result.data.private_key ?? '';
        consoleLog('Private Key loaded.');

        if (!privateKey) throw new Error('Missing HYPERLIQUID PRIVATE KEY');

        exchange = new HyperliquidAdapter({
          userAddress,
          privateKey,
          isTestnet: process.env.HYPERLIQUID_TESTNET === '1',
        });

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

const retrieveConfig = (data) => new Promise((resolve, reject) => {
  axios.get(apiUrl + 'trade-config', { params: { trade_instance_id: data.trade_instance_id } }, headers)
    .then(result => {
      resolve(result.data);
    })
    .catch((ex) => reject({ error: ex.toString() }));
});

const retrieveTradeProfit = (data) => new Promise((resolve, reject) => {
  const params = {
    trade_instance_id: data.trade_instance_id,
  };

  if (data.pair) params.pair = data.pair;

  // Always normalize to YYYY-MM-DD (handles "YYYY-MM-DD HH:mm:ss" too)
  if (data.date_start) params.date_start = String(data.date_start).slice(0, 10);
  if (data.date_end) params.date_end = String(data.date_end).slice(0, 10);

  axios.get(apiUrl + 'trade-profit', { params }, headers)
      .then(result => resolve(result.data))
      .catch((ex) => reject({ error: ex.toString() }));
});

const retrieveOrders = (data) => new Promise((resolve, reject) => {
  axios.get(apiUrl + 'trade-order', {
    params: data,
  }, headers)
    .then(result => resolve(result.data))
    .catch((ex) => reject({ error: ex.toString() }));
});

const saveTradeOrder = (data) => new Promise((resolve, reject) => {
  axios.post(apiUrl + 'trade-order', data, headers)
    .then(result => {
      resolve(result.data);
    })
    .catch((ex) => reject({ error: ex.toString() }));
});

const updateTradeOrder = (data) => new Promise((resolve, reject) => {
  let headersPut = { headers: { 'Content-Type': 'application/json' }, validateStatus: false, method: 'put' };
  axios.put(apiUrl + 'trade-order/' + data.id, data, headersPut)
    .then(result => resolve(result.data))
    .catch((ex) => reject({ error: ex.toString() }));
});

const updateTradeConfig = (data) => new Promise((resolve, reject) => {
  let headersPut = { headers: { 'Content-Type': 'application/json' }, validateStatus: false, method: 'put' };
  axios.put(apiUrl + 'trade-config/' + data.id, data, headersPut)
    .then(result => resolve(result.data))
    .catch((ex) => reject({ error: ex.toString() }));
});

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

const addMessage = (message, color = null) => {
  consoleLog(message, color);

  const now = nowTz().format('YYYY-MM-DD HH:mm:ss');
  const finalMessage = `${now} - ${message}`;

  const data = {
    message: finalMessage,
    date: now,
  };

  axios.post(apiUrl + 'message', data, headers)
    .catch(() => consoleLog('Erro no addMessage'));
};

const addProfit = (data) => {
  const nowMoment = nowTz();
  const nowDb = nowMoment.format('YYYY-MM-DD HH:mm:ss');

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
    date_transaction: nowDb,
  };

  const profitStr = Number.parseFloat(data.value).toFixed(2);
  const priceStr = Number.parseFloat(data.price_final).toFixed(2);

  const msg = `New $${profitStr} profit on ${data.name} at ${priceStr}`;

  addMessage(msg, 'green bg');
  notifyTelegram(msg);

  axios.post(apiUrl + 'trade-profit', payload, headers).catch((error) => {
    console.log(error);
    consoleLog('Erro no addCoin');
  });
};

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
  const fullMessage = `${timestamp} - ${message}`;

  console.log(`${colorCode}${fullMessage}\x1b[0m`);
};

function startHealthchecksPing(
    pingUrl = process.env.HEALTHCHECKS_PING_URL,
    intervalMs = Number(process.env.HEALTHCHECKS_PING_INTERVAL_MS || 60000),
) {
  if (intervalMs === 0 || !pingUrl) return;
  try {
    clearInterval(healthchecksTimer);
    const base = String(pingUrl).replace(/\/+$/, '');
    const ping = () => fetch(base).catch(() => {});
    void ping();
    consoleLog('Start pinging healthchecks')
    healthchecksTimer = setInterval(ping, intervalMs);
    healthchecksTimer.unref?.();
  } catch (ex) {
    console.log('Error on pinging healthchecks.io')
  }
}
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
  // "BTC/USDC" -> "BTC"
  return String(pair || '').split('/')[0].trim().toUpperCase();
}

async function fetchHyperliquidMidFromPair(pair) {
  const mids = await fetchHyperliquidAllMids();
  const base = baseSymbolFromPair(pair);

  const candidates = [
    base,                         // BTC
    base.replace(/^U/, ''),        // UBTC -> BTC
    `U${base}`,                    // BTC -> UBTC
  ];

  for (const k of candidates) {
    const n = Number(mids?.[k]);
    if (Number.isFinite(n)) return n;
  }

  return null;
}


export {
  setApi,
  getExchange,
  fetchHyperliquidMidFromPair,
  retrieveConfig,
  retrieveOrders,
  retrieveInstance,
  retrieveTradeProfit,
  saveTradeOrder,
  updateTradeOrder,
  updateTradeConfig,
  addProfit,
  addMessage,
  consoleLog,
  startHealthchecksPing
};