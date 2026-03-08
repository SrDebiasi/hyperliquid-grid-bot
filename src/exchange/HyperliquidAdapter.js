import {
  InfoClient,
  ExchangeClient,
  HttpTransport,
  SubscriptionClient,
  WebSocketTransport,
} from '@nktkas/hyperliquid';
import WebSocket from 'ws';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Symbols are expected in Hyperliquid spot format, e.g. "BTC/USDC".
 * This adapter intentionally does NOT support perps/futures.
 *
 * Requirements:
 *   npm i @nktkas/hyperliquid viem
 *
 * Env example:
 *   HYPERLIQUID_PRIVATE_KEY=0x...
 *   HYPERLIQUID_TESTNET=0
 *
 * Notes:
 * - Spot pair index comes from spotMeta.universe[index]
 * - Spot order asset id = 10000 + pairIndex
 * - Spot subscription coin id (activeSpotAssetCtx) = "@<pairIndex>"
 */
export const ORDER_STATUS_NOT_OPEN = 'NOT_OPEN_NO_FILL';
export const ORDER_STATUS_FILLED = 'FILLED';
export const ORDER_STATUS_OPEN = 'OPEN';

export default class HyperliquidAdapter {
  /**
   * @param {{
   *  privateKey: string,
   *  isTestnet?: boolean
   * }} params
   */
  constructor({privateKey, userAddress, isTestnet = false} = {}) {
    if (!privateKey) throw new Error('HyperliquidAdapter requires privateKey');
    if (!userAddress) throw new Error('HyperliquidAdapter requires userAddress (main account)');

    const pk = String(privateKey).startsWith('0x') ? String(privateKey) : `0x${privateKey}`;
    const account = privateKeyToAccount(pk);

    this.isTestnet = isTestnet;

    this._agentAddress = account.address;
    this._userAddress = String(userAddress).trim();

    this.info = new InfoClient({transport: new HttpTransport({isTestnet})});

    this.exchange = new ExchangeClient({
      transport: new HttpTransport({isTestnet}),
      wallet: account, // agent signs
    });

    this.subs = new SubscriptionClient({
      transport: new WebSocketTransport({isTestnet}),
    });

    this.pairs = new Map();
    this.midCache = new Map();
  }

  async init() {
    // Returns [spotMeta, spotAssetCtxs]
    const [spotMeta, spotCtxs] = await this.info.spotMetaAndAssetCtxs();

    for (const u of spotMeta.universe) {
      // Key by the human-readable pair format when present ("BTC/USDC")
      if (!u?.name || !u.name.includes('/')) continue;

      const pairIndex = u.index;
      const spotCoinId = `@${pairIndex}`; // used by activeSpotAssetCtx
      const orderAssetId = 10000 + pairIndex; // used by Exchange order placement

      this.pairs.set(u.name, {pairIndex, spotCoinId, orderAssetId});
    }

    // Seed cache by index if provided
    if (Array.isArray(spotCtxs)) {
      spotCtxs.forEach((ctx, idx) => {
        if (ctx?.midPx != null) this.midCache.set(idx, Number(ctx.midPx));
      });
    }
  }

  _user() {
    return this._userAddress;
  }

  /**
   * Return a prices map: { [symbol]: price }
   * Matches the same shape you use with Binance .prices().
   * @param {string[]=} symbols
   */
  async getPrices(pairs = []) {
    const mids = await this.info.allMids(); // returns all
    const out = {};

    const inputs = (pairs && pairs.length)
        ? pairs
        : Object.keys(mids).map((c) => `${c}USDC`);

    for (const raw of inputs) {
      const s = String(raw).toUpperCase();
      const clean = s.replace(/[\/\-_]/g, '');
      const coin = clean.endsWith('USDC') ? clean.slice(0, -4) : clean;

      const px = Number(mids[coin]);
      if (!Number.isFinite(px)) continue;

      const key = clean.endsWith('USDC') ? clean : `${coin}USDC`;
      out[key] = px;
    }

    return out;
  }

