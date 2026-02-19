import { fetchHyperliquidMidFromPair } from "../../functions/functions.js";

export async function tradeConfigRoutes(app, { models }) {
    const { TradeConfig, TradeOrder } = models;

    app.get("/trade-config", async (request, reply) => {
        const { pair, trade_instance_id } = request.query ?? {};

        const where = {};
        if (pair != null && pair !== "") where.pair = pair;
        if (trade_instance_id != null && trade_instance_id !== "") {
            where.trade_instance_id = Number(trade_instance_id);
        }

        const rows = await TradeConfig.findAll({
            where,
            order: [["id", "ASC"]],
        });

        return rows;
    });

    app.get("/trade-config/:id/simulate", async (request, reply) => {
        const id = Number(request.params?.id);
        if (!Number.isFinite(id) || id <= 0) {
            return reply.code(400).send({ error: "id is required" });
        }

        const row = await TradeConfig.findByPk(id);
        if (!row) return reply.code(404).send({ error: "id not found" });

        const cfg = row.toJSON();

        const result = await buildGrid(cfg, { save: false });
        if (result.error) return reply.code(400).send({ error: result.error });

        return result;
    });

    app.post("/trade-config/:id/build-grid", async (request, reply) => {
        const id = Number(request.params?.id);
        if (!Number.isFinite(id) || id <= 0) {
            return reply.code(400).send({ error: "id is required" });
        }

        const row = await TradeConfig.findByPk(id);
        if (!row) return reply.code(404).send({ error: "id not found" });

        const cfg = row.toJSON();

        if (!TradeOrder) {
            return reply.code(500).send({ error: "TradeOrder model not available" });
        }

        const result = await buildGrid(cfg, { save: true ,  saveTradeOrder: async (o) => TradeOrder.create(o)});

        if (result.error) return reply.code(400).send({ error: result.error });

        return result;
    });

    app.put("/trade-config/:id", async (request, reply) => {
        const id = Number(request.params?.id);
        if (!Number.isFinite(id) || id <= 0) {
            return reply.code(400).send({ error: "id is required" });
        }

        const row = await TradeConfig.findByPk(id);
        if (!row) return reply.code(404).send({ error: "id not found" });

        const body = request.body ?? {};

        const allowed = [
            "pair",
            "entry_price",
            "exit_price",
            "target_percent",
            "margin_percent",
            "usd_transaction",
            "decimal_quantity",
            "decimal_price",
            "name",
            "rebuy_profit",
            "order_block_price",
            "order_block_id",
            "rebuy_percent",
            "rebuy_value",
            "execution_price_min",
            "execution_price_max",
        ];

        const floatFields = new Set([
            "entry_price",
            "exit_price",
            "target_percent",
            "margin_percent",
            "usd_transaction",
            "order_block_price",
            "rebuy_value",
            "execution_price_min",
            "execution_price_max",
        ]);

        const intFields = new Set(["decimal_quantity", "decimal_price", "rebuy_percent"]);
        const boolFields = new Set(["rebuy_profit"]);

        for (const key of allowed) {
            if (body[key] === undefined) continue;
            if (String(key).startsWith("rebought_")) continue;

            const raw = body[key];

            if (boolFields.has(key)) {
                const v = String(raw).trim().toLowerCase();
                row[key] = v === "true" || v === "1" || v === "on";
                continue;
            }

            if (intFields.has(key)) {
                const v = String(raw).trim();
                row[key] = v === "" ? null : Number.parseInt(v, 10);
                continue;
            }

            if (floatFields.has(key)) {
                const v = String(raw).trim();
                row[key] = v === "" ? null : Number(v);
                continue;
            }

            row[key] = String(raw).trim();
        }

        await row.save();

        const isHtmx = String(request.headers["hx-request"] ?? "") === "true";
        if (isHtmx) {
            return reply
                .type("text/html; charset=utf-8")
                .send('<div class="alert alert-success mb-0">Config saved ✅</div>');
        }

        return { ok: true, id: row.id };
    });
}

function sanitizePairKey(pair) {
    return String(pair || "").replace(/[\/\-_]/g, "");
}

