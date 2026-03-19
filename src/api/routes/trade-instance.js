import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchHyperliquidMidFromPair } from '../../functions/functions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.resolve(__dirname, '../../../.env');

function upsertEnvKey(content, key, value) {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  return regex.test(content) ? content.replace(regex, line) : content.trimEnd() + `\n${line}\n`;
}

function writeSecretsToEnvFile(walletAddress, privateKey) {
  let content = '';
  try { content = fs.readFileSync(ENV_PATH, 'utf8'); } catch { content = ''; }
  if (walletAddress) content = upsertEnvKey(content, 'WALLET_ADDRESS', walletAddress);
  if (privateKey)    content = upsertEnvKey(content, 'PRIVATE_KEY', privateKey);
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

export async function tradeInstanceRoutes(app, { models }) {
  const { TradeInstance, TradeOrder } = models;

  // GET /api/trade-instance/all
  app.get('/trade-instance/all', async (request, reply) => {
    const rows = await TradeInstance.findAll({ order: [['id', 'ASC']] });
    return rows.map(r => r.toJSON());
  });

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
  app.put('/trade-instance/:id/secrets', async (request, reply) => {
    const id = Number(request.params?.id);

    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: 'id is required' });
    }

    const row = await TradeInstance.findByPk(id);
    if (!row) return reply.code(404).send({ error: 'id not found' });

    const walletAddressRaw = String(request.body?.wallet_address ?? '').trim();
    const privateKeyRaw = String(request.body?.private_key ?? '').trim();

    row.wallet_address = walletAddressRaw || null;

    if (privateKeyRaw) {
      row.private_key = privateKeyRaw;
    }

    await row.save();

    // Also persist to .env so the bot process picks them up on next start
    try { writeSecretsToEnvFile(walletAddressRaw, privateKeyRaw); } catch { /* non-fatal */ }

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

    const str = (v) => { const s = String(v ?? '').trim(); return s || null; };
    const testnet = request.body?.hyperliquid_testnet === '1' || request.body?.hyperliquid_testnet === 'on';

    row.telegram_bot_token            = str(request.body?.telegram_bot_token);
    row.telegram_chat_id              = str(request.body?.telegram_chat_id);
    row.healthchecks_ping_url         = str(request.body?.healthchecks_ping_url);
    row.healthchecks_ping_interval_ms = request.body?.healthchecks_ping_interval_ms != null
        ? (Number(request.body.healthchecks_ping_interval_ms) || null)
        : null;
    row.bot_tz              = str(request.body?.bot_tz);
    row.hyperliquid_testnet = testnet;

    await row.save();

    const isHtmx = String(request.headers['hx-request'] ?? '') === 'true';
    if (isHtmx) {
      return reply
          .code(200)
          .type('text/html; charset=utf-8')
          .send('<div class="alert alert-success mb-0">Variables saved ✅</div>');
    }

    return { ok: true };
  });

  // PUT /api/trade-instance/:id/config
  app.put('/trade-instance/:id/config', async (request, reply) => {
    const id = Number(request.params?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: 'id is required' });
    }

    const row = await TradeInstance.findByPk(id);
    if (!row) return reply.code(404).send({ error: 'id not found' });

    const body = request.body ?? {};

    const allowed = [
      'pair',
      'target_percent',
      'margin_percent',
      'decimal_quantity',
      'decimal_price',
      'name',
      'asset',
      'rebuy_profit',
      'reserve_quote_offset_percent',
      'reserve_quote_order_id',
      'reserve_base_offset_percent',
      'reserve_base_order_id',
      'rebought_value',
      'rebought_coin',
      'rebuy_percent',
      'rebuy_value',
      'execution_price_min',
      'execution_price_max',
    ];

    const floatFields = new Set([
      'target_percent',
      'margin_percent',
      'reserve_quote_offset_percent',
      'reserve_base_offset_percent',
      'rebought_value',
      'rebought_coin',
      'rebuy_value',
      'execution_price_min',
      'execution_price_max',
    ]);

    const intFields = new Set([
      'decimal_quantity',
      'decimal_price',
      'rebuy_percent',
    ]);

    const boolFields = new Set(['rebuy_profit']);

    for (const key of allowed) {
      if (body[key] === undefined) continue;

      const raw = body[key];

      if (boolFields.has(key)) {
        const v = String(raw).trim().toLowerCase();
        row[key] = v === 'true' || v === '1' || v === 'on';
        continue;
      }

      if (intFields.has(key)) {
        const v = String(raw).trim();
        if (v === '') { row[key] = null; continue; }
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n)) return reply.code(400).send({ error: `${key} must be a valid integer` });
        row[key] = n;
        continue;
      }

      if (floatFields.has(key)) {
        const v = String(raw).trim();
        if (v === '') { row[key] = null; continue; }
        const n = Number(v);
        if (!Number.isFinite(n)) return reply.code(400).send({ error: `${key} must be a valid number` });
        row[key] = n;
        continue;
      }

      if (key === 'reserve_quote_order_id' || key === 'reserve_base_order_id') {
        const v = String(raw).trim();
        row[key] = v === '' ? null : v;
        continue;
      }

      row[key] = String(raw).trim();
    }

    const requiredNumberFields = [
      'target_percent',
      'margin_percent',
      'decimal_quantity',
      'decimal_price',
      'execution_price_min',
      'execution_price_max',
    ];

    for (const key of requiredNumberFields) {
      if (!Number.isFinite(Number(row[key]))) {
        return reply.code(400).send({ error: `${key} is required` });
      }
    }

    if (Number(row.target_percent) <= 0)
      return reply.code(400).send({ error: 'target_percent must be greater than 0' });
    if (Number(row.margin_percent) <= 0)
      return reply.code(400).send({ error: 'margin_percent must be greater than 0' });
    if (Number(row.decimal_quantity) < 0)
      return reply.code(400).send({ error: 'decimal_quantity must be 0 or greater' });
    if (Number(row.decimal_price) < 0)
      return reply.code(400).send({ error: 'decimal_price must be 0 or greater' });
    if (Number(row.execution_price_min) <= 0)
      return reply.code(400).send({ error: 'execution_price_min must be greater than 0' });
    if (Number(row.execution_price_max) <= Number(row.execution_price_min))
      return reply.code(400).send({ error: 'execution_price_max must be greater than execution_price_min' });

    await row.save();

    return reply.type('application/json; charset=utf-8').send({
      success: true,
      data: row.toJSON ? row.toJSON() : row,
    });
  });

  // GET /api/trade-instance/:id/simulate
  app.get('/trade-instance/:id/simulate', async (request, reply) => {
    const id = Number(request.params?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: 'id is required' });
    }

    const row = await TradeInstance.findByPk(id);
    if (!row) return reply.code(404).send({ error: 'id not found' });

    const instance = row.toJSON();
    const runtimeInputs = extractGridRuntimeInputs(request.query ?? {});

    const result = await buildGrid(instance, { save: false, runtimeInputs });
    if (result.error) return reply.code(400).send({ error: result.error });

    return result;
  });

  // POST /api/trade-instance/:id/build-grid
  app.post('/trade-instance/:id/build-grid', async (request, reply) => {
    const id = Number(request.params?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ error: 'id is required' });
    }

    const row = await TradeInstance.findByPk(id);
    if (!row) return reply.code(404).send({ error: 'id not found' });

    const instance = row.toJSON();
    const runtimeInputs = extractGridRuntimeInputs(request.body ?? {});

    const result = await buildGrid(instance, {
      save: true,
      runtimeInputs,
      saveTradeOrder: async (o) => TradeOrder.create(o),
    });

    if (result.error) return reply.code(400).send({ error: result.error });

    return result;
  });
}

