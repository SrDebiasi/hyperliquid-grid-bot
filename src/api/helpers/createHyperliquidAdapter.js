import HyperliquidAdapter from "../../exchange/HyperliquidAdapter.js";

function normalizePk(pk) {
    if (!pk) return '';
    const s = String(pk).trim();
    return s.startsWith('0x') ? s : `0x${s}`;
}

export async function createHyperliquidAdapter({ userAddress, privateKey, isTestnet }) {
    const ua = String(userAddress ?? '').trim();
    const pk = normalizePk(privateKey);

    if (!ua) throw new Error('Missing WALLET_ADDRESS / userAddress');
    if (!pk) throw new Error('Missing PRIVATE_KEY / privateKey');

    const exchange = new HyperliquidAdapter({
        userAddress: ua,
        privateKey: pk,
        isTestnet: !!isTestnet,
    });

    await exchange.init();
    return exchange;
}