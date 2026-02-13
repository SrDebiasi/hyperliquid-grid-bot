// src/backtest/utils.js
export function parseLocalDate(dateStr) {
    const [d, m, y] = dateStr.split("/").map(Number);
    return new Date(y, m - 1, d).getTime();
}

export function formatRange(start, end) {
    return `${new Date(start).toISOString().slice(0, 10)} → ${new Date(end)
        .toISOString()
        .slice(0, 10)}`;
}