  normalizeSymbolForPrice(input) {
    let symbol = String(input || '').trim().toUpperCase();

    if (symbol.includes('/')) {
      const [base, quote] = symbol.split('/');
      const baseMap = { UBTC: 'BTC', UETH: 'ETH', USOL: 'SOL' };
      return `${baseMap[base] ?? base}${quote}`;
    }

    if (symbol.includes('-') || symbol.includes('_')) {
      const parts = symbol.split(/[-_]/);
      if (parts.length === 2) {
        const [base, quote] = parts;
        const baseMap = { UBTC: 'BTC', UETH: 'ETH', USOL: 'SOL' };
        return `${baseMap[base] ?? base}${quote}`;
      }
    }

    const clean = symbol.replace(/[\/\-_]/g, '');
    if (clean.endsWith('USDC')) {
      const base = clean.slice(0, -4);
      const baseMap = { UBTC: 'BTC', UETH: 'ETH', USOL: 'SOL' };
      return `${baseMap[base] ?? base}USDC`;
    }

    if (clean.endsWith('USDT')) {
      const base = clean.slice(0, -4);
      const baseMap = { UBTC: 'BTC', UETH: 'ETH', USOL: 'SOL' };
      return `${baseMap[base] ?? base}USDT`;
    }

    return clean;
  }

  normalizeSymbol(input) {
    let symbol = String(input || '').trim();
    if (!symbol.includes('/') && symbol.length >= 6) {
      symbol = symbol.replace(/^(.*?)(USDC|USDT)$/, '$1/$2');
    }
    const sUp = symbol.toUpperCase();
    if (sUp.endsWith('/USDC')) {
      const [base, quote] = sUp.split('/');
      const baseMap = {BTC: 'UBTC', ETH: 'UETH', SOL: 'USOL'};
      const mappedBase = baseMap[base] ?? base;
      return `${mappedBase}/${quote}`;
    }
    return sUp;
  }

  async resolveSpotAssetFromSymbol(symbolInput) {
    const symbol = this.normalizeSymbol(symbolInput);
    const [baseSym, quoteSym] = symbol.split('/');
    const quote = quoteSym || 'USDC';
    const now = Date.now();
    const cacheTtlMs = 5 * 60 * 1000;
    if (!this._spotMetaCache || !this._spotMetaCacheAt || now - this._spotMetaCacheAt > cacheTtlMs) {
      this._spotMetaCache = await this.info.spotMeta();
      this._spotMetaCacheAt = now;
    }
    const spotMeta = this._spotMetaCache;
    const tokens = spotMeta.tokens ?? [];
    const universe = spotMeta.universe ?? [];
    const baseToken = tokens.find((t) => String(t.name).toUpperCase() === baseSym);
    const quoteToken = tokens.find((t) => String(t.name).toUpperCase() === quote);
    if (!baseToken || !quoteToken) {
      throw new Error(`Hyperliquid spot token not found: ${baseSym}/${quote}`);
    }
    const entry = universe.find(
        (u) =>
            Array.isArray(u.tokens) &&
            u.tokens.length === 2 &&
            u.tokens[0] === baseToken.index &&
            u.tokens[1] === quoteToken.index,
    );
    if (!entry) {
      throw new Error(`Hyperliquid spot pair not found in spotMeta.universe: ${symbol}`);
    }
    const asset = 10000 + entry.index;
    return {symbol, asset};
  }


  /**
   * Spot order submitter (assumes symbol + asset already resolved).
   * postOnly defaults to true -> "Alo".
   *
   * @param {{
   *  symbol: string,
   *  asset: number,
   *  side: "BUY"|"SELL",
   *  price: number|string,
   *  quantity: number|string,
   *  postOnly?: boolean
   * }} param
   */
  async placeAnOrder(param) {
    const symbol = String(param.symbol || '').toUpperCase();
    const side = String(param.side || '').toUpperCase();

    let price = Number(param.price);
    const quantity = Number(param.quantity);
    const postOnly = !!param.postOnly;

    const asset = Number(param.asset);
    if (!Number.isFinite(asset)) {
      throw new Error(`Invalid asset: ${param.asset} (symbol=${symbol})`);
    }
    if (!Number.isFinite(price) || price <= 0) throw new Error(`Invalid LIMIT price: ${param.price}`);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`Invalid quantity: ${param.quantity}`);

