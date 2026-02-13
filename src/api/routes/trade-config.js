export async function tradeConfigRoutes(app, { models }) {
    const { TradeConfig } = models;

    app.get("/trade-config", async (request, reply) => {
        const { pair, trade_instance_id } = request.query ?? {};

        const where = {};
        if (pair != null && pair !== "") where.pair = pair;
        if (trade_instance_id != null && trade_instance_id !== "")
            where.trade_instance_id = Number(trade_instance_id);

        const rows = await TradeConfig.findAll({
            where,
            order: [["id", "ASC"]],
        });

        return rows;
    });

    app.put("/trade-config/:id", async (request, reply) => {
        const id = Number(request.params.id);
        const patch = request.body ?? {};

        // evita atualizar id sem querer
        delete patch.id;

        const row = await TradeConfig.findByPk(id);
        if (!row) return reply.code(404).send({ error: "trade_config not found" });

        await row.update(patch);
        return row;
    });
}
