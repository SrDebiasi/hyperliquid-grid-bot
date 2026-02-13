// src/backtest/sweepPercent.js
import {
    fetchKlinesPaginatedCached
} from "../market/fetchKlinesPaginatedCached.js";

import { buildGrid } from "../grid/buildGrid.js";
import { simulateGrid } from "../grid/simulateGrid.js";
import { parseLocalDate, formatRange } from "./utils.js";

export async function sweepPercent({
                                       symbol,
                                       interval,
                                       startDate,
                                       endDate,
                                       entry_price,
                                       exit_price,
                                       margin_percent,
                                       usdPerOrder,
                                       from = 1.0,
                                       to = 3.2,
                                       step = 0.1
                                   }) {
    const startTime = parseLocalDate(startDate);

    const endOfDay = new Date(parseLocalDate(endDate));
    endOfDay.setHours(23, 59, 59, 999);
    const endTime = endOfDay.getTime();

    const candles = await fetchKlinesPaginatedCached(
        symbol,
        interval,
        startTime,
        endTime
    );

    let best = { percent: null, cycles: 0, profit: -Infinity };

    for (let p = from; p <= to + 1e-9; p += step) {
        const percent = Math.round(p * 10) / 10;

        const grid = buildGrid(
            entry_price,
            exit_price,
            margin_percent,
            percent
        );

        const result = simulateGrid(grid, candles, usdPerOrder);

        if (result.totalProfit > best.profit) {
            best = { percent, cycles: result.cycles, profit: result.totalProfit };
        }

        console.log(
            `${percent.toFixed(1)}% : ${result.cycles} ciclos - $${result.totalProfit.toFixed(2)}`
        );
    }

    return best;
}
