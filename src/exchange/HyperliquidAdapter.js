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
 * npm i  (SPOT ONLY)
 *
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
export default class HyperliquidAdapter {
  /**
   * @param {{
   *  privateKey: string,
   *  isTestnet?: boolean
   * }} params
   */
  constructor({ privateKey, userAddress, isTestnet = false } = {}) {
    if (!privateKey) throw new Error('HyperliquidAdapter requires privateKey');
    if (!userAddress) throw new Error('HyperliquidAdapter requires userAddress (main account)');

    const pk = String(privateKey).startsWith('0x') ? String(privateKey) : `0x${privateKey}`;
    const account = privateKeyToAccount(pk);

    this.isTestnet = isTestnet;

    this._agentAddress = account.address;
    this._userAddress = String(userAddress).trim();

    this.info = new InfoClient({ transport: new HttpTransport({ isTestnet }) });

    this.exchange = new ExchangeClient({
      transport: new HttpTransport({ isTestnet }),
      wallet: account, // agent signs
    });

    this.subs = new SubscriptionClient({
      transport: new WebSocketTransport({ isTestnet }),
    });

    this.pairs = new Map();
    this.midCache = new Map();
    this.priceUnsubs = new Map();
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

      this.pairs.set(u.name, { pairIndex, spotCoinId, orderAssetId });
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
    const mids = await this.info.allMids(); // { BTC: "67351", ... }
    const out = {};

    const inputs = (pairs && pairs.length)
      ? pairs
      : Object.keys(mids).map((c) => `${c}USDC`);

    for (const raw of inputs) {
      const s = String(raw).toUpperCase();

      // normalize the input into a coin and a clean output key
      // examples:
      // "BTC/USDC" -> coin BTC, key BTCUSDC
      // "BTC-USDC" -> coin BTC, key BTCUSDC
      // "BTC_USDC" -> coin BTC, key BTCUSDC
      // "BTCUSDC"  -> coin BTC, key BTCUSDC
      // "BTC"      -> coin BTC, key BTCUSDC
      const clean = s.replace(/[\/\-_]/g, '');
      const coin = clean.endsWith('USDC') ? clean.slice(0, -4) : clean;

      const px = Number(mids[coin]);
      if (!Number.isFinite(px)) continue;

      const key = clean.endsWith('USDC') ? clean : `${coin}USDC`;
      out[key] = px;
    }

    return out;
  }

