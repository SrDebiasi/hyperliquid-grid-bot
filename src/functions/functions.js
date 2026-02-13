import axios from 'axios';
import moment from 'moment-timezone';


import { notifyTelegram } from './services/telegramService.js';
import HyperliquidAdapter from '../exchange/HyperliquidAdapter.js';

let apiUrl = process.env.API_URL_LOCAL || 'http://127.0.0.1/api/';

let headers = { headers: { 'Content-Type': 'application/json' }, validateStatus: false };

const BOT_TZ = process.env.BOT_TZ || 'America/Vancouver';

function nowTz() {
  return moment().tz(BOT_TZ);
}

let exchange = null;
const getExchange = () => exchange;

const retrieveInstance = (data) => new Promise((resolve, reject) => {
  axios.get(apiUrl + 'trade-instance', { params: { id: data.id } }, headers)
    .then(async (result) => {
      const userAddress = result.data.wallet_address ?? '';
      const privateKey = result.data.private_key ?? '';
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
    .catch((ex) => reject({ error: ex.toString() }));
});

const retrieveConfig = (data) => new Promise((resolve, reject) => {
  axios.get(apiUrl + 'trade-config', { params: { trade_instance_id: data.id } }, headers)
    .then(result => {
      resolve(result.data);
    })
    .catch((ex) => reject({ error: ex.toString() }));
});

const retrieveTradeProfit = (data) => new Promise((resolve, reject) => {
  const params = {
    trade_instance_id: data.trade_instance_id,
  };

  if (data.date_transaction) {
    params.date_transaction = data.date_transaction; // YYYY-MM-DD
  }
  if (data.date_transaction_from) {
    params.date_transaction_from = data.date_transaction_from; // YYYY-MM-DD
  }
  if (data.date_transaction_to) {
    params.date_transaction_to = data.date_transaction_to; // YYYY-MM-DD
  }

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

const functionTime = () => {
  try {
    exchange?.refreshTime?.();
  } catch (ex) {
  }
};
setInterval(functionTime, 60000 * 10);

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
  console.log(`API URL: ${apiUrl}`);
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
  const nowDb = nowMoment.format('YYYY-MM-DD HH:mm:ss');      // for DB

  const coin = {
    pair: data.pair,
    profit: data.profit,
    name: data.name,
    value: data.value,
    trade_instance_id: data.trade_instance_id,
    percentual: data.target_percent,
    fee: null,
    price_intermediate: data.price_intermediate,
    price_final: data.price_final,
    quantity_intermediate: null,
    quantity_final: null,
    date_transaction: nowDb,
  };

  const profitStr = Number.parseFloat(data.value).toFixed(2);
  const priceStr = Number.parseFloat(data.price_final).toFixed(2);

  const msg = `New $${profitStr} profit on ${data.name} at ${priceStr}`;

  addMessage(msg, 'green bg');
  notifyTelegram(msg);

  axios.post(apiUrl + 'trade-profit', coin, headers).catch((error) => {
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

export {
  setApi,
  getExchange,
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
};