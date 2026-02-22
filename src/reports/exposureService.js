// src/reports/exposureService.js
function toNumberSafe(v) {
    const n = Number(String(v ?? '').trim());
    return Number.isFinite(n) ? n : 0;
}

function calcExposureFromOrders(orders, currentPrice) {
    const list = Array.isArray(orders) ? orders : [];

    let coinQty = 0;
    let coinCostUsd = 0;
    let unknownCostQty = 0;
    let reservedUsd = 0;

    for (const o of list) {
        const qty = toNumberSafe(o.quantity);
        if (qty <= 0) continue;

        const sellPrice = toNumberSafe(o.sell_price);
        const buyPrice = toNumberSafe(o.buy_price);
        const entryPrice = toNumberSafe(o.entry_price);

        // Open coin blocks: have a sell above current price
        if (sellPrice > 0 && sellPrice > currentPrice) {
            coinQty += qty;

            const costPrice = buyPrice > 0 ? buyPrice : entryPrice;
            if (costPrice > 0) coinCostUsd += costPrice * qty;
            else unknownCostQty += qty;

            continue;
        }

        // Otherwise: reserved USD for pending buys
        const p = buyPrice > 0 ? buyPrice : entryPrice;
        if (p > 0) reservedUsd += p * qty;
    }

    const coinValueUsd = coinQty * currentPrice;
    const totalExposureUsd = coinValueUsd + reservedUsd;
    const avgEntryPrice = coinQty > 0 ? (coinCostUsd / coinQty) : 0;

    return {
        coinQty,
        coinValueUsd,
        reservedUsd,
        totalExposureUsd,
        coinCostUsd,
        avgEntryPrice,
        unknownCostQty,
    };
}

export { calcExposureFromOrders, toNumberSafe };