// src/api/routes/market.js
import {fetchLastNDaysKlinesCached} from "../../services/binanceKlinesCacheServices.js";
import {fetchHyperliquidMidFromPair} from "../../functions/functions.js";

function toCandle(k) {
    // Binance kline array:
    // [ openTime, open, high, low, close, volume, closeTime, ... ]
    return {
        time: Math.floor(Number(k[0]) / 1000), // seconds
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
    };
}

export async function marketRoutes(app, opts) {
        const { models } = opts;

        app.get('/api/market/price', async (request, reply) => {
            const { trade_instance_id, pair } = request.query ?? {};

            if (trade_instance_id == null || trade_instance_id == "")
                return { pair, price: 0, dp: 0, dq: 0 };

            let effectivePair = pair ? String(pair) : null;

            // Prefer instance id so we can also return dp reliably
            const ti = Number(trade_instance_id);
            if (!Number.isFinite(ti) || ti <= 0) {
                return reply.code(400).send({error: 'invalid trade_instance_id'});
            }

            const configRow = await models.TradeInstance.findByPk(ti);

            const config = configRow ? configRow.toJSON() : null;
            if (!config?.pair) return reply.code(404).send({ error: 'instance not found or pair not configured' });

            effectivePair = String(config.pair);


            if (!effectivePair) {
                return reply.code(400).send({ error: 'Provide pair or trade_instance_id' });
            }

            const priceRaw = await fetchHyperliquidMidFromPair(effectivePair);
            const price = Number(priceRaw);

            if (!Number.isFinite(price) || price <= 0) {
                return reply.code(502).send({ error: 'price not available', pair: effectivePair });
            }

            return { pair: effectivePair, price, dp: config?.decimal_price, dq: config?.decimal_quantity };
        });

        // GET /api/market/tickers?symbols=BTC,ETH,SOL
        app.get('/api/market/tickers', async (request, reply) => {
            const symbolsRaw = String(request.query.symbols ?? 'BTC,ETH,SOL');
            const symbols = symbolsRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

            let mids = {};
            try {
                const res = await fetch('https://api.hyperliquid.xyz/info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'allMids' }),
                });
                if (res.ok) mids = await res.json();
            } catch (_) {}

            const result = symbols.map(sym => ({
                symbol: sym,
                price: Number(mids?.[sym]) || null,
            }));

            return reply.send(result);
        });

        // GET /market/klines?symbol=BTCUSDT&interval=5m&days=5
        app.get("/api/market/klines", async (request, reply) => {
            const symbol = String(request.query.symbol ?? "BTCUSDT").toUpperCase().trim();
            const interval = String(request.query.interval ?? "5m").trim();

            const daysRaw = Number(request.query.days ?? 5);
            const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 30) : 5;

            // Load instance + config (same logic as dashboard)
            const instanceRow = await models.TradeInstance.findOne({ order: [["id", "ASC"]] });
            const instance = instanceRow ? instanceRow.toJSON() : null;

            const config = instance; // config fields are now on trade_instance

            // Defaults if config missing
            const grid = {
                stepPct: Number(config?.margin_percent ?? 0.1),
                levels: 120,
            };

            const band = {
                rangePct: Number(config?.target_percent ?? 1.8),
                useWicks: true,
            };

            const klines = await fetchLastNDaysKlinesCached({
                symbol,
                interval,
                days,
                refetchYesterday: false,
            });

            const candles = klines.map(toCandle);

            const ordersRaw = instance
                ? await models.TradeOrder.findAll({ where: { trade_instance_id: instance.id } })
                : [];

            const orders = ordersRaw.map((o) => o.get({ plain: true }));

            const orderLines = orders.flatMap((o) => {
                const out = [];

                const buyPrice = Number(o.buy_price);
                if (o.buy_order) {
                    out.push({
                        side: "BUY",
                        price: buyPrice,
                        hasOrderId: !!o.buy_order,
                        orderId: o.buy_order ?? null,
                        qty: Number(o.quantity) || null,
                    });
                }

                const sellPrice = Number(o.sell_price);
                if (o.sell_order) {
                    out.push({
                        side: "SELL",
                        price: sellPrice,
                        hasOrderId: !!o.sell_order,
                        orderId: o.sell_order ?? null,
                        qty: Number(o.quantity) || null,
                    });
                }

                return out;
            });

            return reply.send({
                symbol,
                interval,
                days,
                count: candles.length,
                candles,
                grid,
                band,
                instanceId: instance?.id ?? null,
                configId: config?.id ?? null,
                orderLines,
            });
    });
}