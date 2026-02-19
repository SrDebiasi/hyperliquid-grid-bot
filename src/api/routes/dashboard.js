// src/api/routes/dashboard.js


import {getProfitSummary} from "../../reports/profitReportService.js";
import {ensureBotRunning, getBotStatus, stopBot} from "../../services/pm2Service.js";

export async function dashboardRoutes(app, opts) {
    const { models } = opts;

    app.get("/dashboard", async (request, reply) => {
        // Adjust this key if your buildModels() exports a different name
        const instanceRow = await models.TradeInstance.findOne({ order: [["id", "ASC"]] });
        const instance = instanceRow ? instanceRow.toJSON() : null;

        let config = null;
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
            profitSummary
        });
    });

    app.get("/api/dashboard/profit-summary", async (request, reply) => {
        const instanceRow = await models.TradeInstance.findOne({ order: [["id", "ASC"]] });
        const instance = instanceRow ? instanceRow.toJSON() : null;

        if (!instance) {
            return reply.code(404).send({ error: "No TradeInstance found" });
        }

        const profitSummary = await getProfitSummary({ models, tradeInstanceId: instance.id });
        return reply.send(profitSummary);
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
}
