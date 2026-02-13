/**
 * ExchangeAdapter is a small abstraction layer so the strategy can be reused
 * across multiple exchanges (Binance today, Hyperliquid next).
 *
 * Keep this interface intentionally minimal and grow it only when needed.
 */

export class ExchangeAdapter {
  /**
   * Return a symbol->price map.
   * @returns {Promise<Record<string, string | number>>}
   */
  async getPrices() {
    throw new Error('Not implemented');
  }

  /**
   * Place an order (LIMIT / MARKET / etc.).
   * The shape should be compatible with the current strategy needs.
   * @param {any} param
   * @returns {Promise<any>}
   */
  async placeOrder(param) {
    throw new Error('Not implemented');
  }

  /**
   * Place a LIMIT order.
   * @param {{symbol:string, side:'BUY'|'SELL', price:number|string, quantity:number|string}} param
   * @returns {Promise<any>}
   */
  async placeLimitOrder(param) {
    throw new Error('Not implemented');
  }

  /**
   * Cancel a single order.
   * @param {{symbol:string, orderId:string|number}} param
   * @returns {Promise<any>}
   */
  async cancelOrder(param) {
    throw new Error('Not implemented');
  }

  /**
   * Cancel all open orders for a symbol.
   * @param {{symbol:string}} param
   * @returns {Promise<any>}
   */
  async cancelOpenOrders(param) {
    throw new Error('Not implemented');
  }

  /**
   * Fetch an order by id.
   * @param {any} param
   * @returns {Promise<any>}
   */
  async getOrder(param) {
    throw new Error('Not implemented');
  }

  /**
   * Fetch account info (balances/positions).
   * @param {any} [param]
   * @returns {Promise<any>}
   */
  async getAccountInfo(param = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Fetch open orders.
   * @param {any} [param]
   * @returns {Promise<any>}
   */
  async getOpenOrders(param = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Subscribe to aggregated trades (or closest equivalent).
   * Must call handler with `{ symbol, price }`.
   *
   * @param {string[]} symbols
   * @param {(evt: {symbol: string, price: number}) => void} handler
   */
  subscribeAggTrades(symbols, handler) {
    throw new Error('Not implemented');
  }
}
