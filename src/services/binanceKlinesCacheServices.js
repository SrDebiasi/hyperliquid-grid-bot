import fs from "fs";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function fetchLastNDaysKlinesCached({
                                                     symbol = "BTCUSDT",
                                                     interval = "5m",
                                                     days = 5,
                                                     limit = 1000,
                                                     refetchYesterday = false,
                                                 } = {}) {
    const endTime = Date.now();
    const startTime = endTime - days * 24 * 60 * 60 * 1000;
    return fetchKlinesPaginatedCachedSmart(symbol, interval, startTime, endTime, limit, {
        refetchToday: true,
        refetchYesterday,
    });
}

/**
 * Like your original function, but with a "smart refetch":
 * - Always refetch today (UTC)
 * - Optionally refetch yesterday (UTC)
 */
export async function fetchKlinesPaginatedCachedSmart(
    symbol,
    interval,
    startTime,
    endTime,
    limit = 1000,
    { refetchToday = true, refetchYesterday = false } = {}
) {
    const cacheDir = ensureCacheDir();
    let all = [];

    let dayStart = startOfDayUTC(startTime);

    const todayStart = startOfDayUTC(Date.now());
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

    while (dayStart < endTime) {
        const dayEnd = endOfDayUTC(dayStart);
        const chunkStart = Math.max(startTime, dayStart);
        const chunkEnd = Math.min(endTime, dayEnd);

        const key = dayKeyUTC(dayStart);
        const file = cacheFileForDay(cacheDir, symbol, interval, key);

        const shouldRefetch =
            (refetchToday && dayStart === todayStart) ||
            (refetchYesterday && dayStart === yesterdayStart);

        let dayData;

        if (!shouldRefetch && fs.existsSync(file)) {
            dayData = JSON.parse(fs.readFileSync(file, "utf8"));
        } else {
            // Fetch full day range for stable caching (even if caller requested a smaller chunk)
            const fullDayStart = dayStart;
            const fullDayEnd = dayEnd;

            dayData = await fetchKlines(symbol, interval, fullDayStart, fullDayEnd, limit);

            fs.writeFileSync(file, JSON.stringify(dayData), "utf8");
        }

        if (dayData && dayData.length) {
            const filtered = dayData.filter((k) => {
                const openTime = k[0];
                return openTime >= chunkStart && openTime <= chunkEnd;
            });
            all = all.concat(filtered);
        }

        dayStart += 24 * 60 * 60 * 1000;
    }

    // Sort + de-dupe by openTime
    all.sort((a, b) => a[0] - b[0]);
    all = all.filter((k, idx) => idx === 0 || k[0] !== all[idx - 1][0]);

    return all;
}

async function fetchKlines(symbol, interval, startTime, endTime, limit = 1000) {
    const url = "https://api.binance.com/api/v3/klines";
    let all = [];
    let currentStart = startTime;

    while (currentStart <= endTime) {
        const params = { symbol, interval, startTime: currentStart, endTime, limit };
        const { data } = await axios.get(url, { params });

        if (!data || data.length === 0) break;

        all = all.concat(data);

        const lastOpen = data[data.length - 1][0];
        currentStart = lastOpen + 1;

        if (data.length < limit) break;
    }

    return all;
}

// --- UTC day helpers ---
function startOfDayUTC(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}
function endOfDayUTC(ms) {
    const s = startOfDayUTC(ms);
    return s + 24 * 60 * 60 * 1000 - 1;
}
function dayKeyUTC(ms) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// --- cache helpers ---
function cacheFileForDay(cacheDir, symbol, interval, dayKey) {
    return path.join(cacheDir, `${symbol}_${interval}_${dayKey}.json`);
}
function ensureCacheDir() {
    const projectRoot = path.resolve(__dirname, "..", "..");
    const dir = path.join(projectRoot, "cache");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}