  normalizeSymbol(input) {
    let symbol = String(input || '').trim();
    if (!symbol.includes('/') && symbol.length >= 6) {
      symbol = symbol.replace(/^(.*?)(USDC|USDT)$/, '$1/$2');
    }
    const sUp = symbol.toUpperCase();
    if (sUp.endsWith('/USDC')) {
      const [base, quote] = sUp.split('/');
      const baseMap = { BTC: 'UBTC', ETH: 'UETH', SOL: 'USOL' };
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
    return { symbol, asset };
  }


  /**
   * Spot limit order submitter (assumes symbol + asset already resolved).
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
  async placeLimitOrder(param) {
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

    // Tick size handling (still your existing assumption)
    const tick = 1;

    // Snap price
    price = Math.floor(price / tick) * tick;
    price = Math.trunc(price);

    const tif = postOnly ? 'Alo' : 'Gtc';

    const req = {
      orders: [
        {
          a: asset,
          b: side === 'BUY',
          p: String(price),
          s: String(quantity),
          r: false,
          t: { limit: { tif } },
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

    const { symbol, asset } = await this.resolveSpotAssetFromSymbol(param.symbol);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity: ${param.quantity}`);
    }
    if (type !== 'LIMIT') {
      throw new Error(`Unsupported order type for HyperliquidAdapter: ${param.type}`);
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid LIMIT price: ${param.price}`);
    }

    const orderToSubmit = {
      symbol,
      side,
      price,
      quantity,
      postOnly: param.postOnly !== undefined ? !!param.postOnly : false,
      asset,
    };
    const res = await this.placeLimitOrder(orderToSubmit);
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
      type: 'LIMIT',
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
  async cancelOrder({ orderId, symbol }) {
    const o = Number(orderId);
    if (!Number.isFinite(o)) throw new Error(`Invalid orderId: ${orderId}`);
    const { asset } = await this.resolveSpotAssetFromSymbol(symbol);
    return await this.exchange.cancel({ cancels: [{ a: asset, o }] });
  }


  /**
   * Spot balances / state.
   */
  async getBalances() {
    return await this.info.spotClearinghouseState({ user: this._user() });
  }

  async getOpenOrders() {
    const rows = await this.info.openOrders({ user: this._userAddress, dex: '' });

    return (rows ?? []).map((o) => ({
      symbol: o.symbol ?? o.coin ?? o.market,
      orderId: o.orderId ?? o.oid,
      clientOrderId: o.clientOrderId ?? o.cloid ?? null,
      price: String(o.price ?? o.limitPx ?? o.px ?? 0),
      origQty: String(o.origQty ?? o.sz ?? o.qty ?? 0),
      executedQty: String(o.executedQty ?? o.filledSz ?? o.filledQty ?? 0),
      side: (o.side ?? o.dir ?? '').toUpperCase(),
      time: o.time ?? o.timestamp ?? o.createdAt ?? Date.now(),
    }));
  }

  async getOrder(data) {
    const oid = Number(data.orderId);
    if (!Number.isFinite(oid)) throw new Error(`Invalid orderId: ${data.orderId}`);

    const user = this._userAddress;
    const open = await this.info.openOrders({ user, dex: '' });
    if (Array.isArray(open) && open.some(o => Number(o.oid) === oid)) {
      return { status: 'OPEN' };
    }

    const fills = await this.info.userFills({ user });
    if (Array.isArray(fills) && fills.some(f => Number(f.oid) === oid)) {
      return { status: 'FILLED' };
    }

    return { status: 'NOT_OPEN_NO_FILL' };
  }

  async getAccountInfo() {
    const res = await this.getBalances(); // currently returns { balances: [...] }

    const balances = (res?.balances ?? []).map((b) => ({
      asset: String(b.coin),          // USDC, UBTC, etc
      free: String(Number(b.total) - Number(b.hold || 0)), // spendable
      locked: String(b.hold ?? 0),    // reserved/held
    }));

    return { balances };
  }

  /**
   * Cancels open orders. If `symbol` is provided, only cancels orders for that market.
   * Otherwise cancels all open orders.
   */
  async cancelOpenOrders({ symbol } = {}) {
    const open = await this.getOpenOrders();
    const filtered = symbol ? (open ?? []).filter((o) => o.symbol === symbol) : (open ?? []);
    const cancels = filtered
      .map((o) => ({ oid: Number(o.oid ?? o.orderId) }))
      .filter((c) => Number.isFinite(c.oid));
    if (cancels.length === 0) return { cancelled: 0 };
    const res = await this.exchange.cancel({ cancels });
    return { cancelled: cancels.length, raw: res };
  }

  async close() {
    for (const [symbol, unsub] of this.priceUnsubs.entries()) {
      try {
        await unsub();
      } catch (e) {
        // ignore
      }
      this.priceUnsubs.delete(symbol);
    }
  }


  subscribeAggTrades(symbols, handler) {
    const url = this.isTestnet
      ? 'wss://api.hyperliquid-testnet.xyz/ws'
      : 'wss://api.hyperliquid.xyz/ws'; // per HL docs :contentReference[oaicite:3]{index=3}

    const ws = new WebSocket(url);

    // keep map so we can emit the same "symbol" the rest of your bot expects
    const symToCoin = new Map();
    for (const s of symbols) {
      const sym = String(s);

      // DB pairs: "BTC/USDC", "BTC-USDC", "BTC_USDC" -> coin "BTC"
      const coin = sym.split(/[\/\-_]/g)[0];
      symToCoin.set(sym, coin);
    }

    ws.on('open', () => {
      for (const [sym, coin] of symToCoin.entries()) {
        ws.send(
          JSON.stringify({
            method: 'subscribe',
            subscription: { type: 'trades', coin }, // HL trades subscription :contentReference[oaicite:4]{index=4}
          }),
        );
      }
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // trades messages: channel === "trades", data is WsTrade[] :contentReference[oaicite:5]{index=5}
      if (msg.channel !== 'trades' || !Array.isArray(msg.data)) return;

      for (const t of msg.data) {
        const coin = t.coin;
        const price = Number(t.px); // WsTrade.px is string price :contentReference[oaicite:6]{index=6}
        if (!Number.isFinite(price)) continue;

        // Emit for every symbol that maps to this coin
        for (const [sym, c] of symToCoin.entries()) {
          if (c === coin) handler({ symbol: sym, price });
        }
      }
    });

    ws.on('error', (err) => {
      // up to you how you log
      console.log(`HL WS error: ${err?.message ?? err}`);
    });

    // return unsubscribe/cleanup function
    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          for (const [, coin] of symToCoin.entries()) {
            ws.send(
              JSON.stringify({
                method: 'unsubscribe',
                subscription: { type: 'trades', coin }, // HL unsubscribe format :contentReference[oaicite:7]{index=7}
              }),
            );
          }
        }
      } finally {
        ws.close();
      }
    };
  }
}
