export async function openOrdersRoutes(app, { models }) {
    const { OpenOrders } = models;

    app.get("/open-orders", async (request) => {
        const { trade_instance_id, pair } = request.query ?? {};
        const where = {};
        if (trade_instance_id) where.trade_instance_id = Number(trade_instance_id);
        if (pair) where.pair = pair;

        return OpenOrders.findAll({ where, order: [["id", "DESC"]] });
    });

    app.post("/open-orders", async (request, reply) => {
        const row = await OpenOrders.create(request.body ?? {});
        return reply.code(201).send(row);
    });
}
