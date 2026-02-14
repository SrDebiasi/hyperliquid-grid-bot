function toNumberEnv(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? n : fallback;
}

// Per-side fee rate (example: 0.000384 = 0.0384% per side)
export const FEE_RATE_MAKER_PER_SIDE = toNumberEnv("FEE_RATE_MAKER_PER_SIDE", 0.000384);
export const FEE_RATE_TAKER_PER_SIDE = toNumberEnv("FEE_RATE_TAKER_PER_SIDE", 0.000672);