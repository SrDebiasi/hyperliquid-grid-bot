import {getHyperliquidAdapterForApi} from "../helpers/getHyperliquidAdapterForApi.js";

export async function tradeOrderRoutes(app, { models }) {
    const { TradeOrder } = models;

    // GET /api/trade-order?pair=&trade_instance_id=
    app.get("/trade-order", async (request) => {
        const { id, pair, trade_instance_id } = request.query ?? {};

        const where = {};

        if (id != null && id !== "") {
            where.id = Number(id);

            const row = await TradeOrder.findOne({ where });
            return row;
        }

        if (pair != null && pair !== "") {
            where.pair = pair;
        }

        if (trade_instance_id != null && trade_instance_id !== "") {
            where.trade_instance_id = Number(trade_instance_id);
        }

        const rows = await TradeOrder.findAll({
            where,
            order: [["id", "ASC"]],
        });

        return rows;
    });

    // POST /api/trade-order
    app.post("/trade-order", async (request, reply) => {
        const body = request.body ?? {};
        const row = await TradeOrder.create(body);
        return reply.code(201).send(row);
    });

    // PUT /api/trade-order/:id
    app.put("/trade-order/:id", async (request, reply) => {
        const id = Number(request.params.id);
        const patch = request.body ?? {};

        delete patch.id;

        const row = await TradeOrder.findByPk(id);
        if (!row) return reply.code(404).send({ error: "trade_order not found" });

        await row.update(patch);
        return row;
    });

    app.delete('/trade-order/bulk', async (request, reply) => {
        const body = request.body ?? {};
        const idsRaw = Array.isArray(body.ids) ? body.ids : [];

        if (idsRaw.length === 0) {
            return reply.code(400).send({ error: 'No ids provided' });
        }

        // sanitize ids
        const ids = [];
        for (const x of idsRaw) {
            const id = Number(x);
            if (Number.isFinite(id) && id > 0) ids.push(id);
        }

        if (ids.length === 0) {
            return reply.code(400).send({ error: 'No valid ids provided' });
        }

        const rows = await TradeOrder.findAll({ where: { id: ids } });
        if (!rows.length) {
            return reply.code(404).send({ error: 'No matching TradeOrder rows found' });
        }

        const tradeInstanceId = rows[0]?.trade_instance_id;

        // Build cancels grouped by symbol (your adapter bulk cancel assumes same symbol)
        const cancelsBySymbol = new Map(); // symbol -> [{symbol, orderId, tradeOrderId, side}]
        for (const row of rows) {
            const symbol = row.pair;
            if (!symbol) continue;

            const list = cancelsBySymbol.get(symbol) ?? [];
            if (row.buy_order) list.push({ symbol, orderId: row.buy_order, tradeOrderId: row.id, side: 'BUY' });
            if (row.sell_order) list.push({ symbol, orderId: row.sell_order, tradeOrderId: row.id, side: 'SELL' });

            if (list.length) cancelsBySymbol.set(symbol, list);
        }

        const cancelled = [];
        const failed = [];

        // Cancel on HL (best effort)
        if (cancelsBySymbol.size > 0) {
            const exchange = await getHyperliquidAdapterForApi({ models, tradeInstanceId });

            for (const [, cancels] of cancelsBySymbol.entries()) {
                try {
                    await exchange.cancelOrders({
                        cancels: cancels.map(({ symbol, orderId }) => ({ symbol, orderId })),
                    });
                    for (const c of cancels) cancelled.push({ ...c, ok: true });
                } catch (e) {
                    for (const c of cancels) {
                        try {
                            await exchange.cancelOrder({ symbol: c.symbol, orderId: c.orderId });
                            cancelled.push({ ...c, ok: true });
                        } catch (err2) {
                            failed.push({ ...c, ok: false, error: String(err2?.message ?? err2) });
                        }
                    }
                }
            }
        }

        // Delete rows
        const deleted = await TradeOrder.destroy({ where: { id: ids } });

        return {
            ok: true,
            deleted,
            cancelledCount: cancelled.length,
            failedCount: failed.length,
            cancelled,
            failed,
        };
    });

    app.patch('/trade-order/bulk-qty', async (request, reply) => {
        const body = request.body ?? {};
        const updates = Array.isArray(body.updates) ? body.updates : [];

        if (updates.length === 0) {
            return reply.code(400).send({ error: 'No updates provided' });
        }

        // Basic validation + sanitize
        const sanitized = [];
        for (const u of updates) {
            const id = Number(u?.id);
            const quantity = Number(u?.quantity);

            if (!Number.isFinite(id) || id <= 0) continue;
            if (!Number.isFinite(quantity) || quantity <= 0) continue;

            sanitized.push({ id, quantity });
        }

        if (sanitized.length === 0) {
            return reply.code(400).send({ error: 'No valid updates provided' });
        }

        // Load rows so we can cancel HL orderIds
        const ids = sanitized.map((x) => x.id);
        const rows = await TradeOrder.findAll({ where: { id: ids } });

        // If nothing found, still update will do nothing, but better to return clear error
        if (!rows.length) {
            return reply.code(404).send({ error: 'No matching TradeOrder rows found' });
        }

        // If you expect mixed instances in one request, we can group by trade_instance_id
        // For now assume same instance (most common)
        const tradeInstanceId = rows[0]?.trade_instance_id;

        // Build cancels grouped by symbol because adapter cancelOrders() assumes same symbol
        const cancelsBySymbol = new Map(); // symbol -> [{symbol, orderId, tradeOrderId, side}]
        for (const row of rows) {
            const symbol = row.pair; // must be "BTC/USDC" etc
            if (!symbol) continue;

            const list = cancelsBySymbol.get(symbol) ?? [];

            if (row.buy_order) list.push({ symbol, orderId: row.buy_order, tradeOrderId: row.id, side: 'BUY' });
            if (row.sell_order) list.push({ symbol, orderId: row.sell_order, tradeOrderId: row.id, side: 'SELL' });

            if (list.length) cancelsBySymbol.set(symbol, list);
        }

        const cancelled = [];
        const failed = [];

        // Cancel on HL (best effort)
        if (cancelsBySymbol.size > 0) {
            const exchange = await getHyperliquidAdapterForApi({ models, tradeInstanceId });

            for (const [symbol, cancels] of cancelsBySymbol.entries()) {
                // First try bulk cancel
                try {
                    await exchange.cancelOrders({ cancels: cancels.map(({ symbol, orderId }) => ({ symbol, orderId })) });
                    for (const c of cancels) cancelled.push({ ...c, ok: true });
                    continue;
                } catch (e) {
                    // fallback to individual cancels so one bad oid doesn't block all
                    for (const c of cancels) {
                        try {
                            await exchange.cancelOrder({ symbol: c.symbol, orderId: c.orderId });
                            cancelled.push({ ...c, ok: true });
                        } catch (err2) {
                            failed.push({ ...c, ok: false, error: String(err2?.message ?? err2) });
                        }
                    }
                }
            }
        }

        // Update quantities
        for (const u of sanitized) {
            await TradeOrder.update(
                { quantity: u.quantity },
                { where: { id: u.id } },
            );
        }

        return {
            ok: true,
            updated: sanitized.length,
            cancelledCount: cancelled.length,
            failedCount: failed.length,
            cancelled,
            failed,
        };
    });
}
