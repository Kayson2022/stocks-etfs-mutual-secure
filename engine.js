// RECOMMENDATION: Updated Firebase to a newer, more stable version.
import { initializeApp 
        const yEl = document.getElementById('value-yesterday');
        if(yEl){
            const yesterdayVal = totalVal - totalPLToday;
            yEl.textContent = this.formatCurrency(yesterdayVal);
            yEl.title = "Yesterday = Today – Total P/L Today";
        }
    }
 from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, browserPopupRedirectResolver, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB8wQ0-O2avYjRW7Wjtmiql03q1ikwhX7s",
    authDomain: "stocks-etfs-mutual.firebaseapp.com",
    projectId: "stocks-etfs-mutual",
    storageBucket: "stocks-etfs-mutual.firebasestorage.app",
    messagingSenderId: "326474465163",
    appId: "1:326474465163:web:6d140efca04077ba8f1f98e"
};

const PHA_BACKEND_BASE = "https://stock-backend-secure.giolamchieu1975.workers.dev";


function buildPlatformDropdown() {
    const select = document.getElementById("platformFilter");
    if (!select || !window.stockTracker) return;

    const platforms = new Set();

    const items = [
        ...(window.stockTracker.stocks || []),
        ...(window.stockTracker.mutualFunds || [])
    ];

    items.forEach(item => {
        if (item && typeof item.platform === "string") {
            const trimmed = item.platform.trim();
            if (trimmed) {
                platforms.add(trimmed);
            }
        }
    });

    // Reset dropdown: always start with "All Platforms"
    select.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "All Platforms";
    allOpt.textContent = "All Platforms";
    select.appendChild(allOpt);

    // Add each unique platform, sorted alphabetically for consistency
    Array.from(platforms).sort().forEach(p => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        select.appendChild(opt);
    });
}


let app, auth, db;
if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
}

// --- HELPER FOR BACKEND RANGES ---
function phaMapRangeForBackend(rangeKey) {
    switch (rangeKey) {
        case 'BAR_TODAY': case '1D': case 'Today': return '1d';
        case '1W': return '5d';
        case '1M': return '1mo';
        case '3M': return '3mo';
        case '6M': return '6mo';
        case 'YTD': return 'ytd';
        case '1Y': return '1y';
        case '3Y': return '5y';
        case '5Y': return '5y';
        case 'ALL': return 'max';
        default: return '1mo';
    }
}

class ApiService {
    constructor(config) { this.config = config; }

    // ... [Existing Yahoo/Finnhub fetchers can stay if you want, but are largely unused by the Unified logic below] ...

    // --- SMART UNIFIED FETCH (Yahoo Backend + Math Correction) ---
    async fetchStockEtfQuote(symbol, rangeKey = "1D") {
        const backendRange = phaMapRangeForBackend(rangeKey);
        try {
            const url = `${PHA_BACKEND_BASE}?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(backendRange)}&mode=quote`;
            const response = await fetch(url);
            if (!response.ok) return { success: false, symbol, reason: `Backend Error: ${response.status}` };
            
            const payload = await response.json();
            if (payload.error) return { success: false, symbol, reason: payload.error };

            // --- FORCE MATHEMATICAL CONSISTENCY ---
            let price = Number(payload.last || payload.price || 0);
            let percentChange = 0;
            
            // Handle various percent formats
            if (payload.changePercent !== undefined && payload.changePercent !== null) {
                // If it's a string like "22.5%", clean it. If it's a number, use it.
                percentChange = parseFloat(String(payload.changePercent).replace('%', ''));
            }

            // Force Previous Close to match Percent
            let previousClose = 0;
            if (price > 0 && percentChange !== 0) {
                previousClose = price / (1 + (percentChange / 100));
            } else {
                previousClose = Number(payload.previousClose || payload.chartPreviousClose || price);
            }
            
            // Force Dollar Change to match
            let change = price - previousClose;

            return {
                success: true,
                data: {
                    price,
                    change, 
                    changePercent: percentChange, // Standardized Key
                    percentChange: percentChange, // Legacy Key support
                    high: Number(payload.dayHigh || price),
                    low: Number(payload.dayLow || price),
                    previousClose
                },
                source: "backend-corrected"
            };
        } catch (error) {
            console.error(`Backend fetch failed for ${symbol}:`, error);
            return { success: false, symbol, reason: error.message };
        }
    }

    // --- Fetch History (Unified) ---
    async fetchUnifiedStockHistory(symbol, range) {
        const backendRange = phaMapRangeForBackend(range);
        try {
            const url = `${PHA_BACKEND_BASE}?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(backendRange)}`;
            const response = await fetch(url);
            if (!response.ok) return { success: false, history: [] };
            
            const payload = await response.json();
            const chart = payload.data || {};
            const timestamps = chart.timestamp || [];
            const closes = (chart.indicators && (chart.indicators.adjclose?.[0]?.adjclose || chart.indicators.quote?.[0]?.close)) || [];
            
            const history = timestamps.map((t, i) => ({ 
                date: new Date(t * 1000), 
                price: Number(closes[i]) 
            })).filter(p => !isNaN(p.price));
            
            return { success: true, history };
        } catch (e) { return { success: false, history: [] }; }
    }

