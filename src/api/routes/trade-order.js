export async function tradeOrderRoutes(app, { models }) {
    const { TradeOrder } = models;

    // GET /api/trade-order?pair=&trade_instance_id=
    app.get("/trade-order", async (request) => {
        const { pair, trade_instance_id } = request.query ?? {};

        const where = {};
        if (pair != null && pair !== "") where.pair = pair;
        if (trade_instance_id != null && trade_instance_id !== "")
            where.trade_instance_id = Number(trade_instance_id);

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
}