// ─── helpers (moved from trade-config.js) ───────────────────────────────────

function sanitizePairKey(pair) {
  return String(pair || '').replace(/[\/\-_]/g, '');
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundTo(n, decimals) {
  if (!Number.isFinite(n)) return n;
  const d = Number(decimals ?? 0);
  if (!Number.isFinite(d) || d < 0) return n;
  return Number(n.toFixed(d));
}

function extractGridRuntimeInputs(input = {}) {
  return {
    entry_price:     input.entry_price,
    exit_price:      input.exit_price,
    usd_transaction: input.usd_transaction,
  };
}

async function buildGrid(cfg, { save, saveTradeOrder, runtimeInputs = {} } = {}) {
  const entry      = toNum(runtimeInputs.entry_price);
  const exit       = toNum(runtimeInputs.exit_price);
  const targetPct  = toNum(cfg.target_percent);
  const marginPct  = toNum(cfg.margin_percent);
  const usdPerLevel = toNum(runtimeInputs.usd_transaction);

  const decQty   = Number(cfg.decimal_quantity ?? 0);
  const decPrice = Number(cfg.decimal_price ?? 0);

  const errors = [];
  if (!Number.isFinite(entry))      errors.push('entry_price');
  if (!Number.isFinite(exit))       errors.push('exit_price');
  if (!Number.isFinite(targetPct))  errors.push('target_percent');
  if (!Number.isFinite(marginPct))  errors.push('margin_percent');
  if (!Number.isFinite(usdPerLevel)) errors.push('usd_transaction');

  if (errors.length) return { error: `Missing/invalid fields: ${errors.join(', ')}` };

  if (entry <= 0)       errors.push('entry_price must be > 0');
  if (exit <= entry)    errors.push('exit_price must be greater than entry_price');
  if (targetPct <= 0)   errors.push('target_percent must be > 0');
  if (marginPct <= 0)   errors.push('margin_percent must be > 0');
  if (usdPerLevel <= 0) errors.push('usd_transaction must be > 0');

  if (errors.length) return { error: errors.join(', ') };

  const currentPrice = await fetchHyperliquidMidFromPair(cfg.pair);
  const pxNow = Number.isFinite(currentPrice) ? currentPrice : entry;

  let buyPrice  = entry;
  let sellPrice = buyPrice + (buyPrice * targetPct) / 100;

  const rows = [];
  let savedCount = 0;
  let sumQuantityCoin = 0;
  let sumQuantityUsd  = 0;
  let guard = 0;
  const maxLevels = 10000;

  while (sellPrice < exit && guard < maxLevels) {
    guard += 1;

    const quantity = roundTo(usdPerLevel / buyPrice, decQty);

    if (sellPrice > pxNow) sumQuantityCoin += quantity;
    else sumQuantityUsd += 1;

    const buyRounded  = roundTo(buyPrice, decPrice);
    const sellRounded = roundTo(sellPrice, decPrice);

    rows.push({ buy_price: buyRounded, sell_price: sellRounded, quantity });

    if (save) {
      if (typeof saveTradeOrder !== 'function') return { error: 'saveTradeOrder not provided' };

      await saveTradeOrder({
        pair:             cfg.pair,
        buy_price:        buyRounded,
        sell_price:       sellRounded,
        quantity,
        entry_price:      pxNow,
        last_operation:   false,
        trade_instance_id: cfg.id,
      });

      savedCount += 1;
    }

    buyPrice  = buyPrice + (buyPrice * marginPct) / 100;
    sellPrice = buyPrice + (buyPrice * targetPct) / 100;
  }

  if (guard >= maxLevels) {
    return { error: `Exceeded max grid levels (${maxLevels}). Check margin_percent/target_percent.` };
  }

  const totalCoinUsd    = sumQuantityCoin * pxNow;
  const quoteNeededUsd  = sumQuantityUsd * usdPerLevel;

  const sellRowsAbove = rows.filter(r => r.sell_price > pxNow);
  const baseNeeded    = sellRowsAbove.reduce((acc, r) => acc + r.quantity, 0);

  const proceedsIfSoldAlongTheWay = sellRowsAbove.reduce((acc, r) => acc + r.quantity * r.sell_price, 0);
  const costIfBoughtNow           = baseNeeded * pxNow;
  const profitIfSoldAlongTheWay   = proceedsIfSoldAlongTheWay - costIfBoughtNow;
  const profitIfHeldToExit        = baseNeeded * (exit - pxNow);

  const buyRowsBelow           = rows.filter(r => r.buy_price < pxNow);
  const btcAccumulatedGoingDown = buyRowsBelow.reduce((acc, r) => acc + r.quantity, 0);
  const totalBtcAtBottom        = baseNeeded + btcAccumulatedGoingDown;
  const totalValueAtBottom      = totalBtcAtBottom * entry;
  const downsideUnrealizedLoss  = (quoteNeededUsd + costIfBoughtNow) - totalValueAtBottom;

  const orderValue       = usdPerLevel;
  const grossProfitPerOp = orderValue * (targetPct / 100);
  const exchangeFees     = orderValue * 0.0015;
  const netProfitPerOp   = grossProfitPerOp - exchangeFees;

  return {
    rows,
    savedCount,
    meta: {
      pair:              cfg.pair,
      pairKey:           sanitizePairKey(cfg.pair),
      name:              cfg.name,
      config_id:         cfg.id,
      trade_instance_id: cfg.id,
      source_price:      Number.isFinite(currentPrice) ? 'hyperliquid_allMids' : 'fallback_entry_price',
    },
    summary: {
      levels:       rows.length,
      entry_price:  entry,
      exit_price:   exit,
      target_percent: targetPct,
      margin_percent: marginPct,
      usd_per_level:  usdPerLevel,
      current_price:  pxNow,

      base_needed:             sumQuantityCoin,
      base_value_usd:          totalCoinUsd,
      quote_levels_below_price: sumQuantityUsd,
      quote_needed_usd:        quoteNeededUsd,

      profit_if_sold_along_the_way: profitIfSoldAlongTheWay,
      profit_if_held_to_exit:       profitIfHeldToExit,

      btc_accumulated_going_down: btcAccumulatedGoingDown,
      total_btc_at_bottom:        totalBtcAtBottom,
      total_value_at_bottom:      totalValueAtBottom,
      downside_unrealized_loss:   downsideUnrealizedLoss,

      gross_profit_per_op_usd:    grossProfitPerOp,
      est_fees_per_op_usd:        exchangeFees,
      est_net_profit_per_op_usd:  netProfitPerOp,

      est_total_usd_needed: quoteNeededUsd + totalCoinUsd,
    },
  };
}