    // --- Mutual Fund Fallback Wrapper ---
    async fetchMutualFundDataWithFallback(symbol) {
        // Try standard fetch first (many funds work on Yahoo backend)
        const q = await this.fetchStockEtfQuote(symbol);
        if (q.success) return q;
        // Add specific FMP/AlphaVantage fallbacks here if needed
        return { success: false, reason: "Fund fetch failed" };
    }
    
    // --- Legacy Support ---
    async fetchHistoricalData(symbol) { return this.fetchUnifiedStockHistory(symbol, '1Y'); }
    async fetchSymbolNews(symbol) { return []; } 
}

class StockTracker {
    constructor() {
        this.stocks = []; this.mutualFunds = []; this.watchlist = []; 
        this.config = { refreshIntervalMs: 60000 };
        this.activeBottomRange = "BAR_TODAY";
        this.init();
    }

    init() {
        this.apiService = new ApiService(this.config);
        this.cacheDOM();
        this.setupListeners();
        if (auth) this.handleAuth();
    }

    cacheDOM() {
        // Essential elements
        this.elements = {
            loginContainer: document.getElementById('login-container'),
            appContainer: document.getElementById('app-container'),
            googleSignInBtn: document.getElementById('google-signin-btn'),
            userInfo: document.getElementById('user-info'),
            userName: document.getElementById('user-name'),
            signOutBtn: document.getElementById('sign-out-btn'),
            stocksGrid: document.getElementById('stocksGrid'),
            loadingDiv: document.getElementById('loading'),
            stockInput: document.getElementById('stockInput'),
            addBtn: document.getElementById('addBtn'),
            liveUpdateBtn: document.getElementById('liveUpdateBtn'),
            // Charts
            portfolioPerformanceContainer: document.getElementById('portfolio-performance-container'),
            portfolioPerformanceBarChart: document.getElementById('portfolioPerformanceBarChart'),
            portfolioPerformanceChart: document.getElementById('portfolioPerformanceChart'),
            historicalChartWrapper: document.getElementById('historical-chart-wrapper'),
            barChartWrapper: document.getElementById('bar-chart-wrapper'),
            portfolioChartTitle: document.getElementById('portfolio-chart-title'),
            chartCurrentValue: document.getElementById('chart-current-value'),
            performanceChartControls: document.getElementById('performance-chart-controls')
        };
    }

    setupListeners() {
        if(this.elements.googleSignInBtn) this.elements.googleSignInBtn.addEventListener('click', () => this.signIn());
        if(this.elements.signOutBtn) this.elements.signOutBtn.addEventListener('click', () => this.signOut());
        if(this.elements.addBtn) this.elements.addBtn.addEventListener('click', () => this.addItemFromInput());
        if(this.elements.liveUpdateBtn) this.elements.liveUpdateBtn.addEventListener('click', () => this.refreshData());
        
        if(this.elements.performanceChartControls) {
            this.elements.performanceChartControls.addEventListener('click', (e) => {
                if (e.target.classList.contains('chart-range-btn')) {
                    const range = e.target.dataset.range;
                    if(range) {
                        this.activeBottomRange = range;
                        this.renderPortfolioPerformanceChart(range);
                    }
                }
            });
        }
        const platformFilterEl = document.getElementById('platformFilter');
        if (platformFilterEl) {
            platformFilterEl.addEventListener('change', () => {
                this.renderContent();
            });
        }

    }

    signIn() {
        signInWithPopup(auth, new GoogleAuthProvider(), browserPopupRedirectResolver).catch(e => console.error(e));
    }
    signOut() { signOut(auth); }

    handleAuth() {
        onAuthStateChanged(auth, user => {
            if (user) {
                this.userId = user.uid;
                if(this.elements.loginContainer) this.elements.loginContainer.style.display = 'none';
                if(this.elements.appContainer) this.elements.appContainer.style.display = 'block';
                if(this.elements.userName) this.elements.userName.textContent = `Welcome, ${user.displayName}`;
                this.loadData();
            } else {
                this.userId = null;
                if(this.elements.loginContainer) this.elements.loginContainer.style.display = 'block';
                if(this.elements.appContainer) this.elements.appContainer.style.display = 'none';
            }
        });
    }

