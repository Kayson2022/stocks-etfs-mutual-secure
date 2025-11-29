// engine.js
// v20 patch: safer stock/fund detection + new API order
// - Stocks/ETFs: Yahoo -> original Finnhub flow
// - Mutual Funds: Yahoo -> existing FMP/Alpha pipeline
// - Avoid misclassifying tickers like STX/CSX/LHX as mutual funds

(function () {
  function installV20Patch() {
    try {
      const t = window.stockTracker;
      if (!t || !t.apiService || t._v20PatchInstalled) return;

      const svc = t.apiService;
      const proto = svc.constructor && svc.constructor.prototype;
      if (!proto) return;

      // ---- Helper: stricter mutual-fund detector ----
      // We want: FXAIX, FSELX, VTSAX etc. to be funds
      // but NOT STX, CSX, LHX (short tickers).
      function isLikelyMutualFundSymbol(sym) {
        if (!sym) return false;
        const clean = sym.toString().trim().toUpperCase();
        // Typical US mutual funds: 4+ letters and end with X
        // Examples: FXAIX, FSELX, VTSAX, SWPPX
        return /^[A-Z]{4,}X$/.test(clean);
      }

      // Keep previous implementations so we can fall back safely
      const prevMutualFundFn =
        typeof proto.fetchMutualFundDataWithFallback === "function"
          ? proto.fetchMutualFundDataWithFallback
          : null;

      const prevStockQuoteFn =
        typeof proto.fetchStockEtfQuote === "function"
          ? proto.fetchStockEtfQuote
          : null;

      // We expect your original ApiService to have fetchYahooQuote already
      const hasYahooQuote =
        typeof proto.fetchYahooQuote === "function" ||
        typeof svc.fetchYahooQuote === "function";

      // ---------------------------------------------
      // Yahoo mutual-fund quote (primary for funds)
      // ---------------------------------------------
      async function fetchYahooMutualFundQuote(symbol) {
        let clean = (symbol || "").toString().trim();
        clean = clean.replace(/[^A-Za-z0-9.]/g, "").toUpperCase();
        // If user types FXAIX.X or weird suffix, trim trailing ".X"
        clean = clean.replace(/\.X$/i, "");

        // Use same proxy style as your v14/v19 patches (corsproxy.io + yahoo)
        const url =
          "https://corsproxy.io/?" +
          "https://query1.finance.yahoo.com/v7/finance/quote?symbols=" +
          encodeURIComponent(clean);

        const res = await fetch(url);
        if (!res.ok) {
          throw new Error("Yahoo mutual fund HTTP " + res.status);
        }
        const data = await res.json();
        const q =
          data &&
          data.quoteResponse &&
          Array.isArray(data.quoteResponse.result) &&
          data.quoteResponse.result[0];

        if (!q) {
          throw new Error("Yahoo mutual fund: empty quoteResponse.result");
        }

        const price =
          typeof q.regularMarketPrice === "number"
            ? q.regularMarketPrice
            : null;
        if (price === null) {
          throw new Error(
            "Yahoo mutual fund: missing regularMarketPrice for " + clean
          );
        }

        const change =
          typeof q.regularMarketChange === "number"
            ? q.regularMarketChange
            : null;
        const percent =
          typeof q.regularMarketChangePercent === "number"
            ? q.regularMarketChangePercent
            : null;

        return {
          success: true,
          symbol: clean,
          data: {
            price,
            change,
            percent,
            timestamp: q.regularMarketTime || null,
            raw: q,
          },
        };
      }

      // --------------------------------------------------
      // Override: Mutual Fund Pipeline (Yahoo -> old FMP/AV)
      // --------------------------------------------------
      proto.fetchMutualFundDataWithFallback = async function (symbol) {
        const ctx = this || svc;
        let raw = (symbol || "").toString().trim();
        let clean = raw.replace(/[^A-Za-z0-9.]/g, "").toUpperCase();

        // If it doesn't look like a mutual fund symbol,
        // treat it as a stock/ETF instead (STX, CSX, etc.).
        if (!isLikelyMutualFundSymbol(clean)) {
          if (typeof ctx.fetchStockEtfQuote === "function") {
            return ctx.fetchStockEtfQuote(clean);
          }
          // If no quote, but full data exists:
          if (typeof ctx.fetchStockEtfData === "function") {
            return ctx.fetchStockEtfData(clean);
          }
          // fallback to previous MF pipeline as absolute last resort:
          if (prevMutualFundFn) {
            return prevMutualFundFn.call(ctx, clean);
          }
          return {
            success: false,
            symbol: clean,
            reason: "Symbol does not look like a mutual fund (v20 patch)",
          };
        }

        // 1) Try Yahoo mutual fund quote first
        try {
          const yahooResult = await fetchYahooMutualFundQuote(clean);
          if (
            yahooResult &&
            yahooResult.success &&
            yahooResult.data &&
            typeof yahooResult.data.price === "number"
          ) {
            return yahooResult;
          }
        } catch (e) {
          console.warn(
            "v20: Yahoo mutual fund fetch failed for",
            clean,
            "-",
            e && e.message ? e.message : e
          );
        }

        // 2) Fall back to previous mutual-fund pipeline (FMP -> Alpha)
        if (prevMutualFundFn) {
          return prevMutualFundFn.call(ctx, clean);
        }

        return {
          success: false,
          symbol: clean,
          reason: "v20: No mutual fund pipeline available after Yahoo",
        };
      };

      // --------------------------------------------------
      // Override: Stock/ETF Quote (Yahoo first, then Finnhub/original)
      // --------------------------------------------------
      if (prevStockQuoteFn && hasYahooQuote) {
        proto.fetchStockEtfQuote = async function (symbol) {
          const ctx = this || svc;
          const s = (symbol || "").toString().trim().toUpperCase();

          // 1) Yahoo first (primary for stocks/ETFs)
          try {
            const yahooFn =
              typeof ctx.fetchYahooQuote === "function"
                ? ctx.fetchYahooQuote.bind(ctx)
                : typeof svc.fetchYahooQuote === "function"
                ? svc.fetchYahooQuote.bind(svc)
                : null;

            if (yahooFn) {
              const y = await yahooFn(s);
              if (y && typeof y.price === "number") {
                return {
                  success: true,
                  symbol: s,
                  data: {
                    price: y.price,
                    change: y.change ?? null,
                    changePercent:
                      y.percentChange ?? y.changePercent ?? null,
                    previousClose: y.previousClose ?? null,
                    raw: y.raw ?? y,
                  },
                };
              }
            }
          } catch (e) {
            console.warn(
              "v20: Yahoo primary stock/ETF quote failed for",
              s,
              "-",
              e && e.message ? e.message : e
            );
          }

          // 2) Fallback: original implementation (Finnhub-based v19)
          try {
            const orig = await prevStockQuoteFn.call(ctx, s);
            return orig;
          } catch (e) {
            return {
              success: false,
              symbol: s,
              reason:
                "v20: original stock/ETF quote failed - " +
                (e && e.message ? e.message : String(e)),
            };
          }
        };
      }

      t._v20PatchInstalled = true;
      console.log(
        "v20 engine patch installed: Yahoo->Finnhub for stocks, Yahoo->FMP->Alpha for mutual funds, safer symbol detection."
      );
    } catch (e) {
      console.warn("v20 engine patch failed:", e);
    }
  }

  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    setTimeout(installV20Patch, 1000);
  } else {
    window.addEventListener("DOMContentLoaded", function () {
      setTimeout(installV20Patch, 1000);
    });
  }
})();
