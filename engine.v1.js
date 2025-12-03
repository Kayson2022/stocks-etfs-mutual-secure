// engine.js - simplified StockTracker wired for the new V5.2C UI
// Version: v1 (core portfolio logic + dynamic cards, ready to extend)

console.log("engine.js loaded (V5.2C-compatible engine)");

// Utility: parse CSS color into RGB (used later for charts if needed)
window.getRgbColor = function (color) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [255, 255, 255];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return [data[0], data[1], data[2]];
};

class StockTracker {
    constructor() {
        // --- Core state ---
        this.stocks = [];
        this.mutualFunds = [];
        this.watchlist = [];

        // --- DOM refs matching the NEW HTML ---
        this.$combinedTotal = document.getElementById("combined-total-value");
        this.$totalPLToday = document.getElementById("total-pl-today");
        this.$totalPLPercentToday = document.getElementById("total-pl-percent-today");
        this.$totalPLUnrealized = document.getElementById("total-pl-unrealized");
        this.$totalPLRealized = document.getElementById("total-pl-realized");

        this.$stocksTotal = document.getElementById("stocks-total-value");
        this.$fundsTotal = document.getElementById("mutual-fund-total-value");
        this.$totalContributions = document.getElementById("total-contributions");
        this.$totalDividends = document.getElementById("total-dividends");

        this.$chartCurrentValue = document.getElementById("chart-current-value");

        this.$stocksGrid = document.getElementById("stocksGrid");
        this.$stockInput = document.getElementById("stockInput");
        this.$addBtn = document.getElementById("addBtn");

        // --- Simple refresh loop flags ---
        this.refreshIntervalMs = 90_000; // 90s
        this.refreshIntervalId = null;

        // Bind events
        this._bindEvents();

        // Seed with example data (NVDA, TSLA, AVGO), can be replaced by Firebase later
        this._seedDemoHoldings();

        // Initial render
        this.renderAll();

        // Start auto-refresh (quotes)
        this.startAutoRefresh();
    }