    async loadData() {
        if (!this.userId) return;
        const docSnap = await getDoc(doc(db, "users", this.userId));
        if (docSnap.exists()) {
            const data = docSnap.data();
            this.stocks = data.stocks || [];
            this.mutualFunds = data.mutualFunds || [];
            this.watchlist = data.watchlist || [];
            this.priceAlerts = data.priceAlerts || [];
            this.portfolioHistory = data.portfolioHistory || [];

            // --- SANITIZER: FIX DATA ON LOAD ---
            // This runs instantly to fix RBRK/Sorting before you even see the dashboard
            const sanitize = (item) => {
                const p = Number(item.price) || 0;
                // Normalize key names: Use changePercent
                const pct = Number(item.changePercent) || Number(item.percentChange) || 0;
                item.changePercent = pct; // enforce standard name
                
                if(p > 0 && pct !== 0) {
                    const calculatedPrev = p / (1 + (pct / 100));
                    item.previousClose = calculatedPrev;
                    item.change = p - calculatedPrev;
                }
            };
            this.stocks.forEach(sanitize);
            this.mutualFunds.forEach(sanitize);
            this.watchlist.forEach(sanitize);
            // -----------------------------------
        }
        this.renderContent();
        buildPlatformDropdown();
        this.renderPortfolioPerformanceChart('BAR_TODAY');
    }

    // --- ROBUST CARD LOGIC ---
    // Forces the card numbers to match the percentage, fixing sorting visual bugs
    computeTodayForItem(item) {
        const price = Number(item.price) || 0;
        let changePercent = Number(item.changePercent) || 0;
        let previousClose = Number(item.previousClose) || price;

        // Force Consistency
        if (price > 0 && changePercent !== 0) {
            previousClose = price / (1 + (changePercent / 100));
        }

        const stats = this.calculateTransactionStats(item.transactions, price);
        const sharesOwned = stats.totalSharesOwned || 0;
        const changeToday = price - previousClose; 
        const plToday = sharesOwned * changeToday;

        return { plToday, changePercent, sharesOwned, price, previousClose, changeToday };
    }

    calculateTransactionStats(transactions = [], currentPrice = 0) {
        let totalShares = 0, cost = 0;
        (transactions||[]).forEach(t => {
            if(t.type==='buy') { totalShares += t.shares; cost += t.shares*t.price; }
            else if(t.type==='sell') { totalShares -= t.shares; cost -= t.shares*t.price; }
        });
        const currentValue = totalShares * currentPrice;
        return { 
            totalSharesOwned: totalShares, 
            currentValue: currentValue, 
            unrealizedPL: currentValue - cost, 
            realizedPL: 0, 
            averageCostBasis: totalShares ? cost/totalShares : 0 
        };
    }

