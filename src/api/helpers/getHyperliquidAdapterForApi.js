// api/helpers/getHyperliquidAdapterForApi.js
import { createHyperliquidAdapter } from './createHyperliquidAdapter.js';

function normalizePk(pk) {
    if (!pk) return '';
    const s = String(pk).trim();
    return s.startsWith('0x') ? s : `0x${s}`;
}

const cache = new Map();

/**
 * @param {{
 *   models: any,
 *   tradeInstanceId?: number|string,
 *   force?: boolean
 * }} params
 */
export async function getHyperliquidAdapterForApi({ models, tradeInstanceId, force = false } = {}) {
    if (!models) throw new Error('getHyperliquidAdapterForApi requires { models }');

    const key = tradeInstanceId != null ? String(tradeInstanceId) : 'default';
    if (!force && cache.has(key)) return cache.get(key);

    // 1) env first (wallet/key only — both env and DB supported per design)
    let userAddress = String(process.env.WALLET_ADDRESS ?? '').trim();
    let privateKey = String(
        process.env.PRIVATE_KEY ??
        process.env.HYPERLIQUID_PRIVATE_KEY ??
        '',
    ).trim();

    // 2) DB — always fetch instance when id is available to get testnet flag;
    //    also fills wallet/key if not set in env
    let isTestnet = false;
    if (tradeInstanceId != null) {
        const TradeInstance = models.TradeInstance;
        if (!TradeInstance) throw new Error('models.TradeInstance is missing (check buildModels output)');

        const ti = await TradeInstance.findByPk(tradeInstanceId);
        if (!ti) throw new Error(`TradeInstance not found: ${tradeInstanceId}`);

        if (!userAddress) userAddress = String(ti.wallet_address ?? '').trim();
        if (!privateKey) privateKey = String(ti.private_key ?? '').trim();
        isTestnet = !!ti.hyperliquid_testnet;
    }

    privateKey = normalizePk(privateKey);

    const ex = await createHyperliquidAdapter({
        userAddress,
        privateKey,
        isTestnet,
    });

    cache.set(key, ex);
    return ex;
}