// src/api/routes/dashboard.js


import {getProfitSummary} from "../../reports/profitReportService.js";
import {ensureBotRunning, getBotLogs, getBotStatus, stopBot} from "../../services/pm2Service.js";
import {fetchHyperliquidMidFromPair} from "../../functions/functions.js";

export async function dashboardRoutes(app, opts) {
    const { models } = opts;

    app.get("/dashboard", async (request, reply) => {
        // Adjust this key if your buildModels() exports a different name
        const instanceRow = await models.TradeInstance.findOne({ order: [["id", "ASC"]] });
        const instance = instanceRow ? instanceRow.toJSON() : null;

        let config = null;
        let rebuy = {};
        let orders = [];
        let profitSummary = null;
        if (instance) {
            const configRow = await models.TradeConfig.findOne({
                where: { trade_instance_id: instance.id },
                order: [["id", "ASC"]],
            });
            config = configRow ? configRow.toJSON() : null;

            const ordersRaw = await models.TradeOrder.findAll({
                where: { trade_instance_id: instance.id },
            });

             orders = ordersRaw
                .map((o) => o.get({ plain: true }))
                .sort((a, b) => {
                    const ap = Number(a.buy_price ?? 0);
                    const bp = Number(b.buy_price ?? 0);
                    return ap - bp; // ascending by buy_price
                });

            const currentPrice = await fetchHyperliquidMidFromPair(config.pair);
            const reboughtCoin = Number(config.rebought_coin ?? 0);
            const reboughtValueUsd = Number(config.rebought_value ?? 0);
            const currentValueUsd = reboughtCoin * currentPrice;
            const avgPriceUsd = reboughtCoin > 0 ? (reboughtValueUsd / reboughtCoin) : 0;
            rebuy = {
                active: config.rebuy_profit,
                reboughtCoin,
                reboughtValueUsd,
                currentPrice,
                currentValueUsd,
                avgPriceUsd,
                name : config.name
            };

             profitSummary = instance
                ? await getProfitSummary({ models, tradeInstanceId: instance.id })
                : null;
        }

        const botStatus = instance
            ? await getBotStatus({ instanceId: instance.id })
            : { isRunning: false, statusText: 'stopped' };

        return reply.view("layout.ejs", {
            page: "pages/dashboard.ejs",
            title: "Grid Bot Dashboard",
            now: new Date().toISOString(),
            instance,
            botStatus,
            config,
            orders,
            profitSummary,
            rebuy
        });
    });

    app.post("/dashboard/instances/:id/start", async (request, reply) => {
        const instanceId = Number(request.params.id);
        if (!Number.isFinite(instanceId)) return reply.code(400).send({ error: "Invalid instance id" });

        await ensureBotRunning({ instanceId });
        return reply.redirect("/dashboard");
    });

    app.post("/dashboard/instances/:id/stop", async (request, reply) => {
        const instanceId = Number(request.params.id);
        if (!Number.isFinite(instanceId)) return reply.code(400).send({ error: "Invalid instance id" });

        await stopBot({ instanceId });
        return reply.redirect("/dashboard");
    });

    app.get("/dashboard/profits", async (request, reply) => {
        const instanceRow = await models.TradeInstance.findOne({ order: [["id", "ASC"]] });
        const instance = instanceRow ? instanceRow.toJSON() : null;

        const profitSummary = instance
            ? await getProfitSummary({ models, tradeInstanceId: instance.id })
            : null;

        return reply.view("partials/profits.ejs", { profitSummary });
    });

    app.get("/dashboard/instances/:id/logs", async (request, reply) => {
        const instanceId = Number(request.params.id);
        const lines = Math.min(Number(request.query.lines ?? 100) || 100, 500);

        if (!Number.isFinite(instanceId)) return reply.code(400).send("Invalid instance id");

        const logs = await getBotLogs({ instanceId, lines });

        return reply.view("partials/pm2_logs.ejs", { logs, lines });
    });
}
