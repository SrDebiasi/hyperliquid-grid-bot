import {
    fetchKlinesPaginatedCached
} from "../market/fetchKlinesPaginatedCached.js";

import { simulateGrid } from "../grid/simulateGrid.js";
import { parseLocalDate } from "./utils.js";
import { buildGrid } from "../grid/buildGrid.js";

export async function runBacktest({
                                      symbol,
                                      interval,
                                      startDate,
                                      endDate,
                                      entry_price,
                                      exit_price,
                                      margin_percent,
                                      target_percent,
                                      simulationConfig
                                  }) {
    const startTime = parseLocalDate(startDate);

    const endOfDay = new Date(parseLocalDate(endDate));
    endOfDay.setHours(23, 59, 59, 999);
    const endTime = endOfDay.getTime();

    console.log("Fetching candles...");
    const candles = await fetchKlinesPaginatedCached(
        symbol,
        interval,
        startTime,
        endTime
    );

    const grid = buildGrid(
        entry_price,
        exit_price,
        margin_percent,
        target_percent
    );

    const result = simulateGrid(grid, candles, simulationConfig);

    return { grid, result, startTime, endTime };
}