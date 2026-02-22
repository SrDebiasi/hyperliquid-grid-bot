import fs from "fs";
import axios from "axios";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function fetchKlinesPaginatedCached(symbol, interval, startTime, endTime, limit = 1000) {
    const cacheDir = ensureCacheDir();

    let all = [];

    let dayStart = startOfDayUTC(startTime);

    while (dayStart < endTime) {
        const dayEnd = endOfDayUTC(dayStart);
        const chunkStart = Math.max(startTime, dayStart);
        const chunkEnd   = Math.min(endTime, dayEnd);

        const key = dayKeyUTC(dayStart);
        const file = cacheFileForDay(cacheDir, symbol, interval, key);

        let dayData;

        if (fs.existsSync(file)) {
            dayData = JSON.parse(fs.readFileSync(file, "utf8"));
        } else {
            console.log(" Fetching day:", key);

            const fullDayStart = dayStart;
            const fullDayEnd = dayEnd;

            dayData = await fetchKlines(symbol, interval, fullDayStart, fullDayEnd, limit);

            fs.writeFileSync(file, JSON.stringify(dayData), "utf8");
            console.log("File saved:", file);
        }

        if (dayData && dayData.length) {
            const filtered = dayData.filter(k => {
                const openTime = k[0];
                return openTime >= chunkStart && openTime <= chunkEnd;
            });
            all = all.concat(filtered);
        }

        dayStart += 24 * 60 * 60 * 1000;
    }

    all.sort((a, b) => a[0] - b[0]);
    all = all.filter((k, idx) => idx === 0 || k[0] !== all[idx - 1][0]);

    return all;
}

async function fetchKlines(symbol, interval, startTime, endTime, limit = 1000) {
    const url = "https://api.binance.com/api/v3/klines";
    let all = [];
    let currentStart = startTime;

    while (currentStart <= endTime) {
        const params = {
            symbol,
            interval,
            startTime: currentStart,
            endTime,
            limit
        };

        const { data } = await axios.get(url, { params });

        if (!data || data.length === 0) break;

        all = all.concat(data);

        const lastOpen = data[data.length - 1][0];
        currentStart = lastOpen + 1;

        if (data.length < limit) break;
    }

    return all;
}


// start of day UTC
function startOfDayUTC(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

// end of day UTC
function endOfDayUTC(ms) {
    const s = startOfDayUTC(ms);
    return s + 24 * 60 * 60 * 1000 - 1;
}

function cacheFileForDay(cacheDir, symbol, interval, dayKey) {
    return path.join(cacheDir, `${symbol}_${interval}_${dayKey}.json`);
}

function ensureCacheDir() {
    const projectRoot = path.resolve(__dirname, "..", "..");
    const dir = path.join(projectRoot, "cache");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function dayKeyUTC(ms) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}
