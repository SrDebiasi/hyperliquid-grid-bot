import fs from 'fs';
import path from 'path';

function updateEnvFile(updates) {
    const envPath = path.resolve(process.cwd(), '.env');
    let content = '';
    try { content = fs.readFileSync(envPath, 'utf8'); } catch (_) {}

    const lines = content.split('\n');
    const updated = new Set();

    const newLines = lines.map(line => {
        const match = line.match(/^([A-Z0-9_]+)=(.*)/);
        if (match && Object.prototype.hasOwnProperty.call(updates, match[1])) {
            updated.add(match[1]);
            return `${match[1]}=${updates[match[1]]}`;
        }
        return line;
    });

    for (const [key, val] of Object.entries(updates)) {
        if (!updated.has(key)) newLines.push(`${key}=${val}`);
    }

    fs.writeFileSync(envPath, newLines.join('\n'), 'utf8');

    for (const [key, val] of Object.entries(updates)) {
        if (val) process.env[key] = val;
        else delete process.env[key];
    }
}

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

  // PUT /api/trade-instance/:id/variables
  app.put('/trade-instance/:id/variables', async (request, reply) => {
    const id = Number(request.params?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: 'id is required' });
    }

    const row = await TradeInstance.findByPk(id);
    if (!row) return reply.code(404).send({ error: 'id not found' });

    const testnet = request.body?.hyperliquid_testnet === '1' || request.body?.hyperliquid_testnet === 'on' ? '1' : '0';

    updateEnvFile({
      TELEGRAM_BOT_TOKEN:            String(request.body?.telegram_bot_token            ?? '').trim(),
      TELEGRAM_CHAT_ID:              String(request.body?.telegram_chat_id              ?? '').trim(),
      HEALTHCHECKS_PING_URL:         String(request.body?.healthchecks_ping_url         ?? '').trim(),
      HEALTHCHECKS_PING_INTERVAL_MS: String(request.body?.healthchecks_ping_interval_ms ?? '0').trim(),
      BOT_TZ:                        String(request.body?.bot_tz                        ?? '').trim(),
      HYPERLIQUID_TESTNET:           testnet,
    });

    const isHtmx = String(request.headers['hx-request'] ?? '') === 'true';
    if (isHtmx) {
      return reply
          .code(200)
          .type('text/html; charset=utf-8')
          .send('<div class="alert alert-success mb-0">Variables saved ✅</div>');
    }

    return { ok: true };
  });
}
