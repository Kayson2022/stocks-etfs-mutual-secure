/**
 * engine.js - central backend helper for the portfolio app (v21)
 *
 * - Provides a safe global getRgbColor helper for charts (backwards compatible).
 * - Adds StockBackend: a single place to talk to your Cloudflare Worker backend.
 * - StockBackend knows how to:
 *      - Call your backend URL
 *      - Understand Yahoo vs Finnhub vs FMP vs Alpha responses
 *      - Give you clean "quote" objects
 *      - Give you Yahoo chart series for Chart.js
 *
 * Backend used:
 *   https://stock-backend-secure.giolamchieu1975.workers.dev
 */

(function () {
    if (typeof window === "undefined") return;

    // ==============================
    // 1. Global CSS color helper
    // ==============================
    window.getRgbColor = window.getRgbColor || function (varName) {
        try {
            var raw = getComputedStyle(document.documentElement).getPropertyValue(varName) || "";
            raw = raw.trim();
            if (!raw) return { r: 0, g: 0, b: 0 };
            var parts = raw.split(",").map(function (p) { return parseFloat(p.trim()); });
            if (parts.length >= 3 && parts.every(function (x) { return !isNaN(x); })) {
                return { r: parts[0], g: parts[1], b: parts[2] };
            }
        } catch (e) {
            console.warn("getRgbColor failed for", varName, e);
        }
        return { r: 0, g: 0, b: 0 };
    };

    // ==============================
    // 2. Backend configuration
    // ==============================
    var BACKEND_BASE_URL = "https://stock-backend-secure.giolamchieu1975.workers.dev";

    // Helper to safely build URLs
    function buildUrl(symbol, opts) {
        opts = opts || {};
        var params = new URLSearchParams();
        params.set("symbol", symbol);

        if (opts.debug === true) {
            params.set("debug", "true");
        }
        // In the future we could add range here (backend currently fixed to 6mo for Yahoo)
        // if (opts.range) params.set("range", opts.range);

        return BACKEND_BASE_URL + "/?" + params.toString();
    }

    // ==============================
    // 3. Normalizers
    // ==============================

    /**
     * Normalize the backend response into a generic "quote" shape your UI can use.
     *
     * Result shape:
     * {
     *   source: "yahoo" | "finnhub" | "marketstack" | "fmp" | "alphavantage" | "unknown",
     *   price: number|null,
     *   previousClose: number|null,
     *   change: number|null,
     *   changePercent: number|null,
     *   raw: any          // the underlying provider data
     * }
     */
    function normalizeQuote(result) {
        if (!result || !result.data) {
            return {
                source: result && result.source ? result.source : "unknown",
                price: null,
                previousClose: null,
                change: null,
                changePercent: null,
                raw: result
            };
        }

        // 3.1 Yahoo: chart-style data with meta, timestamp, indicators
        if (result.source === "yahoo") {
            var data = result.data || {};
            var meta = data.meta || {};
            var quoteArr = (data.indicators && data.indicators.quote && data.indicators.quote[0]) || {};
            var closes = quoteArr.close || [];
            var lastClose = closes.length ? closes[closes.length - 1] : null;

            // Prefer regularMarketPrice if present, otherwise fallback to last close
            var price = (typeof meta.regularMarketPrice === "number")
                ? meta.regularMarketPrice
                : lastClose;

            // Yahoo sometimes gives chartPreviousClose; if not, we approximate using the previous day's close
            var previousClose = (typeof meta.chartPreviousClose === "number")
                ? meta.chartPreviousClose
                : (closes.length > 1 ? closes[closes.length - 2] : null);

            var change = (price != null && previousClose != null) ? (price - previousClose) : null;
            var changePercent = (change != null && previousClose)
                ? (change / previousClose) * 100
                : null;

            return {
                source: "yahoo",
                price: price,
                previousClose: previousClose,
                change: change,
                changePercent: changePercent,
                raw: data
            };
        }

        // 3.2 Finnhub-style quote (c, d, dp, h, l, o, pc, t)
        if (result.source === "finnhub") {
            var fh = result.data || {};
            var priceFH = (typeof fh.c === "number") ? fh.c : null;
            var prevFH = (typeof fh.pc === "number") ? fh.pc : null;
            var changeFH = (typeof fh.d === "number")
                ? fh.d
                : (priceFH != null && prevFH != null ? priceFH - prevFH : null);
            var changePctFH = (typeof fh.dp === "number")
                ? fh.dp
                : (changeFH != null && prevFH ? (changeFH / prevFH) * 100 : null);

            return {
                source: "finnhub",
                price: priceFH,
                previousClose: prevFH,
                change: changeFH,
                changePercent: changePctFH,
                raw: fh
            };
        }

        // 3.3 FMP: usually an array with [ { price, previousClose, change, changesPercentage, ... } ]
        if (result.source === "fmp") {
            var fmp = result.data || {};
            // If backend gives raw array, handle it safely
            if (Array.isArray(result.data) && result.data.length > 0) {
                fmp = result.data[0];
            }

            var priceFmp = fmp.price != null ? Number(fmp.price) : null;
            var prevFmp = fmp.previousClose != null ? Number(fmp.previousClose) : null;
            var changeFmp = fmp.change != null
                ? Number(fmp.change)
                : (priceFmp != null && prevFmp != null ? priceFmp - prevFmp : null);
            var changePctFmp = fmp.changesPercentage != null
                ? Number(fmp.changesPercentage)
                : (changeFmp != null && prevFmp ? (changeFmp / prevFmp) * 100 : null);

            return {
                source: "fmp",
                price: priceFmp,
                previousClose: prevFmp,
                change: changeFmp,
                changePercent: changePctFmp,
                raw: fmp
            };
        }

        // 3.4 Alpha Vantage "Global Quote"
        if (result.source === "alphavantage") {
            var av = result.data || {};
            // If backend didn't peel ["Global Quote"], try to handle the raw structure
            if (av["Global Quote"]) av = av["Global Quote"];

            function avNum(key) {
                return av[key] != null ? Number(av[key]) : null;
            }

            var priceAv = avNum("05. price");
            var prevAv = avNum("08. previous close");
            var changeAv = avNum("09. change");
            var changePctAv = avNum("10. change percent");
            if (typeof changePctAv === "string") {
                // If value like "3.45%", strip the percent
                var s = av["10. change percent"];
                if (s && typeof s === "string" && s.indexOf("%") !== -1) {
                    changePctAv = parseFloat(s.replace("%", ""));
                }
            }

            if (changeAv == null && priceAv != null && prevAv != null) {
                changeAv = priceAv - prevAv;
            }
            if (changePctAv == null && changeAv != null && prevAv) {
                changePctAv = (changeAv / prevAv) * 100;
            }

            return {
                source: "alphavantage",
                price: priceAv,
                previousClose: prevAv,
                change: changeAv,
                changePercent: changePctAv,
                raw: av
            };
        }

        // 3.5 MarketStack (simplified – you can expand later if needed)
        if (result.source === "marketstack") {
            var ms = result.data || {};
            if (Array.isArray(ms) && ms.length > 0) {
                ms = ms[0];
            }

            var priceMs = ms.close != null ? Number(ms.close) : null;
            var prevMs = ms.adj_close != null ? Number(ms.adj_close) : null;
            var changeMs = (priceMs != null && prevMs != null) ? priceMs - prevMs : null;
            var changePctMs = (changeMs != null && prevMs)
                ? (changeMs / prevMs) * 100
                : null;

            return {
                source: "marketstack",
                price: priceMs,
                previousClose: prevMs,
                change: changeMs,
                changePercent: changePctMs,
                raw: ms
            };
        }

        // 3.6 Fallback: just give whatever we can
        var d = result.data || {};
        var priceGeneric = d.c || d.price || d.close || null;
        var prevGeneric = d.pc || d.previousClose || null;
        var changeGeneric = d.d || (priceGeneric != null && prevGeneric != null ? priceGeneric - prevGeneric : null);
        var changePctGeneric = d.dp || null;

        return {
            source: result.source || "unknown",
            price: priceGeneric != null ? Number(priceGeneric) : null,
            previousClose: prevGeneric != null ? Number(prevGeneric) : null,
            change: changeGeneric != null ? Number(changeGeneric) : null,
            changePercent: changePctGeneric != null ? Number(changePctGeneric) : null,
            raw: d
        };
    }

    /**
     * Take a Yahoo-style chart blob (from backend source "yahoo") and return
     * a clean array of { t: Date, v: Number } for Chart.js line charts.
     */
    function buildYahooSeries(yahooData) {
        if (!yahooData || !yahooData.timestamp || !yahooData.indicators) {
            return [];
        }

        var timestamps = yahooData.timestamp || [];
        var quoteArr = (yahooData.indicators.quote && yahooData.indicators.quote[0]) || {};
        var adjCloseArr = (yahooData.indicators.adjclose && yahooData.indicators.adjclose[0] && yahooData.indicators.adjclose[0].adjclose) || null;
        var closes = quoteArr.close || [];

        // Prefer adjusted close if available; otherwise use close
        var series = adjCloseArr && adjCloseArr.length === timestamps.length
            ? adjCloseArr
            : closes;

        var result = [];
        for (var i = 0; i < timestamps.length; i++) {
            var ts = timestamps[i];
            var val = (series && series[i] != null) ? Number(series[i]) : null;
            if (ts && val != null && !isNaN(val)) {
                result.push({
                    t: new Date(ts * 1000),
                    v: val
                });
            }
        }
        return result;
    }

    // ==============================
    // 4. StockBackend public API
    // ==============================

    var StockBackend = {
        /**
         * Low-level call: get the raw backend JSON.
         *
         * Usage:
         *   const raw = await StockBackend.fetchRaw("AAPL", { debug: true });
         */
        fetchRaw: async function (symbol, opts) {
            opts = opts || {};
            if (!symbol || typeof symbol !== "string") {
                throw new Error("Symbol is required");
            }

            var url = buildUrl(symbol.trim().toUpperCase(), opts);
            var res = await fetch(url);
            var json;
            try {
                json = await res.json();
            } catch (e) {
                console.error("Failed to parse backend JSON", e);
                throw new Error("Backend returned invalid JSON");
            }

            if (!res.ok) {
                console.warn("Backend error response", json);
            }
            return json;
        },

        /**
         * High-level quote: returns a normalized quote object.
         *
         * Usage:
         *   const quote = await StockBackend.fetchQuote("NVDA");
         *   console.log(quote.price, quote.changePercent);
         */
        fetchQuote: async function (symbol, opts) {
            var raw = await StockBackend.fetchRaw(symbol, opts);
            return normalizeQuote(raw);
        },

        /**
         * Get the raw Yahoo chart payload (if backend source is "yahoo").
         *
         * Usage:
         *   const res = await StockBackend.fetchYahooChart("AAPL");
         *   if (res.source === "yahoo" && res.data) {
         *       const series = StockBackend.buildYahooSeries(res.data);
         *   }
         */
        fetchYahooChart: async function (symbol, opts) {
            var raw = await StockBackend.fetchRaw(symbol, opts);
            if (raw.source === "yahoo" && raw.data && raw.data.meta && raw.data.timestamp) {
                return raw; // caller can then use buildYahooSeries(raw.data)
            }
            return raw; // fallback: still return, but caller should check source
        },

        /**
         * Convert Yahoo chart blob into a [{ t: Date, v: Number }, ...] series.
         *
         * Usage:
         *   const raw = await StockBackend.fetchYahooChart("AAPL");
         *   const series = StockBackend.buildYahooSeries(raw.data);
         */
        buildYahooSeries: function (yahooData) {
            return buildYahooSeries(yahooData);
        }
    };

    // Expose globally
    window.StockBackend = StockBackend;

    console.log("engine.js loaded (v21: backend + color helper).");
})();