function toNum(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function roundTo(n, decimals) {
    if (!Number.isFinite(n)) return n;
    const d = Number(decimals ?? 0);
    if (!Number.isFinite(d) || d < 0) return n;
    return Number(n.toFixed(d));
}

async function buildGrid(cfg, { save, saveTradeOrder  } = {}) {
    const entry = toNum(cfg.entry_price);
    const exit = toNum(cfg.exit_price);
    const targetPct = toNum(cfg.target_percent);
    const marginPct = toNum(cfg.margin_percent);
    const usdPerLevel = toNum(cfg.usd_transaction);

    const decQty = Number(cfg.decimal_quantity ?? 0);
    const decPrice = Number(cfg.decimal_price ?? 0);

    const errors = [];
    if (!Number.isFinite(entry)) errors.push("entry_price");
    if (!Number.isFinite(exit)) errors.push("exit_price");
    if (!Number.isFinite(targetPct)) errors.push("target_percent");
    if (!Number.isFinite(marginPct)) errors.push("margin_percent");
    if (!Number.isFinite(usdPerLevel)) errors.push("usd_transaction");

    if (errors.length) {
        return { error: `Missing/invalid fields: ${errors.join(", ")}` };
    }

    const currentPrice = await fetchHyperliquidMidFromPair(cfg.pair);
    const pxNow = Number.isFinite(currentPrice) ? currentPrice : entry;

    let buyPrice = entry;
    let sellPrice = buyPrice + (buyPrice * targetPct) / 100;

    const rows = [];
    let savedCount = 0;

    let sumQuantityCoin = 0;
    let sumQuantityUsd = 0;

    let guard = 0;
    const maxLevels = 10000;

    while (sellPrice < exit && guard < maxLevels) {
        guard += 1;

        const quantity = roundTo(usdPerLevel / buyPrice, decQty);

        if (sellPrice > pxNow) sumQuantityCoin += quantity;
        else sumQuantityUsd += 1;

        const buyRounded = roundTo(buyPrice, decPrice);
        const sellRounded = roundTo(sellPrice, decPrice);

        rows.push({
            buy_price: buyRounded,
            sell_price: sellRounded,
            quantity,
        });

        if (save) {
            if (typeof saveTradeOrder !== 'function') {
                return { error: 'saveTradeOrder not provided' };
            }

            await saveTradeOrder({
                pair: cfg.pair,
                buy_price: buyRounded,
                sell_price: sellRounded,
                quantity,
                entry_price: pxNow,
                last_operation: false,
                trade_instance_id: cfg.trade_instance_id,
            });

            savedCount += 1;
        }

        buyPrice = buyPrice + (buyPrice * marginPct) / 100;
        sellPrice = buyPrice + (buyPrice * targetPct) / 100;
    }

    if (guard >= maxLevels) {
        return { error: `Exceeded max grid levels (${maxLevels}). Check margin_percent/target_percent.` };
    }

    const totalCoinUsd = sumQuantityCoin * pxNow;
    const quoteNeededUsd = sumQuantityUsd * usdPerLevel;

    const sellRowsAbove = rows.filter(r => r.sell_price > pxNow);
    const baseNeeded = sellRowsAbove.reduce((acc, r) => acc + r.quantity, 0);

    const proceedsIfSoldAlongTheWay = sellRowsAbove.reduce(
        (acc, r) => acc + (r.quantity * r.sell_price),
        0
    );

    const costIfBoughtNow = baseNeeded * pxNow;

    const profitIfSoldAlongTheWay = proceedsIfSoldAlongTheWay - costIfBoughtNow;
    const profitIfHeldToExit = baseNeeded * (exit - pxNow);

    const orderValue = usdPerLevel;
    const grossProfitPerOp = orderValue * (targetPct / 100);
    const exchangeFees = orderValue * 0.0015;
    const netProfitPerOp = grossProfitPerOp - exchangeFees;

    return {
        rows,
        savedCount,
        meta: {
            pair: cfg.pair,
            pairKey: sanitizePairKey(cfg.pair),
            name: cfg.name,
            config_id: cfg.id,
            trade_instance_id: cfg.trade_instance_id,
            source_price: Number.isFinite(currentPrice) ? "hyperliquid_allMids" : "fallback_entry_price",
        },
        summary: {
            levels: rows.length,
            entry_price: entry,
            exit_price: exit,
            target_percent: targetPct,
            margin_percent: marginPct,
            usd_per_level: usdPerLevel,
            current_price: pxNow,

            base_needed: sumQuantityCoin,
            base_value_usd: totalCoinUsd,
            quote_levels_below_price: sumQuantityUsd,
            quote_needed_usd: quoteNeededUsd,

            profit_if_sold_along_the_way: profitIfSoldAlongTheWay,
            profit_if_held_to_exit: profitIfHeldToExit,

            gross_profit_per_op_usd: grossProfitPerOp,
            est_fees_per_op_usd: exchangeFees,
            est_net_profit_per_op_usd: netProfitPerOp,

            est_total_usd_needed: quoteNeededUsd + totalCoinUsd,
        },
    };
}
