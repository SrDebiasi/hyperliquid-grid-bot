/**
 * Build grid levels from entry → exit using multiplicative margin steps.
 *
 * @param {number} entryPrice
 * @param {number} exitPrice
 * @param {number} marginPercent  e.g. 0.1 means +0.1% each level
 * @param {number} targetPercent  e.g. 1.8 means sell = buy * (1 + 1.8%)
 * @returns {Array<{buy_price:number, sell_price:number}>}
 */
export function buildGrid(entryPrice, exitPrice, marginPercent, targetPercent) {
    const grid = [];

    const entry = Number(entryPrice);
    const exit = Number(exitPrice);
    const marginP = Number(marginPercent);
    const targetP = Number(targetPercent);

    if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry <= 0 || exit <= 0) return grid;
    if (!Number.isFinite(marginP) || !Number.isFinite(targetP)) return grid;
    if (exit < entry) return grid;

    let price = entry;

    const margin = 1 + marginP / 100;
    const target = 1 + targetP / 100;

    if (margin <= 1) return grid;

    while (price <= exit) {
        const buy = price;
        const sell = price * target;

        grid.push({
            buy_price: quantizeBuy(buy, 1),
            sell_price: quantizeSell(sell, 1),
        });

        price = price * margin;
    }

    return grid;
}

function quantizeBuy(price, tick = 1) {
    return Math.floor(price / tick) * tick;
}

function quantizeSell(price, tick = 1) {
    return Math.ceil(price / tick) * tick;
}