export async function tradeInstanceRoutes(app, { models }) {
  const { TradeInstance } = models;

  // GET /api/trade-instance?trade_instance_id=1
  app.get('/trade-instance', async (request, reply) => {
    let { id } = request.query ?? {};
    id = Number(id);

    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: 'id is required' });
    }

    const row = await TradeInstance.findByPk(id);
    if (!row) return reply.code(404).send({ error: 'id not found' });

    return row;
  });
}
