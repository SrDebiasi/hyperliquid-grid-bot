
let prices = [];
let instanceId = null;
let lastOperation = [];

export const setLastOperation = (pair, date = new Date()) => {
    if (!pair) return;
    lastOperation[pair] = date;
};

export const getLastOperation = (pair) => {
    return lastOperation[pair] ?? null;
};

export function setPrice(symbol, price) {
    prices[symbol] = Number(price);
}

export function getPrices() {
    return prices;
}
export function setPrices(p) {
    prices = p
}

export function setInstanceId(id) {
    instanceId = id;
}

export function getInstanceId() {
    return instanceId;
}