    _bindEvents() {
        if (this.$addBtn && this.$stockInput) {
            this.$addBtn.addEventListener("click", () => {
                const symbol = (this.$stockInput.value || "").trim().toUpperCase();
                if (!symbol) return;
                this.addStockFromSymbol(symbol);
            });

            this.$stockInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    this.$addBtn.click();
                }
            });
        }

        const clearBtn = document.querySelector(".input-pill .input-clear");
        if (clearBtn && this.$stockInput) {
            clearBtn.addEventListener("click", () => {
                this.$stockInput.value = "";
                this.$stockInput.focus();
            });
        }

        const refreshBtn = document.getElementById("refreshBtn");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", () => {
                this.refreshAllPrices();
            });
        }
    }

    _seedDemoHoldings() {
        // These are just example positions; in your real app you can load from Firebase instead.
        this.stocks = [
            {
                id: "NVDA-demo",
                symbol: "NVDA",
                name: "NVIDIA Corp.",
                platform: "Fidelity",
                transactions: [
                    { type: "buy", shares: 10, price: 100 },
                    { type: "buy", shares: 40, price: 105 }
                ],
                dividends: [
                    { date: "2024-03-01", totalAmount: 50 }
                ],
                price: 128.45,
                change: 2.34,
                changePercent: 1.86
            },
            {
                id: "TSLA-demo",
                symbol: "TSLA",
                name: "Tesla, Inc.",
                platform: "Robinhood",
                transactions: [
                    { type: "buy", shares: 20, price: 231.5 }
                ],
                dividends: [],
                price: 214.12,
                change: -1.94,
                changePercent: -0.9
            },
            {
                id: "AVGO-demo",
                symbol: "AVGO",
                name: "Broadcom Inc.",
                platform: "Schwab",
                transactions: [
                    { type: "buy", shares: 4, price: 1395 }
                ],
                dividends: [
                    { date: "2024-04-10", totalAmount: 32 }
                ],
                price: 1620.18,
                change: 8.12,
                changePercent: 0.5
            }
        ];
    }

    startAutoRefresh() {
        if (this.refreshIntervalId) {
            clearInterval(this.refreshIntervalId);
        }
        this.refreshIntervalId = setInterval(() => {
            this.refreshAllPrices();
        }, this.refreshIntervalMs);
    }

    // ---- Core public API ----

    addStockFromSymbol(symbol) {
        // For now, add a placeholder holding and then fetch quotes.
        const existing = this.stocks.find(s => s.symbol === symbol);
        if (existing) {
            alert(`Symbol ${symbol} is already in your portfolio.`);
            return;
        }

        const newItem = {
            id: `${symbol}-${Date.now()}`,
            symbol,
            name: symbol,
            platform: "Manual",
            transactions: [
                { type: "buy", shares: 10, price: 100 } // placeholder; user can edit later
            ],
            dividends: [],
            price: 0,
            change: 0,
            changePercent: 0
        };
        this.stocks.push(newItem);

        this.$stockInput.value = "";
        this.renderAll();
        this.refreshAllPrices();
    }

    removeStock(id) {
        this.stocks = this.stocks.filter(s => s.id !== id);
        this.renderAll();
    }

    // ---- Data fetch layer (Finnhub + FMP-ready, user must insert keys) ----

    async refreshAllPrices() {
        const promises = this.stocks.map(item => this.updateQuoteForItem(item));
        await Promise.allSettled(promises);
        this.renderAll();
    }

    async updateQuoteForItem(item) {
        try {
            const quote = await this.fetchQuoteWithFallback(item.symbol);
            if (!quote) return;

            item.price = quote.price;
            item.change = quote.change;
            item.changePercent = quote.changePercent;
        } catch (err) {
            console.error("Failed to update quote for", item.symbol, err);
        }
    }

    async fetchQuoteWithFallback(symbol) {
        // TODO: Put your real Finnhub and FMP keys here
        const FINNHUB_KEY = "YOUR_FINNHUB_KEY_HERE";
        const FMP_KEY = "YOUR_FMP_KEY_HERE";

        // Try Finnhub first
        try {
            const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
            const res = await fetch(finnhubUrl);
            if (res.ok) {
                const data = await res.json();
                if (data && typeof data.c === "number") {
                    const price = data.c;
                    const prevClose = data.pc || 0;
                    const change = price - prevClose;
                    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
                    return { price, change, changePercent };
                }
            }
        } catch (e) {
            console.warn("Finnhub fetch failed for", symbol, e);
        }

        // Fallback to FMP
        try {
            const fmpUrl = `https://financialmodelingprep.com/api/v3/quote/${encodeURIComponent(symbol)}?apikey=${FMP_KEY}`;
            const res = await fetch(fmpUrl);
            if (res.ok) {
                const arr = await res.json();
                if (Array.isArray(arr) && arr.length > 0) {
                    const q = arr[0];
                    const price = q.price || 0;
                    const prevClose = q.previousClose || 0;
                    const change = q.change || (price - prevClose);
                    const changePercent = q.changesPercentage || (prevClose > 0 ? (change / prevClose) * 100 : 0);
                    return { price, change, changePercent };
                }
            }
        } catch (e) {
            console.warn("FMP fetch failed for", symbol, e);
        }

        return null;
    }

    // ---- Portfolio math ----

    calculateTransactionStats(transactions, currentPrice) {
        let totalSharesOwned = 0;
        let totalCostBasis = 0;
        let realizedPL = 0;

        (transactions || []).forEach(t => {
            const qty = Number(t.shares) || 0;
            const px = Number(t.price) || 0;

            if (t.type === "buy") {
                totalSharesOwned += qty;
                totalCostBasis += qty * px;
            } else if (t.type === "sell") {
                totalSharesOwned -= qty;
                totalCostBasis -= qty * px; // simple model; more advanced cost-basis can be plugged in
            }
        });

        // In this simplified engine, realizedPL is not fully modeled;
        // you can enhance this later with real sell P/L tracking.
        realizedPL = 0;

        const currentValue = (currentPrice || 0) * totalSharesOwned;
        const unrealizedPL = currentValue - totalCostBasis;

        return {
            totalSharesOwned,
            totalCostBasis,
            currentValue,
            unrealizedPL,
            realizedPL
        };
    }

    calculateSummaryMetrics(items) {
        let totalCurrentValue = 0;
        let totalUnrealizedPL = 0;
        let totalRealizedPL = 0;
        let totalPLToday = 0;
        let totalPreviousDayValue = 0;
        let totalContributions = 0;
        let totalDividends = 0;

        items.forEach(item => {
            const stats = this.calculateTransactionStats(item.transactions || [], item.price || 0);
            totalRealizedPL += stats.realizedPL;

            if (stats.totalSharesOwned > 0) {
                totalCurrentValue += stats.currentValue;
                totalUnrealizedPL += stats.unrealizedPL;

                const dailyChange = (item.change || 0) * stats.totalSharesOwned;
                totalPLToday += dailyChange;

                const previousDayPrice = (item.price || 0) - (item.change || 0);
                totalPreviousDayValue += previousDayPrice * stats.totalSharesOwned;
            }

            // contributions: buys minus sells
            totalContributions += (item.transactions || []).reduce((sum, t) => {
                const qty = Number(t.shares) || 0;
                const px = Number(t.price) || 0;
                if (t.type === "buy") return sum + qty * px;
                if (t.type === "sell") return sum - qty * px;
                return sum;
            }, 0);

            // dividends
            totalDividends += (item.dividends || []).reduce((sum, d) => {
                return sum + (Number(d.totalAmount) || 0);
            }, 0);
        });

        return {
            totalCurrentValue,
            totalUnrealizedPL,
            totalRealizedPL,
            totalPLToday,
            totalPreviousDayValue,
            totalContributions,
            totalDividends
        };
    }

    // ---- Rendering ----

    renderAll() {
        this.renderPortfolioSummary();
        this.renderStocksGrid();
    }

    formatCurrency(value) {
        const n = Number(value) || 0;
        return n.toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2
        });
    }

    formatNumber(value, digits = 2) {
        const n = Number(value) || 0;
        return n.toLocaleString("en-US", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
    }

    setSummaryElement(el, value, isPercent = false) {
        if (!el) return;
        const n = Number(value) || 0;
        const positive = n >= 0;
        const text = isPercent
            ? `${this.formatNumber(n, 2)}%`
            : this.formatCurrency(n);
        el.textContent = text;
        el.classList.remove("positive", "negative");
        el.classList.add(positive ? "positive" : "negative");
    }

    renderPortfolioSummary() {
        const stockMetrics = this.calculateSummaryMetrics(this.stocks);
        const fundMetrics = this.calculateSummaryMetrics(this.mutualFunds);

        const combinedMetrics = {
            totalCurrentValue: stockMetrics.totalCurrentValue + fundMetrics.totalCurrentValue,
            totalUnrealizedPL: stockMetrics.totalUnrealizedPL + fundMetrics.totalUnrealizedPL,
            totalRealizedPL: stockMetrics.totalRealizedPL + fundMetrics.totalRealizedPL,
            totalPLToday: stockMetrics.totalPLToday + fundMetrics.totalPLToday,
            totalPreviousDayValue: stockMetrics.totalPreviousDayValue + fundMetrics.totalPreviousDayValue,
            totalContributions: stockMetrics.totalContributions + fundMetrics.totalContributions,
            totalDividends: stockMetrics.totalDividends + fundMetrics.totalDividends
        };

        const totalOverallPL = combinedMetrics.totalUnrealizedPL + combinedMetrics.totalRealizedPL;

        const totalOverallPLPercent =
            combinedMetrics.totalContributions > 0
                ? (totalOverallPL / combinedMetrics.totalContributions) * 100
                : 0;

        const totalPLPercentToday =
            combinedMetrics.totalPreviousDayValue > 0
                ? (combinedMetrics.totalPLToday / combinedMetrics.totalPreviousDayValue) * 100
                : 0;

        this.setSummaryElement(this.$combinedTotal, combinedMetrics.totalCurrentValue, false);
        if (this.$chartCurrentValue) {
            this.$chartCurrentValue.textContent = this.formatCurrency(combinedMetrics.totalCurrentValue);
        }

        this.setSummaryElement(this.$stocksTotal, stockMetrics.totalCurrentValue, false);
        this.setSummaryElement(this.$fundsTotal, fundMetrics.totalCurrentValue, false);

        if (this.$totalContributions) {
            this.$totalContributions.textContent = this.formatCurrency(combinedMetrics.totalContributions);
        }
        if (this.$totalDividends) {
            this.$totalDividends.textContent = this.formatCurrency(combinedMetrics.totalDividends);
        }

        this.setSummaryElement(this.$totalPLToday, combinedMetrics.totalPLToday, false);
        this.setSummaryElement(this.$totalPLPercentToday, totalPLPercentToday, true);
        this.setSummaryElement(this.$totalPLUnrealized, combinedMetrics.totalUnrealizedPL, false);
        this.setSummaryElement(this.$totalPLRealized, combinedMetrics.totalRealizedPL, false);

        // Overall P/L% could be shown somewhere later if you add an element for it
        // console.log("Overall PL %:", totalOverallPLPercent);
    }

    renderStocksGrid() {
        if (!this.$stocksGrid) return;
        this.$stocksGrid.innerHTML = "";

        this.stocks.forEach(item => {
            const stats = this.calculateTransactionStats(item.transactions || [], item.price || 0);
            const todayPL = (item.change || 0) * stats.totalSharesOwned;

            const card = document.createElement("article");
            card.className = "stock-card";

            const changePositive = (item.change || 0) >= 0;
            const todayPositive = todayPL >= 0;
            const overallPLPositive = stats.unrealizedPL >= 0;

            card.innerHTML = `
                <div class="stock-header-row">
                    <div>
                        <div class="stock-symbol">${item.symbol}</div>
                        <div class="stock-name">${item.name || ""}</div>
                    </div>
                    <div class="stock-price-block">
                        <div class="stock-price">${this.formatCurrency(item.price || 0)}</div>
                        <div class="stock-change-line ${changePositive ? "stock-change-positive" : "stock-change-negative"}">
                            ${(changePositive ? "+" : "") + this.formatCurrency(item.change || 0)} 
                            (${this.formatNumber(item.changePercent || 0, 2)}%)
                        </div>
                    </div>
                </div>
                <div class="stock-tags-row">
                    <span class="badge-soft">Platform: ${item.platform || "N/A"}</span>
                    <span>Shares: ${stats.totalSharesOwned}</span>
                </div>
                <div class="stock-metrics">
                    <div>
                        <div class="metric-label">Value</div>
                        <div class="metric-value">${this.formatCurrency(stats.currentValue)}</div>
                    </div>
                    <div>
                        <div class="metric-label">Overall P/L</div>
                        <div class="metric-value ${overallPLPositive ? "positive" : "negative"}">
                            ${(overallPLPositive ? "+" : "") + this.formatCurrency(stats.unrealizedPL)}
                        </div>
                    </div>
                    <div>
                        <div class="metric-label">Today P/L</div>
                        <div class="metric-value ${todayPositive ? "positive" : "negative"}">
                            ${(todayPositive ? "+" : "") + this.formatCurrency(todayPL)}
                        </div>
                    </div>
                </div>
                <div class="stock-footer-row">
                    <span>Avg cost: ${stats.totalSharesOwned > 0 ? this.formatCurrency(stats.totalCostBasis / stats.totalSharesOwned) : "$0.00"}</span>
                    <button class="mini-btn" data-id="${item.id}">Details</button>
                    <button class="mini-btn" data-remove-id="${item.id}" style="margin-left:6px;">Remove</button>
                </div>
            `;

            // Hook up buttons
            const detailsBtn = card.querySelector('button[data-id]');
            if (detailsBtn) {
                detailsBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    alert(`Details for ${item.symbol} coming soon (engine.js stub).`);
                });
            }
            const removeBtn = card.querySelector('button[data-remove-id]');
            if (removeBtn) {
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.removeStock(item.id);
                });
            }

            this.$stocksGrid.appendChild(card);
        });
    }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    window.stockTracker = new StockTracker();
});
