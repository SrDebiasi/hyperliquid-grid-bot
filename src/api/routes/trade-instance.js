export async function tradeInstanceRoutes(app, { models }) {
  const { TradeInstance } = models;

  // GET /api/trade-instance?id=1
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

  // PUT /api/trade-instance/:id/secrets
  // Accepts either form body (from HTMX) or JSON
  app.put('/trade-instance/:id/secrets', async (request, reply) => {
    const id = Number(request.params?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: 'id is required' });
    }

    const row = await TradeInstance.findByPk(id);
    if (!row) return reply.code(404).send({ error: 'id not found' });

    const walletAddressRaw = String(request.body?.wallet_address ?? '').trim();
    const privateKeyRaw = String(request.body?.private_key ?? '').trim();

    // wallet can be set/cleared
    row.wallet_address = walletAddressRaw || null;

    // only overwrite private key if user provided a new one
    if (privateKeyRaw) {
      row.private_key = privateKeyRaw;
    }

    await row.save();

    const isHtmx = String(request.headers['hx-request'] ?? '') === 'true';

    if (isHtmx) {
      return reply
          .code(200)
          .type('text/html; charset=utf-8')
          .send('<div class="alert alert-success mb-0">Secrets saved ✅</div>');
    }

    return {
      ok: true,
      id: row.id,
      hasWalletAddress: Boolean(row.wallet_address),
      hasPrivateKey: Boolean(row.private_key),
    };
  });
}
