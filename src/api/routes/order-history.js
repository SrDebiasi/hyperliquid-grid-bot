export async function orderHistoryRoutes(app, { models }) {
    const { OrderHistory } = models;

    app.get("/order-history", async (request) => {
        const { trade_instance_id, pair } = request.query ?? {};
        const where = {};
        if (trade_instance_id) where.trade_instance_id = Number(trade_instance_id);
        if (pair) where.pair = pair;

        return OrderHistory.findAll({ where, order: [["id", "DESC"]] });
    });

    app.post("/order-history", async (request, reply) => {
        const row = await OrderHistory.create(request.body ?? {});
        return reply.code(201).send(row);
    });
}