    const tif = param.tif
        ? String(param.tif)
        : (postOnly ? 'Alo' : 'Gtc');

    const req = {
      orders: [
        {
          a: asset,
          b: side === 'BUY',
          p: String(price),
          s: String(quantity),
          r: false,
          t: {limit: {tif}},
        },
      ],
      grouping: 'na',
    };

    return this.exchange.order(req);
  }

  async placeOrder(param) {
    const type = String(param.type || '').toUpperCase();
    const side = String(param.side || '').toUpperCase();
    const quantity = Number(param.quantity);
    const price = param.price !== undefined ? Number(param.price) : undefined;
    const postOnly = param.postOnly !== undefined ? !!param.postOnly : false;

    const {symbol, asset} = await this.resolveSpotAssetFromSymbol(param.symbol);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity: ${param.quantity}`);
    }
    if (type !== 'LIMIT' && type !== 'MARKET') {
      throw new Error(`Unsupported order type for HyperliquidAdapter: ${param.type}`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid LIMIT price: ${param.price}`);
    }

    const tif =
        type === 'MARKET'
            ? 'Ioc'
            : (postOnly ? 'Alo' : 'Gtc');

    const orderToSubmit = {
      symbol,
      side,
      price,
      quantity,
      postOnly: param.postOnly !== undefined ? !!param.postOnly : false,
      asset,
      tif
    };
    const res = await this.placeAnOrder(orderToSubmit);
    const st0 = res?.response?.data?.statuses?.[0] ?? {};
    const orderId =
        st0?.resting?.oid ??
        st0?.filled?.oid ??
        st0?.canceled?.oid ??
        null;
    if (st0?.error) {
      throw new Error(`Hyperliquid order error: ${st0.error}`);
    }
    if (!orderId) {
      throw new Error(`Hyperliquid order missing oid. status0=${JSON.stringify(st0)}`);
    }
    return {
      type,
      orderId: String(orderId),
      symbol: orderToSubmit.symbol,
      side: orderToSubmit.side,
      price: orderToSubmit.price,
      quantity: orderToSubmit.quantity,
      postOnly: orderToSubmit.postOnly,
      asset: orderToSubmit.asset,
      // optional but super useful for debugging
      hlStatus0: st0,
      raw: res,
    };
  }


  /**
   * Cancel a single order by oid.
   * @param {{ orderId: number|string }} params
   */
  async cancelOrder({orderId, symbol}) {
    const o = Number(orderId);
    if (!Number.isFinite(o)) throw new Error(`Invalid orderId: ${orderId}`);
    const {asset} = await this.resolveSpotAssetFromSymbol(symbol);
    return await this.exchange.cancel({cancels: [{a: asset, o}]});
  }

  /**
   * Cancel multiple orders in one call (same symbol).
   * @param {{ cancels: Array<{ orderId: number|string, symbol: string }> }} params
   */
  async cancelOrders({cancels}) {
    if (!Array.isArray(cancels) || cancels.length === 0) return {cancelled: 0};

    const symbol = cancels[0].symbol;
    const {asset} = await this.resolveSpotAssetFromSymbol(symbol);

    const payload = cancels.map(({orderId}) => {
      const o = Number(orderId);
      if (!Number.isFinite(o)) throw new Error(`Invalid orderId: ${orderId}`);
      return {a: asset, o};
    });

    await this.exchange.cancel({cancels: payload});
    return {cancelled: payload.length};
  }


  /**
   * Spot balances / state.
   */
  async getBalances() {
    return await this.info.spotClearinghouseState({user: this._user()});
  }

  async getOpenOrders() {
    const rows = await this.info.openOrders({user: this._userAddress, dex: ''});

    return (rows ?? []).map((o) => {
      // HL: side "A" (ask/sell), "B" (bid/buy)
      const side = o.side === 'A' ? 'SELL' : o.side === 'B' ? 'BUY' : String(o.side ?? '').toUpperCase();

      // HL: prices/sizes come as strings
      const price = Number(o.limitPx);
      const origQty = Number(o.origSz ?? o.sz);
      const openQty = Number(o.sz);

      // if you want executed: orig - remaining (best effort)
      const executedQty = Number.isFinite(origQty) && Number.isFinite(openQty) ? Math.max(0, origQty - openQty) : 0;

      return {
        // coin id as symbol for now; you can map "@142" -> "BTC" elsewhere if needed
        symbol: String(o.coin),
        orderId: Number(o.oid),

        price: String(Number.isFinite(price) ? price : 0),
        origQty: String(Number.isFinite(origQty) ? origQty : 0),
        executedQty: String(Number.isFinite(executedQty) ? executedQty : 0),

        side,
        time: Number(o.timestamp ?? Date.now()),
      };
    });
  }

  async getOrder(data) {
    const oid = Number(data.orderId);
    if (!Number.isFinite(oid)) throw new Error(`Invalid orderId: ${data.orderId}`);

    const user = this._userAddress;
    const open = await this.info.openOrders({user, dex: ''});
    if (Array.isArray(open) && open.some(o => Number(o.oid) === oid)) {
      return {status: ORDER_STATUS_OPEN};
    }

    const fills = await this.info.userFills({user});
    if (Array.isArray(fills) && fills.some(f => Number(f.oid) === oid)) {
      return {status: ORDER_STATUS_FILLED};
    }

    return {status: ORDER_STATUS_NOT_OPEN};
  }


  async getOrdersStatusMap({orderIds}) {
    const user = this._userAddress;

    // 1) fetch once
    const open = await this.info.openOrders({user, dex: ''});
    const fills = await this.info.userFills({user});

    // 2) build fast lookups
    const openSet = new Set((open || []).map(o => Number(o.oid)));
    const filledSet = new Set((fills || []).map(f => Number(f.oid)));

    // 3) map statuses only for what you care about
    const out = new Map();
    for (const raw of orderIds) {
      const oid = Number(raw);
      if (!Number.isFinite(oid)) continue;

      if (openSet.has(oid)) out.set(oid, {status: ORDER_STATUS_OPEN});
      else if (filledSet.has(oid)) out.set(oid, {status: ORDER_STATUS_FILLED});
      else out.set(oid, {status: ORDER_STATUS_NOT_OPEN});
    }

    return out;
  }

  async getAccountInfo() {
    const res = await this.getBalances(); // currently returns { balances: [...] }

    const balances = (res?.balances ?? []).map((b) => ({
      asset: String(b.coin),          // USDC, UBTC, etc
      free: String(Number(b.total) - Number(b.hold || 0)), // spendable
      locked: String(b.hold ?? 0),    // reserved/held
    }));

    return {balances};
  }

  /**
   * Cancels open orders. If `symbol` is provided, only cancels orders for that market.
   * Otherwise cancels all open orders.
   */
  async cancelOpenOrders({symbol} = {}) {
    const open = await this.getOpenOrders();
    const filtered = symbol ? open.filter((x) => x.symbol === symbol) : open;

    const cancels = [];
    for (const o of filtered) {
      const oid = Number(o.orderId);
      if (!Number.isFinite(oid)) continue;
      const {asset} = await this.resolveSpotAssetFromSymbol(o.symbol);
      cancels.push({a: asset, o: oid});
    }

    if (cancels.length === 0) return {cancelled: 0};
    const res = await this.exchange.cancel({cancels});
    return {cancelled: cancels.length, raw: res};
  }

  subscribeAggTrades(symbols, handler) {
    const url = this.isTestnet
        ? 'wss://api.hyperliquid-testnet.xyz/ws'
        : 'wss://api.hyperliquid.xyz/ws';

    let ws = null;
    let pingInterval = null;
    let reconnectTimeout = null;
    let isStopped = false;
    let isConnecting = false;

    const coinToSyms = new Map();
    const symToCoin = new Map();

    const buildMappings = async () => {
      coinToSyms.clear();
      symToCoin.clear();

      for (const s of symbols) {
        const symInput = String(s);
        const { symbol: normalizedSym, asset } = await this.resolveSpotAssetFromSymbol(symInput);

        const coinIndex = Number(asset) - 10000;
        if (!Number.isFinite(coinIndex) || coinIndex < 0) {
          throw new Error(`Invalid spot asset mapping for ${symInput}: asset=${asset}`);
        }

        const coin = `@${coinIndex}`;

        symToCoin.set(normalizedSym, coin);

        if (!coinToSyms.has(coin)) {
          coinToSyms.set(coin, new Set());
        }

        coinToSyms.get(coin).add(normalizedSym);
      }
    };

    let mappingsReady = false;
    let mappingsError = null;

    const mappingsPromise = buildMappings()
        .then(() => {
          mappingsReady = true;
        })
        .catch((e) => {
          mappingsError = e;
          console.log(`HL WS mapping error: ${e?.message ?? e}`);
        });

    const clearPingInterval = () => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
    };

    const clearReconnectTimeout = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    const scheduleReconnect = () => {
      if (isStopped) return;
      if (reconnectTimeout) return;

      console.log('HL WS reconnecting in 1s...');

      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        void connect();
      }, 1000);
    };

    const connect = async () => {
      if (isStopped || isConnecting) return;

      isConnecting = true;

      try {
        await mappingsPromise;

        if (!mappingsReady) {
          console.log(`HL WS not started because mappings failed: ${mappingsError?.message ?? mappingsError}`);
          scheduleReconnect();
          return;
        }

        ws = new WebSocket(url);

        ws.on('open', () => {
          console.log(`HL WS connected. Subscribing to ${coinToSyms.size} coins`);

          for (const coin of coinToSyms.keys()) {
            ws.send(JSON.stringify({
              method: 'subscribe',
              subscription: { type: 'trades', coin },
            }));
          }

          clearPingInterval();

          pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ method: 'ping' }));
            }
          }, 30000);
        });

        ws.on('message', (raw) => {
          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            return;
          }

          if (msg.channel === 'pong') {
            return;
          }

          if (msg.channel !== 'trades' || !Array.isArray(msg.data)) {
            return;
          }

          for (const t of msg.data) {
            const coin = t.coin;
            const price = Number(t.px);
            if (!Number.isFinite(price)) continue;

            const syms = coinToSyms.get(coin);
            if (!syms || syms.size === 0) continue;

            for (const sym of syms) {
              handler({ symbol: sym, price });
            }
          }
        });

        ws.on('error', (err) => {
          console.log(`HL WS error: ${err?.message ?? err}`);
        });

        ws.on('close', (code, reason) => {
          console.log(`HL WS closed: code=${code} reason=${reason?.toString?.() || ''}`);

          clearPingInterval();
          ws = null;

          if (!isStopped) {
            scheduleReconnect();
          }
        });
      } catch (err) {
        console.log(`HL WS connect error: ${err?.message ?? err}`);
        scheduleReconnect();
      } finally {
        isConnecting = false;
      }
    };

    void connect();

    return () => {
      isStopped = true;

      clearReconnectTimeout();
      clearPingInterval();

      try {
        if (ws && ws.readyState === WebSocket.OPEN && !mappingsError) {
          for (const coin of coinToSyms.keys()) {
            ws.send(JSON.stringify({
              method: 'unsubscribe',
              subscription: { type: 'trades', coin },
            }));
          }
        }
      } catch (err) {
        console.log(`HL WS unsubscribe error: ${err?.message ?? err}`);
      } finally {
        if (ws) {
          ws.close();
          ws = null;
        }
      }
    };
  }
}