    renderContent() {
        if(!this.elements.stocksGrid) return;
        this.elements.stocksGrid.innerHTML = '';
        let totalVal = 0, totalPLToday = 0;
        
        const platformSelect = document.getElementById('platformFilter');
        const selectedPlatform = platformSelect ? platformSelect.value : "All Platforms";

        let items = [...this.stocks, ...this.mutualFunds];
        if (selectedPlatform && selectedPlatform !== "All Platforms") {
            items = items.filter(item => item.platform === selectedPlatform);
        }

        // --- SORTING LOGIC ---
        // Sort by changePercent descending (Highest gain first)
        items.sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));

        const gainers = items.filter(i => (i.changePercent || 0) >= 0);
        const losers = items.filter(i => (i.changePercent || 0) < 0);

        const renderGroup = (title, groupItems) => {
            if(!groupItems.length) return;
            const header = document.createElement('div');
            header.className = 'group-header';
            header.innerHTML = `${title} (${groupItems.length})`;
            this.elements.stocksGrid.appendChild(header);

            const container = document.createElement('div');
            container.className = 'group-content';
            container.style.display = 'grid'; // Force display
            
            groupItems.forEach(item => {
                const stats = this.computeTodayForItem(item);
                const txnStats = this.calculateTransactionStats(item.transactions, stats.price);
                totalVal += txnStats.currentValue;
                totalPLToday += stats.plToday;

                const card = document.createElement('div');
                card.className = 'stock-card';
                card.innerHTML = `
                    <div class="stock-header">
                        <span class="stock-symbol">${item.symbol}</span>
                    </div>
                    <div class="stock-price">${this.formatCurrency(stats.price)}</div>
                    <div class="stock-change ${stats.changeToday >= 0 ? 'positive' : 'negative'}">
                        ${stats.changeToday >= 0 ? '▲' : '▼'} ${this.formatCurrency(stats.changeToday)} (${stats.changePercent.toFixed(2)}%)
                    </div>
                    <div class="stock-info">
                        <div class="info-row"><span class="info-label">Shares:</span><span class="info-value">${txnStats.totalSharesOwned.toFixed(3)}</span></div>
                        <div class="info-row"><span class="info-label">Value:</span><span class="info-value">${this.formatCurrency(txnStats.currentValue)}</span></div>
                        <div class="info-row"><span class="info-label">P/L Today:</span><span class="info-value ${stats.plToday >= 0 ? 'positive' : 'negative'}">${this.formatCurrency(stats.plToday)}</span></div>
                    </div>
                    <div class="card-actions">
                         <button class="add-btn buy-btn" onclick="window.stockTracker.openTransactionModal('${item.id}', 'buy')">Buy</button>
                         <button class="add-btn sell-btn" onclick="window.stockTracker.openTransactionModal('${item.id}', 'sell')">Sell</button>
                    </div>
                `;
                container.appendChild(card);
            });
            this.elements.stocksGrid.appendChild(container);
        };

        renderGroup('🚀 Gains Today', gainers);
        renderGroup('📉 Losses Today', losers);

        // Update Summaries
        if(this.elements.chartCurrentValue) this.elements.chartCurrentValue.textContent = this.formatCurrency(totalVal);
        const plEl = document.getElementById('total-pl-today');
        if(plEl) {
            plEl.textContent = this.formatCurrency(totalPLToday);
            plEl.className = `summary-value ${totalPLToday >= 0 ? 'positive' : 'negative'}`;
        }
    }

    renderPortfolioPerformanceChart(range) {
        // Simplified chart render router
        const isBar = range === 'BAR_TODAY';
        if(this.elements.barWrapper) this.elements.barWrapper.style.display = isBar ? 'block' : 'none';
        if(this.elements.historicalChartWrapper) this.elements.historicalChartWrapper.style.display = isBar ? 'none' : 'block';
        if(this.elements.portfolioChartTitle) this.elements.portfolioChartTitle.textContent = isBar ? "Top Movers Today" : "Portfolio History";

        // Update buttons
        if(this.elements.performanceChartControls) {
            const buttons = this.elements.performanceChartControls.querySelectorAll('.chart-range-btn');
            buttons.forEach(b => b.classList.remove('active'));
            const activeBtn = this.elements.performanceChartControls.querySelector(`[data-range="${range}"]`);
            if(activeBtn) activeBtn.classList.add('active');
        }

        if (isBar) {
            this.renderBarChart();
        }
    }

    renderBarChart() {
        const ctx = this.elements.portfolioPerformanceBarChart.getContext('2d');
        if (this.portfolioPerformanceBarChartInstance) this.portfolioPerformanceBarChartInstance.destroy();

        // Use the corrected stats for the chart
        const movers = [...this.stocks, ...this.mutualFunds].map(item => {
            const stats = this.computeTodayForItem(item);
            return { symbol: item.symbol, pl: stats.plToday };
        }).filter(i => Math.abs(i.pl) > 0.01).sort((a,b) => Math.abs(b.pl) - Math.abs(a.pl)).slice(0, 10);

        this.portfolioPerformanceBarChartInstance = createSafeChart(ctx, {
            type: 'bar',
            data: {
                labels: movers.map(m => m.symbol),
                datasets: [{
                    data: movers.map(m => m.pl),
                    backgroundColor: movers.map(m => m.pl >= 0 ? '#17A589' : '#E74C3C')
                }]
            },
            options: { responsive: true, plugins: { legend: { display: false } } }
        });
    }

    async refreshData() {
        if(this.elements.loadingDiv) this.elements.loadingDiv.style.display = 'block';
        for (const item of [...this.stocks, ...this.mutualFunds]) {
            const res = await this.apiService.fetchStockEtfQuote(item.symbol);
            if (res.success) Object.assign(item, res.data);
        }
        await this.saveData(); 
        this.renderContent();
        buildPlatformDropdown();
        this.renderPortfolioPerformanceChart(this.activeBottomRange);
        if(this.elements.loadingDiv) this.elements.loadingDiv.style.display = 'none';
    }

    async addItemFromInput() {
        const symbol = this.elements.stockInput.value.toUpperCase();
        if(!symbol) return;
        const res = await this.apiService.fetchStockEtfQuote(symbol);
        if(res.success) {
            const newItem = { ...res.data, symbol, id: Date.now().toString(), transactions: [] };
            this.stocks.push(newItem);
            await this.saveData();
            this.elements.stockInput.value = '';
            this.renderContent();
            buildPlatformDropdown();
        }
    }

    // Helpers
    formatCurrency(val) { return val.toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
    openTransactionModal(id, type) { /* ...Modal logic... */ document.getElementById('transactionModal').style.display='flex'; }
    switchTab(tab) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
        const tabBtn = document.querySelector(`[onclick="window.stockTracker.switchTab('${tab}')"]`);
        if(tabBtn) tabBtn.classList.add('active');
        document.getElementById(`${tab}-tab`).style.display = 'block';
        this.renderContent();
    }
}

window.stockTracker = new StockTracker();
