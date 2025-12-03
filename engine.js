// RECOMMENDATION: Updated Firebase to a newer, more stable version.
        import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
        import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
        import { getFirestore, doc, setDoc, getDoc, serverTimestamp, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
        
        const firebaseConfig = {
            apiKey: "AIzaSyB8wQ0-O2avYjRW7Wjtmiql03q1ikwhX7s",
            authDomain: "stocks-etfs-mutual.firebaseapp.com",
            projectId: "stocks-etfs-mutual",
            storageBucket: "stocks-etfs-mutual.firebasestorage.app",
            messagingSenderId: "326474465163",
            appId: "1:326474465163:web:6d140efca04077ba8f1f98e"
        };
        
        let app, auth, db;
        if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
            app = initializeApp(firebaseConfig);
            auth = getAuth(app);
            db = getFirestore(app);
        }

        class ApiService {
            constructor(config) { this.config = config; }
            
            // Utility function to check for mutual fund symbol pattern (unchanged)
            isMutualFund(symbol) { return symbol.length === 5 && symbol.endsWith('X'); }
            
            // --- Finnhub Fetch (Primary for Stock/ETFs) ---
            async fetchStockEtfData(symbol) {
                const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${this.config.finnhubApiKey}`;
                const profileUrl = `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${this.config.finnhubApiKey}`;
                try {
                    const [quoteResponse, profileResponse] = await Promise.all([fetch(quoteUrl), fetch(profileUrl)]);
                    if (!quoteResponse.ok || !profileResponse.ok) return { success: false, symbol, reason: `Finnhub HTTP Error: ${quoteResponse.status}` };
                    const [quoteData, profileData] = await Promise.all([quoteResponse.json(), profileResponse.json()]);
                    if (quoteData.c === 0 && quoteData.pc === 0 && !profileData.name) return { success: false, symbol, reason: 'Finnhub: Invalid or empty API payload' };
                    
                    const isMutualFund = this.isMutualFund(symbol);

                    return { success: true, data: { 
                        symbol, 
                        name: profileData.name ?? symbol, 
                        price: quoteData.c ?? 0, 
                        change: quoteData.d ?? 0, 
                        changePercent: quoteData.dp ?? 0, 
                        open: quoteData.o ?? 0, 
                        high: quoteData.h ?? 0, 
                        low: quoteData.l ?? 0, 
                        previousClose: quoteData.pc ?? 0, 
                        industry: isMutualFund ? 'Mutual Fund' : (profileData.finnhubIndustry ?? 'N/A') 
                    } };
                } catch (error) {
                      console.error(`Error fetching stock/ETF data for ${symbol} (Finnhub):`, error);
                      return { success: false, symbol, reason: `Finnhub Error: ${error.message}` };
                }
            }

            // --- Finnhub Quote (for refreshing) ---
            async fetchStockEtfQuote(symbol) {
                const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${this.config.finnhubApiKey}`;
                try {
                    const response = await fetch(quoteUrl);
                    if (!response.ok) return { success: false, symbol, reason: `Finnhub HTTP Error: ${response.status}` };
                    const quoteData = await response.json();
                    if (quoteData.c === 0 && quoteData.pc === 0) return { success: false, symbol, reason: 'Finnhub: Invalid or empty API payload' };
                    return { success: true, data: { price: quoteData.c ?? 0, change: quoteData.d ?? 0, changePercent: quoteData.dp ?? 0, open: quoteData.o ?? 0, high: quoteData.h ?? 0, low: quoteData.l ?? 0, previousClose: quoteData.pc ?? 0 } };
                } catch (error) {
                    console.error(`Error fetching stock/ETF quote for ${symbol} (Finnhub):`, error);
                    return { success: false, symbol, reason: `Finnhub Error: ${error.message}` };
                }
            }
            
            // --- FMP Fetch (Second Priority for Mutual Funds) ---
            async fetchFmpFundData(symbol) {
                 const url = `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${this.config.fmpApiKey}`;
                 if (!this.config.fmpApiKey || this.config.fmpApiKey === 'YOUR_FMP_API_KEY') {
                    return { success: false, symbol, reason: "FMP API Key missing." };
                 }
                 try {
                    const response = await fetch(url);
                    if (!response.ok) return { success: false, symbol, reason: `FMP HTTP Error: ${response.status}` };
                    const json = await response.json();
                    const quote = json[0];
                    if (!quote || !quote.price) return { success: false, symbol, reason: 'FMP: Invalid or empty API payload' };
                    
                    return { success: true, data: { 
                        symbol: quote.symbol ?? symbol, 
                        name: quote.name ?? symbol, 
                        price: parseFloat(quote.price) || 0, 
                        change: parseFloat(quote.change) || 0, 
                        changePercent: parseFloat(quote.changesPercentage) || 0, 
                        open: parseFloat(quote.open) || 0, 
                        high: parseFloat(quote.dayHigh) || 0, 
                        low: parseFloat(quote.dayLow) || 0, 
                        previousClose: parseFloat(quote.previousClose) || 0, 
                        industry: 'Mutual Fund' 
                    } };
                } catch (error) {
                    console.error(`Error fetching fund data for ${symbol} (FMP):`, error);
                    return { success: false, symbol, reason: `FMP Error: ${error.message}` };
                }
            }
            
            // --- Alpha Vantage Fetch (Last Resort for Mutual Funds) ---
            async fetchAlphaVantageFundData(symbol) {
                const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this.config.alphaVantageKey}`;
                if (!this.config.alphaVantageKey || this.config.alphaVantageKey === 'YOUR_ALPHA_VANTAGE_KEY') {
                    return { success: false, symbol, reason: "Alpha Vantage API Key missing." };
                }
                try {
                    const response = await fetch(url);
                    if (!response.ok) return { success: false, symbol, reason: `Alpha Vantage HTTP Error: ${response.status}` };
                    const json = await response.json();
                    const quote = json['Global Quote'];
                    if (!quote || Object.keys(quote).length === 0) return { success: false, symbol, reason: 'Alpha Vantage: Invalid API payload or rate limit reached.' };
                    return { success: true, data: { 
                        symbol: quote['01. symbol'] ?? symbol, 
                        name: quote['01. symbol'] ?? symbol, 
                        price: parseFloat(quote['05. price']) || 0, 
                        change: parseFloat(quote['09. change']) || 0, 
                        changePercent: parseFloat(quote['10. change percent'].replace('%', '')) || 0, 
                        open: parseFloat(quote['02. open']) || 0, 
                        high: parseFloat(quote['03. high']) || 0, 
                        low: parseFloat(quote['04. low']) || 0, 
                        previousClose: parseFloat(quote['08. previous close']) || 0, 
                        industry: 'Mutual Fund' 
                    } };
                } catch (error) {
                    console.error(`Error fetching fund data for ${symbol} (Alpha Vantage):`, error);
                    return { success: false, symbol, reason: `Alpha Vantage Error: ${error.message}` };
                }
            }
            
            // --- Fallback Function for Mutual Funds (STRICTLY FMP -> AV) ---
            async fetchMutualFundDataWithFallback(symbol) {
                // Check if the symbol might be a stock/ETF first via Finnhub quote
                let quoteResult = await this.fetchStockEtfQuote(symbol);

                if (quoteResult.success && !this.isMutualFund(symbol)) {
                    // It seems like a stock/ETF (non-mutual fund format), use the full data fetch
                    const dataResult = await this.fetchStockEtfData(symbol);
                    if (dataResult.success) {
                         return dataResult;
                    }
                }
                
                // If it's explicitly a mutual fund (e.g., ends with X) or Finnhub failed, proceed with fund fallbacks
                
                // 1. Try FMP (Primary for Mutual Funds)
                let result = await this.fetchFmpFundData(symbol);

                if (result.success && result.data.price > 0) {
                    return result;
                }

                console.log(`FMP failed for ${symbol}. Falling back to Alpha Vantage...`);
                
                // 2. Try Alpha Vantage last resort
                result = await this.fetchAlphaVantageFundData(symbol); 

                if (result.success && result.data.price > 0) {
                    return result;
                }
                
                // All failed
                return { success: false, symbol, reason: `All fund APIs failed. Last error: ${result.reason || 'Data not found.'}` };
            }

            // --- Historical Data Fetch (Uses Alpha Vantage) ---
            async fetchHistoricalData(symbol) {
                if (!this.config.alphaVantageKey || this.config.alphaVantageKey === 'YOUR_ALPHA_VANTAGE_KEY') {
                    // Fail early if key is missing
                    return { success: false, reason: "Alpha Vantage API Key is missing. Please set it in Settings to fetch historical data." };
                }
                const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${symbol}&outputsize=full&apikey=${this.config.alphaVantageKey}`;
                try {
                    const response = await fetch(url);
                    if (!response.ok) return { success: false, reason: `HTTP Error: ${response.status}` };
                    const json = await response.json();
                    // Check for API errors or rate limiting messages in the response
                    if (json["Error Message"] || !json["Time Series (Daily)"]) {
                        return { success: false, reason: json["Information"] || json["Error Message"] || 'Invalid API payload from Alpha Vantage. You might be hitting the free tier rate limit of 5 requests per minute.' };
                    }
                    return { success: true, data: json["Time Series (Daily)"] };
                } catch (error) {
                    console.error(`Error fetching historical data for ${symbol}:`, error);
                    return { success: false, symbol, reason: error.message };
                }
            }
            
            // --- NEW: Finnhub News Fetch (Primary News Source) ---
            async fetchFinnhubCompanyNews(symbol) {
                // Fetch news for the last 7 days
                const now = new Date().toISOString().split('T')[0];
                const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                
                const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${oneWeekAgo}&to=${now}&token=${this.config.finnhubApiKey}`;

                // API Key check is now handled centrally in StockTracker.fetchAndRenderNews
                
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                         // Non-critical API error, just means we should try the fallback
                        return { success: false, reason: `Finnhub HTTP Error: ${response.status}` };
                    }
                    const json = await response.json();
                    
                    if (!Array.isArray(json) || json.length === 0) {
                         // Data successful but empty, trigger fallback
                        return { success: false, reason: 'Finnhub returned no company news' };
                    }

                    // Map Finnhub format to a standardized format
                    const normalizedNews = json.map(item => ({
                        symbol: item.related || symbol,
                        title: item.headline,
                        text: item.summary,
                        url: item.url,
                        image: item.image,
                        source: item.source,
                        publishedDate: new Date(item.datetime * 1000).toISOString(), // Finnhub uses Unix timestamp
                        priority: 'Finnhub'
                    }));

                    return { success: true, data: normalizedNews };
                } catch (error) {
                    console.error(`Error fetching Finnhub news for ${symbol}:`, error);
                    return { success: false, reason: `Finnhub Fetch Error: ${error.message}` };
                }
            }

            // --- NEW: FMP News Fetch (Fallback News Source) ---
            async fetchFmpTickerNews(symbol) {
                 // Using FMP's general news endpoint filtered by tickers
                 const url = `https://financialmodelingprep.com/api/v3/general-news?limit=10&tickers=${symbol}&apikey=${this.config.fmpApiKey}`;
                 
                 // API Key check is now handled centrally in StockTracker.fetchAndRenderNews

                 try {
                    const response = await fetch(url);
                    
                    if (!response.ok) {
                        // FIX: If the specific ticker news endpoint fails with 403, try the general feed as a final fallback.
                        if (response.status === 403) {
                             console.warn(`FMP ticker-specific news failed with 403 for ${symbol}. Attempting general FMP news fallback.`);
                             return await this.fetchFmpGeneralNews();
                        }
                        return { success: false, reason: `FMP HTTP Error: ${response.status}` };
                    }
                    
                    const json = await response.json();
                    
                    if (!Array.isArray(json) || json.length === 0) {
                        return { success: false, reason: 'FMP returned no filtered news' };
                    }
                    
                    // FMP data is usually in the required format, add priority flag
                    const normalizedNews = json.map(item => ({...item, priority: 'FMP' }));

                    return { success: true, data: normalizedNews };
                } catch (error) {
                    console.error(`Error fetching FMP ticker news for ${symbol}:`, error);
                    return { success: false, reason: `FMP Fetch Error: ${error.message}` };
                }
            }
            
            // --- NEW: FMP General News Fetch (Final News Fallback) ---
            async fetchFmpGeneralNews() {
                // Fetches general news (not ticker-specific)
                // FIX: Corrected URL typo (modelingprep -> financialmodelingprep)
                const url = `https://financialmodelingprep.com/api/v3/general-news?limit=10&apikey=${this.config.fmpApiKey}`;

                try {
                    const response = await fetch(url);
                    if (!response.ok) return { success: false, reason: `FMP General HTTP Error: ${response.status}` };
                    const json = await response.json();

                    if (!Array.isArray(json) || json.length === 0) {
                        return { success: false, reason: 'FMP returned no general news' };
                    }

                    // FMP data is usually in the required format, add priority flag
                    const normalizedNews = json.map(item => ({...item, priority: 'FMP (General)' }));

                    return { success: true, data: normalizedNews };
                } catch (error) {
                    console.error("Error fetching FMP general news:", error);
                    return { success: false, reason: `FMP General Fetch Error: ${error.message}` };
                }
            }


            // --- NEW: Unified News Fetcher with Fallback ---
            async fetchSymbolNews(symbol) {
                // 1. Try Finnhub (Primary)
                if (this.config.finnhubApiKey && this.config.finnhubApiKey !== 'YOUR_FINNHUB_API_KEY') {
                    let result = await this.fetchFinnhubCompanyNews(symbol);
                    if (result.success) {
                        return result.data;
                    }
                    console.log(`Finnhub news failed for ${symbol}. Reason: ${result.reason}. Falling back to FMP...`);
                }

                // 2. Try FMP (Fallback - Ticker-specific, includes 403 general fallback)
                if (this.config.fmpApiKey && this.config.fmpApiKey !== 'YOUR_FMP_API_KEY') {
                    let result = await this.fetchFmpTickerNews(symbol);
                    if (result.success) {
                        return result.data;
                    }
                    console.error(`FMP news also failed for ${symbol}. Reason: ${result.reason}.`);
                }
                
                return []; // Return empty array on final failure
            }
        }
        
        class StockTracker {
            constructor() {
                this.userId = null; this.stocks = []; this.mutualFunds = []; this.watchlist = []; this.portfolioHistory = [];
                this.priceAlerts = []; this.newsFeed = []; this.newsFetchTime = 0;
                this.currentTab = 'stocks'; this.onConfirm = null;
                this.isLiveUpdatePaused = false;
                this.isDarkMode = false;
                this.isPrivacyMode = false;
                this.countdownIntervalId = null;
                this.refreshIntervalId = null;
                this.groupCollapseState = {};
                this.diversificationChartInstance = null;
                this.portfolioPerformanceChartInstance = null;
                this.portfolioPerformanceBarChartInstance = null; // NEW: Bar chart instance
                this.cardChartInstances = {}; // To manage individual card charts
                this.chartDataCache = {}; // Cache for historical data (NEW: Persists in session/memory)
                this.sessionId = crypto.randomUUID(); 
                this.sessionUnsubscribe = null;
                this.topMoversCount = 10; // default number of top movers in Today bar chart
                
                // NEW PROPERTIES for tracking aggregate P/L during grouping
                this.todaysGainsTotal = 0;
                this.biggestGainToday = 0;
                this.todaysLossesTotal = 0;
                
                this.init();
            }
            init() {
                document.addEventListener('DOMContentLoaded', this.runInitialization.bind(this));
            }
            runInitialization() {
                this.loadConfig();
                try {
                    const storedState = sessionStorage.getItem('groupCollapseState');
                    this.groupCollapseState = storedState ? JSON.parse(storedState) : {};
                } catch (e) {
                    console.error("Could not parse group collapse state from sessionStorage", e);
                    this.groupCollapseState = {};
                }
                this.apiService = new ApiService(this.config);
                this.cacheDOMElements();
                this.setupEventListeners();
                this.applyTheme();
                this.applyPrivacyMode();
                if (!db) {
                     this.showError("Firebase is not configured. Please add your firebaseConfig object to the script tag.");
                    if(this.elements.loginContainer) this.elements.loginContainer.style.display = 'block';
                    return;
                }
                this.handleAuthentication();
            }
            formatCurrency(num) {
                if (typeof num !== 'number') return num;
                return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
            }
            formatNumber(num, decimals = 2) {
                if (typeof num !== 'number') return num;
                return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
            }
            handleAuthentication() {
                 onAuthStateChanged(auth, user => {
                    if (user) {
                        this.userId = user.uid;
                        if(this.elements.loginContainer) this.elements.loginContainer.style.display = 'none';
                        if(this.elements.appContainer) this.elements.appContainer.style.display = 'block';
                        if(this.elements.userInfo) this.elements.userInfo.style.display = 'flex';
                        if(this.elements.userName) this.elements.userName.textContent = `Welcome, ${user.displayName || 'User'}`;
                        this.loadData();
                        this.setupSessionListener();
                        this.startLiveUpdate();
                    } else {
                        this.userId = null;
                        if(this.elements.loginContainer) this.elements.loginContainer.style.display = 'block';
                        if(this.elements.appContainer) this.elements.appContainer.style.display = 'none';
                        if(this.elements.userInfo) this.elements.userInfo.style.display = 'none';
                        this.stocks = []; this.mutualFunds = []; this.watchlist = [];
                        this.renderContent();
                        if (this.sessionUnsubscribe) {
                            this.sessionUnsubscribe();
                            this.sessionUnsubscribe = null;
                        }
                    }
                });
            }
            signIn() {
                const provider = new GoogleAuthProvider();
                signInWithPopup(auth, provider).catch(error => {
                    console.error("Google sign-in error", error);
                    const errorDiv = document.getElementById('firebase-auth-error');
                    if (error.code === 'auth/unauthorized-domain' && errorDiv) {
                        errorDiv.style.display = 'block';
                        errorDiv.innerHTML = `
                            <h4>Authentication Error: Unauthorized Domain</h4>
                            <p>This application's domain is not authorized for sign-in with your Firebase project.</p>
                            <p><b>To fix this, you must add the domain to the authorized list in your Firebase console:</b></p>
                            <ol>
                                <li>Go to the <a href="https://console.firebase.google.com/" target="_blank">Firebase Console</a> and select your project.</li>
                                <li>Navigate to <b>Authentication</b> > <b>Settings</b> tab.</li>
                                <li>Under the <b>Authorized domains</b> section, click <b>Add domain</b>.</li>
                                <li>Enter the domain where this app is hosted and click Add.</li>
                            </ol>
                        `;
                    } else {
                        this.showError("Could not sign in with Google. Please try again.");
                    }
                });
            }
            signOut() {
                signOut(auth).catch(error => console.error("Sign out error", error));
            }
            loadConfig() {
                const userFinnhubKey = localStorage.getItem('finnhubApiKey');
                const userAlphaVantageKey = localStorage.getItem('alphaVantageApiKey');
                const userFmpKey = localStorage.getItem('fmpApiKey');
                this.config = {
                    refreshIntervalMs: parseInt(localStorage.getItem('refreshIntervalMs')) || 90000,
                    finnhubApiKey: userFinnhubKey || "d316lc1r01qnu2r0opjgd316lc1r01qnu2r0opk0",
                    alphaVantageKey: userAlphaVantageKey || "0ZPH51BZ2N5O9G8Q",
                    fmpApiKey: userFmpKey || "vOqUU3gDIDYWghK8m4ZlsVQwLDnhfYMS"
                };
            }
            cacheDOMElements() {
                this.elements = {
                    loginContainer: document.getElementById('login-container'),
                    appContainer: document.getElementById('app-container'),
                    googleSignInBtn: document.getElementById('google-signin-btn'),
                    userInfo: document.getElementById('user-info'),
                    userName: document.getElementById('user-name'),
                    signOutBtn: document.getElementById('sign-out-btn'),
                    stocksGrid: document.getElementById('stocksGrid'), loadingDiv: document.getElementById('loading'), errorDiv: document.getElementById('error'), successDiv: document.getElementById('success'),
                    stockInput: document.getElementById('stockInput'), addBtn: document.getElementById('addBtn'),
                    liveUpdateBtn: document.getElementById('liveUpdateBtn'), toggleLiveUpdateBtn: document.getElementById('toggleLiveUpdateBtn'), clearAllBtn: document.getElementById('clearAllBtn'),
                    portfolioFilter: document.getElementById('portfolioFilter'), 
                    platformFilter: document.getElementById('platformFilter'),
                    portfolioSort: document.getElementById('portfolioSort'), settingsBtn: document.getElementById('settingsBtn'),
                    mutualFundInput: document.getElementById('mutualFundInput'), addFundBtn: document.getElementById('addFundBtn'),
                    watchlistInput: document.getElementById('watchlistInput'), addWatchlistBtn: document.getElementById('addWatchlistBtn'),
                    exportBtn: document.getElementById('exportBtn'), importFile: document.getElementById('importFile'),
                    portfolioSummary: document.getElementById('portfolio-summary'),
                    transactionModal: document.getElementById('transactionModal'), modalTitleAction: document.getElementById('modal-title-action'), modalSymbol: document.getElementById('modal-symbol'),
                    modalShares: document.getElementById('modal-shares'), modalPrice: document.getElementById('modal-price'), modalNote: document.getElementById('modal-note'),
                    modalDate: document.getElementById('modal-date'),
                    modalPlatform: document.getElementById('modal-platform'),
                    modalSaveBtn: document.getElementById('modal-save-btn'),
                    settingsModal: document.getElementById('settingsModal'),
                    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
                    modalFinnhubKey: document.getElementById('modal-finnhub-key'),
                    modalAlphaVantageKey: document.getElementById('modal-alpha-vantage-key'),
                    modalFmpKey: document.getElementById('modal-fmp-key'),
                    modalRefreshInterval: document.getElementById('modal-refresh-interval'),
                    modalSaveSettingsBtn: document.getElementById('modal-save-settings-btn'),
                    enablePushNotificationsBtn: document.getElementById('enable-push-notifications-btn'),
                    signOutOtherSessionsBtn: document.getElementById('sign-out-other-sessions-btn'),
                    diversificationChartContainer: document.getElementById('diversification-chart-container'),
                    diversificationChart: document.getElementById('diversificationChart'),
                    portfolioPerformanceContainer: document.getElementById('portfolio-performance-container'),
                    portfolioPerformanceChart: document.getElementById('portfolioPerformanceChart'),
                    portfolioPerformanceBarChart: document.getElementById('portfolioPerformanceBarChart'), // NEW
                    historicalChartWrapper: document.getElementById('historical-chart-wrapper'), // NEW
                    barChartWrapper: document.getElementById('bar-chart-wrapper'), // NEW
                    portfolioChartTitle: document.getElementById('portfolio-chart-title'), // NEW
                    chartCurrentValue: document.getElementById('chart-current-value'), // NEW
                    performanceChartControls: document.getElementById('performance-chart-controls'),
                    resizeObserver: new ResizeObserver(() => {
                        this.renderDiversificationChart();
                        this.renderPortfolioPerformanceChart();
                    }),
                    confirmModal: document.getElementById('confirmModal'),
                    confirmModalText: document.getElementById('confirm-modal-text'),
                    confirmModalCancelBtn: document.getElementById('confirm-modal-cancel-btn'),
                    confirmModalConfirmBtn: document.getElementById('confirm-modal-confirm-btn'),
                    countdown: document.getElementById('countdown'),
                    smallCountdown: document.getElementById('smallCountdown'),
                    smallCountdownContainer: document.getElementById('small-countdown-container'),
                    toggleDarkModeBtn: document.getElementById('toggleDarkModeBtn'),
                    togglePrivacyBtn: document.getElementById('togglePrivacyBtn'),
                    quickLookupBtn: document.getElementById('quickLookupBtn'),
                    updateAllFundsBtn: document.getElementById('updateAllFundsBtn'),
                    clearAllFundsBtn: document.getElementById('clearAllFundsBtn'),
                    updateWatchlistBtn: document.getElementById('updateWatchlistBtn'),
                    clearWatchlistBtn: document.getElementById('clearWatchlistBtn'),
                    watchlistCount: document.getElementById('watchlist-count'),
                    refreshStatusPopup: document.getElementById('refresh-status-popup'),
                    listAllBtn: document.getElementById('listAllBtn'),
                    listAllModal: document.getElementById('listAllModal'),
                    listAllContent: document.getElementById('list-all-content'),
                    closeListAllBtn: document.getElementById('closeListAllBtn'),
                    priceAlertModal: document.getElementById('priceAlertModal'),
                    alertSymbol: document.getElementById('alert-symbol'),
                    alertCondition: document.getElementById('alert-condition'),
                    alertPrice: document.getElementById('alert-price'),
                    saveAlertBtn: document.getElementById('save-alert-btn'),
                    alertNotification: document.getElementById('alert-notification'),
                    newsTab: document.getElementById('news-tab'),
                    newsArticlesContainer: document.getElementById('news-articles-container'),
                    modalDividendFields: document.getElementById('modal-dividend-fields'),
                    modalDividendAmount: document.getElementById('modal-dividend-amount'),
                    editStockModal: document.getElementById('editStockModal'),
                    closeEditStockBtn: document.getElementById('closeEditStockBtn'),
                    editStockSymbolDisplay: document.getElementById('edit-stock-symbol-display'),
                    editStockSymbol: document.getElementById('edit-stock-symbol'),
                    editStockName: document.getElementById('edit-stock-name'),
                    editStockPlatform: document.getElementById('edit-stock-platform'),
                    editStockShares: document.getElementById('edit-stock-shares'),
                    editStockCost: document.getElementById('edit-stock-cost'),
                    editStockDate: document.getElementById('edit-stock-date'),
                    saveStockEditBtn: document.getElementById('save-stock-edit-btn'),
                    viewAlertsBtn: document.getElementById('viewAlertsBtn'),
                    alertsSummaryModal: document.getElementById('alertsSummaryModal'),
                    closeAlertsSummaryBtn: document.getElementById('closeAlertsSummaryBtn'),
                    alertsSummaryContent: document.getElementById('alerts-summary-content'),
                    alertType: document.getElementById('alert-type'),
                    singlePriceInputs: document.getElementById('single-price-inputs'),
                    priceRangeInputs: document.getElementById('price-range-inputs'),
                    alertPriceLower: document.getElementById('alert-price-lower'),
                    alertPriceUpper: document.getElementById('alert-price-upper'),
                };
                if (this.elements.diversificationChartContainer) this.elements.resizeObserver.observe(this.elements.diversificationChartContainer);
                if (this.elements.portfolioPerformanceContainer) this.elements.resizeObserver.observe(this.elements.portfolioPerformanceContainer);
            }
            setupEventListeners() {
                if (this.elements.googleSignInBtn) this.elements.googleSignInBtn.addEventListener('click', () => this.signIn());
                if (this.elements.signOutBtn) this.elements.signOutBtn.addEventListener('click', () => this.signOut());
                if (this.elements.addBtn) this.elements.addBtn.addEventListener('click', () => this.addItemFromInput('stock'));
                if (this.elements.stockInput) this.elements.stockInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.addItemFromInput('stock'); });
                if (this.elements.liveUpdateBtn) this.elements.liveUpdateBtn.addEventListener('click', () => this.refreshCurrentTab());
                if (this.elements.clearAllBtn) this.elements.clearAllBtn.addEventListener('click', () => this.clearAllItems('stock'));
                if (this.elements.toggleLiveUpdateBtn) this.elements.toggleLiveUpdateBtn.addEventListener('click', () => this.toggleLiveUpdate());
                if (this.elements.exportBtn) this.elements.exportBtn.addEventListener('click', () => this.exportData());
                if (this.elements.importFile) this.elements.importFile.addEventListener('change', (e) => this.importData(e));
                if (this.elements.portfolioFilter) this.elements.portfolioFilter.addEventListener('input', () => this.renderContent());
                if (this.elements.platformFilter) this.elements.platformFilter.addEventListener('change', () => this.renderContent());
                if (this.elements.portfolioSort) this.elements.portfolioSort.addEventListener('change', () => this.renderContent());
                if (this.elements.addFundBtn) this.elements.addFundBtn.addEventListener('click', () => this.addItemFromInput('fund'));
                if (this.elements.mutualFundInput) this.elements.mutualFundInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.addItemFromInput('fund'); });
                if (this.elements.addWatchlistBtn) this.elements.addWatchlistBtn.addEventListener('click', () => this.addItemFromInput('watchlist'));
                if (this.elements.watchlistInput) this.elements.watchlistInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') this.addItemFromInput('watchlist'); });
                document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', (e) => { const tabId = e.target.getAttribute('onclick').split("'")[1].replace('window.stockTracker.',''); this.switchTab(tabId); }));
                if (this.elements.modalSaveBtn) this.elements.modalSaveBtn.addEventListener('click', () => this.saveTransaction());
                if (this.elements.settingsBtn) this.elements.settingsBtn.addEventListener('click', () => this.openSettingsModal());
                if (this.elements.closeSettingsBtn) this.elements.closeSettingsBtn.addEventListener('click', () => this.closeSettingsModal());
                if (this.elements.modalSaveSettingsBtn) this.elements.modalSaveSettingsBtn.addEventListener('click', () => this.saveSettings());
                if (this.elements.enablePushNotificationsBtn) this.elements.enablePushNotificationsBtn.addEventListener('click', () => this.enablePushNotifications());
                if (this.elements.signOutOtherSessionsBtn) this.elements.signOutOtherSessionsBtn.addEventListener('click', () => this.signOutOtherSessions());
                if (this.elements.confirmModalCancelBtn) this.elements.confirmModalCancelBtn.addEventListener('click', () => this.closeConfirmModal(true));
                if (this.elements.confirmModalConfirmBtn) this.elements.confirmModalConfirmBtn.addEventListener('click', () => this.handleConfirmAction());
                if (this.elements.listAllBtn) this.elements.listAllBtn.addEventListener('click', () => this.openListAllModal());
                if (this.elements.closeListAllBtn) this.elements.closeListAllBtn.addEventListener('click', () => this.closeListAllModal());
                if (this.elements.toggleDarkModeBtn) this.elements.toggleDarkModeBtn.addEventListener('click', () => this.toggleDarkMode());
                if (this.elements.togglePrivacyBtn) this.elements.togglePrivacyBtn.addEventListener('click', () => this.togglePrivacyMode());
                if (this.elements.saveAlertBtn) this.elements.saveAlertBtn.addEventListener('click', () => this.savePriceAlert());
                if (this.elements.updateAllFundsBtn) this.elements.updateAllFundsBtn.addEventListener('click', () => this.refreshFunds());
                if (this.elements.clearAllFundsBtn) this.elements.clearAllFundsBtn.addEventListener('click', () => this.clearAllItems('fund'));
                if (this.elements.updateWatchlistBtn) this.elements.updateWatchlistBtn.addEventListener('click', () => this.refreshWatchlist());
                if (this.elements.clearWatchlistBtn) this.elements.clearWatchlistBtn.addEventListener('click', () => this.clearAllItems('watchlist'));
                if (this.elements.closeEditStockBtn) this.elements.closeEditStockBtn.addEventListener('click', () => this.closeEditStockModal());
                if (this.elements.saveStockEditBtn) this.elements.saveStockEditBtn.addEventListener('click', () => this.saveStockDetails());
                if (this.elements.viewAlertsBtn) this.elements.viewAlertsBtn.addEventListener('click', () => this.openAlertsSummaryModal());
                if (this.elements.closeAlertsSummaryBtn) this.elements.closeAlertsSummaryBtn.addEventListener('click', () => { if(this.elements.alertsSummaryModal) this.elements.alertsSummaryModal.style.display = 'none'; });
                
                if (this.elements.alertType) {
                    this.elements.alertType.addEventListener('change', (e) => this.toggleAlertInputs(e.target.value));
                }

                if(this.elements.performanceChartControls) {
                    this.elements.performanceChartControls.addEventListener('click', (e) => {
                        if (e.target.classList.contains('chart-range-btn')) {
                            const range = e.target.dataset.range;
                            this.renderPortfolioPerformanceChart(range);
                        }
                    });
                }

                const topMoversSelect = document.getElementById('top-movers-count');
                if (topMoversSelect) {
                    const initial = parseInt(topMoversSelect.value, 10);
                    this.topMoversCount = Number.isNaN(initial) ? 10 : initial;

                    topMoversSelect.addEventListener('change', () => {
                        const selected = parseInt(topMoversSelect.value, 10);
                        this.topMoversCount = Number.isNaN(selected) ? 10 : selected;
                        this.renderTodayPerformanceBarChart();
                    });
                }

                // NEW: Event listener for clear buttons
                document.body.addEventListener('click', (e) => {
                    if (e.target.classList.contains('clear-input')) {
                        const targetInputId = e.target.dataset.target;
                        const inputElement = document.getElementById(targetInputId);
                        if (inputElement) {
                            inputElement.value = '';
                            // Manually trigger an input event to update the UI (e.g., for filters)
                            inputElement.dispatchEvent(new Event('input'));
                        }
                    }
                });

                const setupModalCloseListeners = () => {
                    const modals = [
                        { element: this.elements.listAllModal, closeFn: () => this.closeListAllModal() },
                        { element: this.elements.settingsModal, closeFn: () => this.closeSettingsModal() },
                        { element: this.elements.transactionModal, closeFn: () => this.closeTransactionModal() },
                        { element: this.elements.editStockModal, closeFn: () => this.closeEditStockModal() },
                        { element: this.elements.confirmModal, closeFn: () => this.closeConfirmModal(true) },
                        { element: this.elements.priceAlertModal, closeFn: () => this.closePriceAlertModal() },
                        { element: this.elements.alertsSummaryModal, closeFn: () => { if(this.elements.alertsSummaryModal) this.elements.alertsSummaryModal.style.display = 'none'; } }
                    ];
                    modals.forEach(({ element, closeFn }) => {
                        if (element) {
                            element.addEventListener('click', (e) => {
                                if (e.target === element) {
                                    closeFn();
                                }
                            });
                        }
                    });
                    window.addEventListener('keydown', (e) => {
                        if (e.key === 'Escape') {
                            for (let i = modals.length - 1; i >= 0; i--) {
                                const { element, closeFn } = modals[i];
                                if (element && element.style.display !== 'none') {
                                    closeFn();
                                    break;
                                }
                            }
                        }
                    });
                };
                setupModalCloseListeners();
                window.addEventListener('beforeunload', () => {
                    sessionStorage.setItem('scrollPosition', window.scrollY);
                });
                window.addEventListener('load', () => {
                    const scrollPosition = sessionStorage.getItem('scrollPosition');
                    if (scrollPosition) {
                        window.scrollTo(0, parseInt(scrollPosition));
                    }
                });
                if (this.elements.stocksGrid) this.elements.stocksGrid.addEventListener('click', (e) => this.handleCardAction(e));
            }
            saveScrollPosition() {
                this.lastScrollPosition = window.scrollY;
            }
            restoreScrollPosition() {
                if (this.lastScrollPosition !== undefined) {
                    window.scrollTo(0, this.lastScrollPosition);
                    this.lastScrollPosition = undefined;
                }
            }
            handleCardAction(event) {
                const clickedButton = event.target.closest('.transaction-btn, .edit-btn, .edit-transaction-btn, .delete-transaction-btn, .set-alert-btn, .move-to-portfolio-btn, .chart-range-btn');
                
                if (!clickedButton && event.target.closest('.stock-card, .fund-card')) {
                    const card = event.target.closest('.stock-card, .fund-card');
                    if(card) {
                        // Toggle collapse for stock/fund card
                        if(card.classList.contains('closed-position') && !event.target.closest('.transaction-header')) {
                            // Don't expand closed positions on click unless it's the transaction header
                            return;
                        }

                        card.classList.toggle('expanded');
                        if (card.classList.contains('expanded')) {
                            this.renderCardChart(card.dataset.symbol);
                        }
                    }
                    return;
                }
                
                if (!clickedButton) {
                    // Handle transaction header click
                    const transactionHeader = event.target.closest('.transaction-header');
                    if (transactionHeader) {
                        const container = transactionHeader.nextElementSibling;
                        if (container) {
                            container.classList.toggle('collapsed');
                            transactionHeader.classList.toggle('collapsed');
                            const toggleIcon = transactionHeader.querySelector('.toggle-icon');
                            if(toggleIcon) toggleIcon.style.transform = container.classList.contains('collapsed') ? 'rotate(0deg)' : 'rotate(90deg)';
                        }
                    }
                    return;
                }
                
                if (clickedButton.classList.contains('chart-range-btn') && clickedButton.closest('#portfolio-performance-container')) {
                    // Clicks on main chart buttons are handled by the separate listener in setupEventListeners
                    return;
                }

                const card = clickedButton.closest('.stock-card, .fund-card, .watchlist-card');
                if (!card) return;
                
                const id = card.dataset.id;
                const type = card.dataset.type;
                const symbol = card.dataset.symbol;

                if (clickedButton.classList.contains('chart-range-btn')) {
                    event.preventDefault();
                    event.stopPropagation();
                    const range = clickedButton.dataset.range;
                    this.renderCardChart(symbol, range);
                    return;
                }

                if (!id || !type) return;

                event.preventDefault();
                event.stopPropagation();
                
                if (clickedButton.classList.contains('edit-transaction-btn')) {
                    const transactionIndex = parseInt(clickedButton.dataset.index);
                    this.openEditTransactionModal(id, type, transactionIndex);
                    return;
                }
                if (clickedButton.classList.contains('delete-transaction-btn')) {
                    const transactionIndex = parseInt(clickedButton.dataset.index);
                    this.removeTransaction(id, transactionIndex, type);
                    return;
                }

                const item = this.stocks.find(s => s.id === id) || this.mutualFunds.find(f => f.id === id) || this.watchlist.find(w => w.id === id);
                if (!item) return;

                if (clickedButton.classList.contains('buy-btn')) {
                    this.openTransactionModal(id, type, 'buy');
                } else if (clickedButton.classList.contains('sell-btn')) {
                    this.openTransactionModal(id, type, 'sell');
                } else if (clickedButton.classList.contains('edit-btn')) {
                    this.openEditStockModal(id); // Re-enabled Edit Button
                } else if (clickedButton.classList.contains('set-alert-btn')) {
                    this.openPriceAlertModal(item.symbol);
                } else if (clickedButton.classList.contains('move-to-portfolio-btn')) {
                    this.moveToPortfolio(id);
                }
            }
            switchTab(tab) {
                this.saveScrollPosition();
                this.currentTab = tab;
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
                const tabButton = document.querySelector(`[onclick="window.stockTracker.switchTab('${tab}')"]`);
                if(tabButton) tabButton.classList.add('active');
                const tabContent = document.getElementById(`${tab}-tab`);
                if(tabContent) tabContent.classList.add('active');

                // FIX: Explicitly control visibility of non-news content containers
                if (tab === 'news') {
                    // News tab is active
                    if (this.elements.stocksGrid) {
                        this.elements.stocksGrid.innerHTML = ''; // Clear content
                        this.elements.stocksGrid.style.display = 'grid'; // Keep grid display, but empty for news tab
                    }
                    if (this.elements.portfolioSummary) this.elements.portfolioSummary.style.display = 'none';
                    if (this.elements.portfolioPerformanceContainer) this.elements.portfolioPerformanceContainer.style.display = 'none';
                    if (this.elements.diversificationChartContainer) this.elements.diversificationChartContainer.style.display = 'none';
                    this.fetchAndRenderNews();
                    return;
                } else {
                    // Portfolio, Funds, Watchlist tabs are active
                    if (this.elements.stocksGrid) this.elements.stocksGrid.style.display = 'grid';
                }
                
                this.renderContent();
            }

            sortItems(items, sortBy) {
                switch (sortBy) {
                    case 'performance':
                        return items.sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));

                    case 'alphabetical':
                        return items.sort((a, b) => a.symbol.localeCompare(b.symbol));

                    case 'value':
                        return items.sort((a, b) => {
                            const valueA = this.calculateTransactionStats(a.transactions, a.price).currentValue;
                            const valueB = this.calculateTransactionStats(b.transactions, b.price).currentValue;
                            return valueB - valueA;
                        });

                    case 'pl_overall':
                        return items.sort((a, b) => {
                            const statsA = this.calculateTransactionStats(a.transactions, a.price);
                            const statsB = this.calculateTransactionStats(b.transactions, a.price);
                            const totalPlA = statsA.unrealizedPL + statsA.realizedPL;
                            const totalPlB = statsB.unrealizedPL + statsB.realizedPL;
                            return totalPlB - totalPlA;
                        });

                    case 'platform':
                        // This case is handled by grouping, but we'll sort within groups by performance.
                        return items.sort((a, b) => (b.changePercent || 0) - (a.changePercent || 0));


                    default:
                        return items;
                }
            }
            
            renderContent() {
                if (!this.userId && db) return;
                this.saveScrollPosition();
                const grid = this.elements.stocksGrid;
                if (!grid) return;
                grid.innerHTML = '';
                if(this.elements.portfolioSummary) this.elements.portfolioSummary.style.display = 'none';
                let items, type;
                if (this.currentTab === 'stocks') { 
                    [items, type] = [this.stocks, 'stock']; 
                    if(this.elements.portfolioSummary) this.elements.portfolioSummary.style.display = 'block';
                }
                else if (this.currentTab === 'funds') { 
                    [items, type] = [this.mutualFunds, 'fund']; 
                    if(this.elements.portfolioSummary) this.elements.portfolioSummary.style.display = 'block'; // Also show for funds
                }
                else if (this.currentTab === 'watchlist') {
                     [items, type] = [this.watchlist, 'watchlist'];
                     if(this.elements.watchlistCount) this.elements.watchlistCount.textContent = `(${this.watchlist.length})`;
                } else if (this.currentTab === 'news') {
                    // This block should ideally not be reached if switchTab worked, but keeping as safeguard
                    this.fetchAndRenderNews();
                    return; 
                }
                
                this.renderPortfolioSummary(); // Always render the combined summary

                const sortBy = this.elements.portfolioSort ? this.elements.portfolioSort.value : 'performance';
                let filteredItems = items;

                if (this.currentTab === 'stocks' || this.currentTab === 'funds') {
                    if (sortBy === 'platform') {
                        if(this.elements.portfolioFilter) this.elements.portfolioFilter.style.display = 'none';
                        if(this.elements.platformFilter) this.elements.platformFilter.style.display = 'block';

                        const allItems = [...this.stocks, ...this.mutualFunds];
                        const platforms = ['All Platforms', ...new Set(allItems.flatMap(s => s.transactions.map(t => t.platform)).filter(p => p))].sort();
                        const currentSelection = this.elements.platformFilter ? this.elements.platformFilter.value : 'All Platforms';
                        if (this.elements.platformFilter) {
                            this.elements.platformFilter.innerHTML = platforms.map(p => `<option value="${p}">${p}</option>`).join('');
                            if (platforms.includes(currentSelection)) {
                                this.elements.platformFilter.value = currentSelection;
                            }
                        }

                        const platformFilterTerm = this.elements.platformFilter ? this.elements.platformFilter.value : 'All Platforms';
                        if (platformFilterTerm && platformFilterTerm !== 'All Platforms') {
                            const virtualItems = [];
                            items.forEach(stock => {
                                const filteredTransactions = stock.transactions.filter(t => t.platform === platformFilterTerm);
                                if (filteredTransactions.length > 0) {
                                    virtualItems.push({ ...stock, transactions: filteredTransactions });
                                }
                            });
                            filteredItems = virtualItems;
                        }
                    } else {
                        if(this.elements.portfolioFilter) this.elements.portfolioFilter.style.display = 'block';
                        if(this.elements.platformFilter) this.elements.platformFilter.style.display = 'none';
                        const filterTerm = this.elements.portfolioFilter ? this.elements.portfolioFilter.value.toLowerCase() : '';
                        if (filterTerm) {
                            filteredItems = items.filter(item =>
                                item.symbol.toLowerCase().includes(filterTerm) ||
                                (item.name && item.name.toLowerCase().includes(filterTerm))
                            );
                        }
                    }
                }

                const sortedItems = this.sortItems([...filteredItems], sortBy);
                
                // Reset P/L totals before rendering groups
                this.todaysGainsTotal = 0;
                this.biggestGainToday = 0;
                this.todaysLossesTotal = 0;

                if (type === 'stock' || type === 'fund') {
                    const isGrouping = sortBy === 'platform' && (this.elements.platformFilter ? this.elements.platformFilter.value : 'All Platforms') === 'All Platforms';
                    if (isGrouping) {
                        this.renderGroupedByPlatform(sortedItems, grid, type);
                    } else if (sortBy === 'performance') {
                        this.renderGroupedStocks(sortedItems, grid, type);
                    } else {
                        this.renderCards(sortedItems, grid, type);
                    }
                } else if (type === 'watchlist') {
                    this.renderCards(sortedItems, grid, type);
                }

                this.renderDiversificationChart();
                // FIX: Update to call the render function without arguments to ensure default state (1Y Historical) is maintained
                this.renderPortfolioPerformanceChart(); 
                if (sortedItems.length === 0 && type !== 'stock' && type !== 'fund' && grid) {
                     grid.innerHTML = `<div class="loading" style="grid-column: 1 / -1;">Your ${type} list is empty.</div>`;
                }
                this.restoreScrollPosition();
            }

            async saveData() {
                if (!this.userId) return;
                const userDocRef = doc(db, "users", this.userId);
                const data = {
                    stocks: this.stocks, mutualFunds: this.mutualFunds, watchlist: this.watchlist,
                    portfolioHistory: this.portfolioHistory, priceAlerts: this.priceAlerts,
                };
                await setDoc(userDocRef, data);
            }
            async loadData() {
                if (!this.userId) return;
                const userDocRef = doc(db, "users", this.userId);
                const docSnap = await getDoc(userDocRef);
                
                let migrationNeeded = false;
                const ensureIdAndMigratePlatform = (item) => {
                    if (!item.id) {
                        item.id = Date.now().toString() + Math.random().toString(36).substring(2, 9);
                        migrationNeeded = true;
                    }
                    if (item.platform && item.transactions && item.transactions.some(t => !t.platform)) {
                        item.transactions.forEach(t => {
                            if (!t.platform) {
                                t.platform = item.platform;
                            }
                        });
                        delete item.platform;
                        migrationNeeded = true;
                    }
                     if (!item.transactions) { // Ensure funds have transactions array
                        item.transactions = [];
                        migrationNeeded = true;
                    }
                    if (!item.dividends) { // Ensure funds have dividends array
                        item.dividends = [];
                        migrationNeeded = true;
                    }
                    return item;
                };

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    this.stocks = (data.stocks || []).map(ensureIdAndMigratePlatform);
                    this.mutualFunds = (data.mutualFunds || []).map(ensureIdAndMigratePlatform);
                    this.watchlist = (data.watchlist || []).map(item => item.id ? item : {...item, id: Date.now().toString() + Math.random().toString(36).substring(2, 9)});
                    this.portfolioHistory = data.portfolioHistory || [];

                    // FIX: Generate placeholder history if none exists for a smoother demo.
                    if (this.portfolioHistory.length === 0) {
                         const today = new Date();
                         for (let i = 365; i >= 0; i--) {
                            const date = new Date(today);
                            date.setDate(today.getDate() - i);
                            // Simple placeholder value that slightly increases over time
                            const value = 50000 + Math.sin(i / 30) * 500 + i * 2; 
                            this.portfolioHistory.push({ date: date.toISOString().slice(0, 10), value: Math.round(value) });
                         }
                         migrationNeeded = true;
                    }

                    this.priceAlerts = data.priceAlerts || [];

                    if (migrationNeeded) {
                        console.log("Data migration performed. Saving updated structure.");
                        await this.saveData();
                    }
                }
                this.updatePortfolioHistory();
                this.renderContent();
            }
            startLiveUpdate() {
                this.stopLiveUpdate();
                this.refreshIntervalId = setInterval(() => {
                    if (this.isLiveUpdatePaused) return;
                    this.refreshCurrentTab(true);
                    this.checkPriceAlerts();
                }, this.config.refreshIntervalMs);
                this.isLiveUpdatePaused = false;
                if(this.elements.toggleLiveUpdateBtn) this.elements.toggleLiveUpdateBtn.textContent = '⏸️ Pause Live Update';
                this.startCountdown();
            }
            async refreshCurrentTab(isAutoRefresh = false) {
                if (isAutoRefresh) {
                    this.saveScrollPosition();
                }
                const tabActions = {
                    stocks: () => this.refreshStocks(),
                    funds: () => this.refreshFunds(),
                    watchlist: () => this.refreshWatchlist()
                };
                if (tabActions[this.currentTab]) await tabActions[this.currentTab]();
                if (isAutoRefresh) {
                    this.restoreScrollPosition();
                }
            }
            startCountdown() {
                if(this.elements.smallCountdownContainer) this.elements.smallCountdownContainer.innerHTML = `Next update: <span id="smallCountdown">${this.config.refreshIntervalMs / 1000}s</span>`;
                this.elements.smallCountdown = document.getElementById('smallCountdown');
                let timeLeft = this.config.refreshIntervalMs / 1000;
                if(this.countdownIntervalId) clearInterval(this.countdownIntervalId);
                const updateTimers = () => {
                    if (timeLeft >= 0) {
                        if(this.elements.countdown) this.elements.countdown.textContent = timeLeft;
                        if(this.elements.smallCountdown) this.elements.smallCountdown.textContent = `${timeLeft}s`;
                        timeLeft--;
                    } else {
                        timeLeft = this.config.refreshIntervalMs / 1000;
                    }
                };
                updateTimers();
                this.countdownIntervalId = setInterval(updateTimers, 1000);
            }
            stopLiveUpdate() {
                 clearInterval(this.refreshIntervalId);
                clearInterval(this.countdownIntervalId);
                this.isLiveUpdatePaused = true;
                if(this.elements.toggleLiveUpdateBtn) this.elements.toggleLiveUpdateBtn.textContent = '▶️ Resume Live Update';
                 if(this.elements.smallCountdownContainer) this.elements.smallCountdownContainer.textContent = 'Updates Paused';
            }
            toggleLiveUpdate() { this.isLiveUpdatePaused ? this.startLiveUpdate() : this.stopLiveUpdate(); }
            async refreshStocks() { await this.refreshItems(this.stocks, 'stock'); }
            async refreshFunds() { await this.refreshItems(this.mutualFunds, 'fund'); }
            async refreshWatchlist() { await this.refreshItems(this.watchlist, 'watchlist'); }
            async refreshItems(items, type) {
                if (items.length === 0) return;
                this.showLoading(true, `Refreshing 0/${items.length} items...`);
                let stats = { success: 0, gains: 0, losses: 0, unchanged: 0, failed: 0 };
                let failedSymbols = [];
                for (const [i, item] of items.entries()) {
                    let result;
                    if (type === 'fund') {
                        result = await this.apiService.fetchMutualFundDataWithFallback(item.symbol);
                    } else { // stock or watchlist
                        result = await this.apiService.fetchStockEtfQuote(item.symbol);
                    }
                    
                    if (result.success) {
                        Object.assign(item, result.data);
                        stats.success++;
                        if ((result.data.change || 0) > 0) stats.gains++;
                        else if ((result.data.change || 0) < 0) stats.losses++;
                        else stats.unchanged++;
                    } else {
                        stats.failed++;
                        failedSymbols.push(item.symbol);
                        console.error(`Failed to refresh ${item.symbol}:`, result.reason);
                    }
                    this.showLoading(true, `Refreshing ${item.symbol}... (${i + 1}/${items.length})`);
                }
                this.showLoading(false);
                this.showRefreshStatus(type, stats);
                await this.saveData();
                this.renderContent();
            }
            
            calculateSummaryMetrics(items) {
                let totalCurrentValue = 0, totalUnrealizedPL = 0, totalRealizedPL = 0, totalPLToday = 0, totalPreviousDayValue = 0, totalContributions = 0, totalDividends = 0;
                items.forEach(item => {
                    const stats = this.calculateTransactionStats(item.transactions, item.price);
                    totalRealizedPL += stats.realizedPL;
                    
                    if (stats.totalSharesOwned > 0) {
                        totalCurrentValue += stats.currentValue;
                        totalUnrealizedPL += stats.unrealizedPL;
                        
                        // FIX: Ensure totalPLToday is a clean calculation based on item change
                        const dailyChange = (item.change || 0) * stats.totalSharesOwned;
                        if (!isNaN(dailyChange) && isFinite(dailyChange)) {
                            totalPLToday += dailyChange;
                        }

                        // Calculate previous day value for percentage calculation
                        const previousDayPrice = item.price - (item.change || 0);
                        totalPreviousDayValue += previousDayPrice * stats.totalSharesOwned;
                    }
                    
                    totalContributions += (item.transactions || []).reduce((sum, t) => sum + (t.type === 'buy' ? t.shares * t.price : -t.shares * t.price), 0);
                    totalDividends += (item.dividends || []).reduce((divSum, div) => divSum + div.totalAmount, 0);
                });
                return { totalCurrentValue, totalUnrealizedPL, totalRealizedPL, totalPLToday, totalPreviousDayValue, totalContributions, totalDividends };
            }

            renderPortfolioSummary() {
                // Get metric sums from individual lists (stocks/funds)
                const stockMetrics = this.calculateSummaryMetrics(this.stocks);
                const fundMetrics = this.calculateSummaryMetrics(this.mutualFunds);

                const combinedMetrics = {
                    totalCurrentValue: stockMetrics.totalCurrentValue + fundMetrics.totalCurrentValue,
                    totalUnrealizedPL: stockMetrics.totalUnrealizedPL + fundMetrics.totalUnrealizedPL,
                    totalRealizedPL: stockMetrics.totalRealizedPL + fundMetrics.totalRealizedPL,
                    totalPLToday: stockMetrics.totalPLToday + fundMetrics.totalPLToday, // Base total P/L
                    totalPreviousDayValue: stockMetrics.totalPreviousDayValue + fundMetrics.totalPreviousDayValue,
                    totalContributions: stockMetrics.totalContributions + fundMetrics.totalContributions,
                    totalDividends: stockMetrics.totalDividends + fundMetrics.totalDividends
                };

                // FIX: Use the calculated group totals for display consistency and accuracy
                const aggregatedPLToday = 
                    (this.biggestGainToday || 0) +
                    (this.todaysGainsTotal || 0) -
                    (this.todaysLossesTotal || 0); // Explicitly subtract the positive loss amount

                // Prefer the group-based total if it's non-zero (meaning groups were rendered and totals were updated), otherwise fall back to the direct item sum.
                const totalPLTodayFinal = (aggregatedPLToday !== 0 && !isNaN(aggregatedPLToday)) 
                    ? aggregatedPLToday 
                    : combinedMetrics.totalPLToday;

                const totalOverallPL = combinedMetrics.totalUnrealizedPL + combinedMetrics.totalRealizedPL;
                const totalOverallPLPercent = combinedMetrics.totalContributions > 0 ? (totalOverallPL / combinedMetrics.totalContributions) * 100 : 0;
                const totalPLPercentToday = combinedMetrics.totalPreviousDayValue > 0 ? (totalPLTodayFinal / combinedMetrics.totalPreviousDayValue) * 100 : 0;

                const setElement = (el, value, isPercent = false) => {
                    if (!el) return;
                    el.textContent = isPercent ? `${this.formatNumber(value, 2)}%` : this.formatCurrency(value);
                    el.className = `summary-value ${value >= 0 ? 'positive' : 'negative'}`;
                };
                
                // 💰 Update all summary labels
                setElement(document.getElementById('combined-total-value'), combinedMetrics.totalCurrentValue);
                setElement(document.getElementById('stocks-total-value'), stockMetrics.totalCurrentValue);
                setElement(document.getElementById('mutual-fund-total-value'), fundMetrics.totalCurrentValue);
                
                const contributionsEl = document.getElementById('total-contributions');
                if (contributionsEl) contributionsEl.textContent = this.formatCurrency(combinedMetrics.totalContributions);

                setElement(document.getElementById('total-dividends'), combinedMetrics.totalDividends);
                setElement(document.getElementById('total-pl-today'), totalPLTodayFinal); // Use final calculated value
                setElement(document.getElementById('total-pl-percent-today'), totalPLPercentToday, true);
                setElement(document.getElementById('total-pl-unrealized'), combinedMetrics.totalUnrealizedPL);
                setElement(document.getElementById('total-pl-realized'), combinedMetrics.totalRealizedPL);
                
                // Update the big chart value
                const chartValueEl = document.getElementById('chart-current-value');
                if (chartValueEl) {
                    chartValueEl.textContent = this.formatCurrency(combinedMetrics.totalCurrentValue);
                    // Also update its color based on today's P/L
                    chartValueEl.classList.remove('positive', 'negative');
                    chartValueEl.classList.add(totalPLTodayFinal >= 0 ? 'positive' : 'negative');
                }
            }

            isMutualFund(symbol) { return symbol.length === 5 && symbol.endsWith('X'); }
            async addItemFromInput(type) {
                const isStock = type === 'stock';
                const input = isStock ? this.elements.stockInput : (type === 'fund' ? this.elements.mutualFundInput : this.elements.watchlistInput);
                const symbol = input ? input.value.trim().toUpperCase() : '';
                if (!symbol) return;
                if (input) input.value = '';
                await this.addItem(symbol, type);
            }
            async addItem(symbol, type) {
                this.showLoading(true, `Adding ${symbol}...`);
                try {
                    let targetList, listName;
                    if (type === 'stock') { [targetList, listName] = [this.stocks, 'portfolio']; }
                    else if (type === 'fund') { [targetList, listName] = [this.mutualFunds, 'fund portfolio']; }
                    else { [targetList, listName] = [this.watchlist, 'watchlist']; }
                    
                    let result;
                    if (type === 'fund') {
                        result = await this.apiService.fetchMutualFundDataWithFallback(symbol);
                    } else {
                        result = await this.apiService.fetchStockEtfData(symbol);
                    }
                    
                    if (!result.success) throw new Error(result.reason);
                    
                    let newItem = { 
                        ...result.data,
                        id: Date.now().toString() + Math.random().toString(36).substring(2, 9) 
                    };

                    if (type !== 'watchlist') {
                        newItem.transactions = [];
                        newItem.dividends = [];
                    }
                    targetList.push(newItem);

                    await this.saveData();
                    this.renderContent();
                    this.showSuccess(`✅ Added ${symbol} to your ${listName}!`);
                } catch (error) {
                    this.showError(`❌ Failed to add ${symbol}. Reason: ${error.message}`);
                } finally {
                    this.showLoading(false);
                }
            }
            removeItem(id, type) {
                this.openConfirmModal(`Are you sure you want to remove this item?`, async () => {
                     if (type === 'stock') { this.stocks = this.stocks.filter(item => item.id !== id); }
                     else if (type === 'fund') { this.mutualFunds = this.mutualFunds.filter(item => item.id !== id); }
                     else if (type === 'watchlist') { this.watchlist = this.watchlist.filter(item => item.id !== id); }
                    await this.saveData();
                    this.renderContent();
                });
            }
            clearAllItems(type) {
                this.openConfirmModal(`Are you sure you want to clear all ${type}s? This cannot be undone.`, async () => {
                    if (type === 'stock') this.stocks = [];
                    else if (type === 'fund') this.mutualFunds = [];
                    else if (type === 'watchlist') this.watchlist = [];
                    await this.saveData();
                    this.renderContent();
                });
            }
            calculateTransactionStats(transactions = [], currentPrice = 0) {
                const buys = JSON.parse(JSON.stringify((transactions || []).filter(t => t.type === 'buy').sort((a,b) => new Date(a.date) - new Date(b.date))));
                const sells = JSON.parse(JSON.stringify((transactions || []).filter(t => t.type === 'sell')));
                let totalSharesOwned = buys.reduce((s, t) => s + t.shares, 0) - sells.reduce((s, t) => s + t.shares, 0);
                let realizedPL = 0;
                for (const sell of sells) {
                    let sharesToSell = sell.shares, saleProceeds = sharesToSell * sell.price, costOfSoldShares = 0;
                    for (let buy of buys) {
                        if (buy.shares > 0 && sharesToSell > 0) {
                            let sharesFromThisLot = Math.min(sharesToSell, buy.shares);
                            costOfSoldShares += sharesFromThisLot * buy.price;
                            buy.shares -= sharesFromThisLot;
                            sharesToSell -= sharesFromThisLot;
                        }
                    }
                    realizedPL += saleProceeds - costOfSoldShares;
                }
                let costOfRemainingShares = buys.reduce((s, t) => s + (t.shares * t.price), 0);
                let averageCostBasis = totalSharesOwned > 0 ? costOfRemainingShares / totalSharesOwned : 0;
                let currentValue = totalSharesOwned * currentPrice;
                let unrealizedPL = totalSharesOwned > 0 ? currentValue - costOfRemainingShares : 0;
                return { totalSharesOwned, averageCostBasis, realizedPL, unrealizedPL, currentValue, costOfRemainingShares };
            }

            calculateAnnualizedDividendYield(item) {
                 if (!item.dividends || item.dividends.length === 0 || item.price === 0) return 0;
                 const now = new Date(), lastYear = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
                 const totalDividendsLastYear = item.dividends.filter(d => new Date(d.date) > lastYear).reduce((sum, d) => sum + d.totalAmount, 0);
                 return totalDividendsLastYear > 0 ? (totalDividendsLastYear / item.price) * 100 : 0;
            }
            openEditTransactionModal(id, type, index) {
                const itemList = (type === 'stock') ? this.stocks : this.mutualFunds;
                const item = itemList.find(i => i.id === id);
                if (!item || !item.transactions || index < 0 || index >= item.transactions.length) return;
                const transaction = item.transactions[index];
                this.openTransactionModal(id, type, transaction.type, index);
                if(this.elements.modalShares) this.elements.modalShares.value = transaction.shares;
                if(this.elements.modalPrice) this.elements.modalPrice.value = transaction.price;
                if(this.elements.modalPlatform) this.elements.modalPlatform.value = transaction.platform || '';
                if(this.elements.modalNote) this.elements.modalNote.value = transaction.note || '';
                if(this.elements.modalDate) this.elements.modalDate.value = transaction.date ? transaction.date.split('T')[0] : '';
            }
            openTransactionModal(id, type, transactionType, transactionIndex = -1) {
                const modal = this.elements.transactionModal;
                const itemList = (type === 'stock') ? this.stocks : this.mutualFunds;
                const item = itemList.find(i => i.id === id);
                if (!modal || !item) {
                    this.showError("Could not open transaction modal.");
                    return;
                }
                modal.style.display = 'flex';
                if(this.elements.modalSymbol) this.elements.modalSymbol.textContent = item.symbol;
                if(this.elements.modalTitleAction) this.elements.modalTitleAction.textContent = transactionIndex > -1 ? 'Edit' : transactionType.charAt(0).toUpperCase() + transactionType.slice(1);
                ['modalShares', 'modalPrice', 'modalNote', 'modalPlatform', 'modalDividendAmount'].forEach(elId => {
                     if(this.elements[elId]) this.elements[elId].value = '';
                 });
                if (transactionIndex === -1 && this.elements.modalDate) {
                    this.elements.modalDate.value = new Date().toISOString().split('T')[0];
                }
                
                const allItems = [...this.stocks, ...this.mutualFunds];
                const predefinedPlatforms = ['Fidelity', 'Robinhood', 'Vanguard', 'Charles Schwab', 'E*TRADE', 'Merrill Edge', 'Uncategorized'];
                const existingPlatforms = [...new Set(allItems.flatMap(s => s.transactions.map(t => t.platform)).filter(p => p))].sort();
                const allPlatforms = [...new Set([...predefinedPlatforms, ...existingPlatforms])].sort();
                const platformSelect = this.elements.modalPlatform;
                if(platformSelect) {
                    platformSelect.innerHTML = `<option value="">Select...</option>`;
                    allPlatforms.forEach(p => {
                        platformSelect.innerHTML += `<option value="${p}">${p}</option>`;
                    });
                    platformSelect.innerHTML += `<option value="add_new">++ Add New Platform...</option>`;
                    
                    if (transactionIndex > -1) {
                        const transaction = item.transactions[transactionIndex];
                        platformSelect.value = transaction.platform || "";
                    }
                }

                if(this.elements.modalDividendFields) this.elements.modalDividendFields.style.display = 'none';
                if(this.elements.modalShares) this.elements.modalShares.parentNode.style.display = 'block';
                if(this.elements.modalPrice) this.elements.modalPrice.parentNode.style.display = 'block';
                if(this.elements.modalPlatform) this.elements.modalPlatform.parentNode.style.display = 'block';

                if (transactionType === 'dividend') {
                    if(this.elements.modalPrice) this.elements.modalPrice.parentNode.style.display = 'none';
                    if(this.elements.modalPlatform) this.elements.modalPlatform.parentNode.style.display = 'none';
                    if(this.elements.modalShares) this.elements.modalShares.parentNode.style.display = 'none';
                    if(this.elements.modalDividendFields) this.elements.modalDividendFields.style.display = 'block';
                    if(this.elements.modalTitleAction) this.elements.modalTitleAction.textContent = transactionIndex > -1 ? 'Edit Dividend' : 'Record Dividend';
                }

                if(this.elements.modalSaveBtn) Object.assign(this.elements.modalSaveBtn.dataset, { id, type, transactionType, transactionIndex });
            }
            closeTransactionModal() { if(this.elements.transactionModal) this.elements.transactionModal.style.display = 'none'; }
            
            async saveTransaction() {
                const { id, type, transactionType, transactionIndex: indexStr } = this.elements.modalSaveBtn ? this.elements.modalSaveBtn.dataset : {};
                if (!id || !type) return;

                const index = parseInt(indexStr);
                const isEditing = index > -1;
                const itemList = (type === 'stock') ? this.stocks : this.mutualFunds;
                const item = itemList.find(i => i.id === id);
                if (!item) return;
        
                const dateInput = this.elements.modalDate ? this.elements.modalDate.value : '';
                if (!dateInput) { this.showError('Transaction date is required.'); return; }
                const transactionDateISO = new Date(dateInput).toISOString();
        
                if (transactionType === 'buy' || transactionType === 'sell') {
                    const shares = parseFloat(this.elements.modalShares ? this.elements.modalShares.value : 0);
                    const price = parseFloat(this.elements.modalPrice ? this.elements.modalPrice.value : 0);
                    let platform = this.elements.modalPlatform ? this.elements.modalPlatform.value : '';

                    if (platform === 'add_new') {
                        const customPlatform = prompt("Please enter the new platform name:");
                        if (customPlatform && customPlatform.trim() !== '') {
                            platform = customPlatform.trim();
                        } else {
                            return; // User cancelled or entered nothing
                        }
                    }

                    if (isNaN(shares) || shares <= 0 || isNaN(price) || price < 0) {
                        this.showError('Invalid input. Shares must be positive and Price must be non-negative.');
                        return;
                    }
        
                    if (transactionType === 'sell') {
                        const tempTransactions = isEditing ? item.transactions.filter((_, i) => i !== index) : (item.transactions || []);
                        const currentStats = this.calculateTransactionStats(tempTransactions, item.price);
                        if (shares > currentStats.totalSharesOwned) {
                            this.showError(`Cannot sell ${this.formatNumber(shares)} shares. You only own ${this.formatNumber(currentStats.totalSharesOwned)} of ${item.symbol}.`);
                            return;
                        }
                    }
        
                    if (!item.transactions) item.transactions = [];
                    const newTransaction = {
                        type: transactionType,
                        shares, price, platform,
                        note: this.elements.modalNote ? this.elements.modalNote.value.trim() : '',
                        date: transactionDateISO
                    };
        
                    if (isEditing) {
                        item.transactions[index] = newTransaction;
                    } else {
                        item.transactions.push(newTransaction);
                    }

                } else if (transactionType === 'dividend') {
                    const amountPerShare = parseFloat(this.elements.modalDividendAmount ? this.elements.modalDividendAmount.value : 0);
                    const totalSharesOwned = this.calculateTransactionStats(item.transactions, item.price).totalSharesOwned;

                    if (isNaN(amountPerShare) || amountPerShare < 0) {
                        this.showError('Invalid dividend amount. Amount per share must be non-negative.');
                        return;
                    }

                    if (!item.dividends) item.dividends = [];
                    
                    const newDividend = {
                        amountPerShare: amountPerShare,
                        totalAmount: totalSharesOwned * amountPerShare,
                        shares: totalSharesOwned,
                        note: this.elements.modalNote ? this.elements.modalNote.value.trim() : '',
                        date: transactionDateISO
                    };

                    if (isEditing) {
                        item.dividends[index] = newDividend;
                    } else {
                        item.dividends.push(newDividend);
                    }
                }
        
                await this.saveData();
                this.renderContent();
                this.closeTransactionModal();
                this.showSuccess(`✅ ${isEditing ? 'Updated' : 'Saved'} ${transactionType.toUpperCase()} transaction for ${item.symbol}!`);
            }
            
            removeTransaction(id, index, type) {
                 this.openConfirmModal('Delete this transaction?', async () => {
                     const itemList = (type === 'stock') ? this.stocks : this.mutualFunds;
                     const item = itemList.find(i => i.id === id);
                    if (item) {
                        if (item.transactions && index >= 0 && index < item.transactions.length) {
                            item.transactions.splice(index, 1);
                            this.showSuccess(`🗑️ Deleted transaction for ${item.symbol}.`);
                        } else {
                             this.showError(`Error: Transaction index ${index} not found for ${item.symbol}.`);
                        }
                        await this.saveData();
                        this.renderContent();
                    }
                });
            }

            removeDividend(id, index, type) {
                this.openConfirmModal('Delete this dividend entry?', async () => {
                    const itemList = (type === 'stock') ? this.stocks : this.mutualFunds;
                    const item = itemList.find(i => i.id === id);
                    if (item && item.dividends && index >= 0 && index < item.dividends.length) {
                        item.dividends.splice(index, 1);
                        this.showSuccess(`🗑️ Deleted dividend for ${item.symbol}.`);
                        await this.saveData();
                        this.renderContent();
                    } else {
                         this.showError(`Error: Dividend index ${index} not found for ${item.symbol}.`);
                    }
                });
            }

            renderGroupedStocks(items, container, type) {
                // 1. Separate items into Active (shares > 0 or data mismatch) and Closed (shares = 0 and has transactions)
                const activeItems = [];
                const closedPositions = [];
                const dataMismatch = [];

                items.forEach(item => {
                    const stats = this.calculateTransactionStats(item.transactions, item.price);
                    const sharesOwned = stats.totalSharesOwned;
                    const hasTransactions = (item.transactions || []).length > 0;
                    
                    if (sharesOwned > 0.0001) {
                        activeItems.push(item);
                    } else if (hasTransactions && sharesOwned < 0.0001) {
                        // Sold off position (has history but no active shares)
                        closedPositions.push(item);
                    } else if (item.symbol && sharesOwned < 0.0001 && !hasTransactions) {
                         // Added stock but no transactions logged yet
                        dataMismatch.push(item);
                    }
                });
                
                // 2. Performance Grouping for ACTIVE Items only
                const gains = activeItems.filter(s => (s.changePercent || 0) >= 0).sort((a, b) => b.changePercent - a.changePercent);
                const losses = activeItems.filter(s => (s.changePercent || 0) < 0).sort((a, b) => a.changePercent - b.changePercent);
                
                if (activeItems.length === 0 && closedPositions.length === 0 && dataMismatch.length === 0) { 
                    if (container.classList.contains('group-content')) return;
                    container.innerHTML = `<div class="loading" style="grid-column: 1 / -1;">Your portfolio is empty.</div>`; 
                    return; 
                }

                // 3. Performance Grouping for ACTIVE Items
                const biggestGain = gains.length > 0 ? [gains[0]] : [];
                
                // Reset/Calculate the running P/L totals based on groups being built
                this.todaysGainsTotal = 0;
                this.biggestGainToday = 0;
                this.todaysLossesTotal = 0;
                
                if (biggestGain.length > 0) {
                    const stats = this.calculateTransactionStats(biggestGain[0].transactions, biggestGain[0].price);
                    this.biggestGainToday = (biggestGain[0].change || 0) * stats.totalSharesOwned;
                    this.createGroup('🚀 Biggest Gain Today', biggestGain, 'biggest-gain-header', container, type, this.getGroupSummary(biggestGain, 'biggest-gain'));
                }
                
                const otherGains = gains.filter(s => biggestGain.length === 0 || s.id !== biggestGain[0].id);
                if (otherGains.length > 0) {
                     this.todaysGainsTotal = otherGains.reduce((sum, item) => sum + ((item.change || 0) * this.calculateTransactionStats(item.transactions, item.price).totalSharesOwned), 0);
                     this.createGroup('📈 Gains Today', otherGains, 'gains-header', container, type, this.getGroupSummary(otherGains, 'gains'));
                }

                if (losses.length > 0) {
                    // Store the absolute (positive) value of losses for the summary calculation
                    const totalNegativeChange = losses.reduce((sum, item) => sum + ((item.change || 0) * this.calculateTransactionStats(item.transactions, item.price).totalSharesOwned), 0);
                    this.todaysLossesTotal = Math.abs(totalNegativeChange); 
                    this.createGroup('📉 Losses Today', losses, 'losses-header', container, type, this.getGroupSummary(losses, 'losses'));
                }
                
                // 4. Render Fail-Safe Group (New/Mismatched Items)
                if (dataMismatch.length > 0) {
                     this.createGroup('⚠️ Data Mismatch/Missing Shares', dataMismatch, 'mismatch-header', container, type, { 
                        title: `Please log a transaction for ${dataMismatch.length} item(s)`, 
                        text: "These items were added but have no shares or transactions recorded yet. They do not affect your portfolio metrics." 
                    });
                }

                // 5. Render Closed Positions (Sold Off) - RENDER LAST
                if (closedPositions.length > 0) {
                    const totalRealizedPL = closedPositions.reduce((sum, item) => sum + this.calculateTransactionStats(item.transactions).realizedPL, 0);
                    this.createGroup('🔒 Closed Positions (Sold Off)', closedPositions, 'closed-header', container, type, { 
                        title: `Total Realized P/L: ${this.formatCurrency(totalRealizedPL)}`, 
                        text: `This group contains ${closedPositions.length} positions you have completely sold. Their realized profit/loss is preserved in the card view.` 
                    });
                }
            }
            renderGroupedByPlatform(items, container, type) {
                if (items.length === 0) { 
                    if (container.classList.contains('group-content')) return;
                    container.innerHTML = `<div class="loading" style="grid-column: 1 / -1;">Your portfolio is empty.</div>`; 
                    return;
                }
                
                const platformMap = {};

                items.forEach(stock => {
                    const stockPlatforms = {};
                    (stock.transactions || []).forEach(tx => {
                        const platform = tx.platform || 'Uncategorized';
                        if (!stockPlatforms[platform]) {
                            stockPlatforms[platform] = [];
                        }
                        stockPlatforms[platform].push(tx);
                    });

                    for (const platform in stockPlatforms) {
                        const virtualStock = { ...stock, transactions: stockPlatforms[platform] };
                        if (!platformMap[platform]) {
                            platformMap[platform] = [];
                        }
                        platformMap[platform].push(virtualStock);
                    }
                });

                const sortedPlatformNames = Object.keys(platformMap).sort();

                for (const platformName of sortedPlatformNames) {
                    this.createGroup(platformName, platformMap[platformName], 'platform-header', container, type, this.getGroupSummary(platformMap[platformName], 'platform'));
                }
            }
            getGroupSummary(items, type) {
                let summaryTitle = '';
                let summaryText = '';
                if (type === 'biggest-gain') {
                    if (items.length > 0) {
                        const item = items[0];
                        summaryTitle = `Biggest Gain: ${item.symbol}`;
                        const changeClass = (item.change || 0) >= 0 ? 'positive' : 'negative';
                        const changePercentClass = (item.changePercent || 0) >= 0 ? 'positive' : 'negative';
                        const stats = this.calculateTransactionStats(item.transactions, item.price);
                        const totalPL = stats.unrealizedPL + stats.realizedPL;
                        const totalPLPercent = (stats.costOfRemainingShares + (stats.realizedPL > 0 ? 0 : -stats.realizedPL)) > 0 ? (totalPL / (stats.costOfRemainingShares + (stats.realizedPL > 0 ? 0 : -stats.realizedPL))) * 100 : 0;
                        const totalPLClass = totalPL >= 0 ? 'positive' : 'negative';
                        const totalValue = stats.currentValue;
                        const totalChangeToday = (item.change || 0) * stats.totalSharesOwned;
                        const totalChangeTodayClass = totalChangeToday >= 0 ? 'positive' : 'negative'; 
                        summaryText = `Gained <span class="${changeClass}">${this.formatCurrency(item.change)}</span> today, a change of <span class="${changePercentClass}">${(item.changePercent || 0).toFixed(2)}%</span>.`;
                        summaryText += `\nTotal Value: <span class="${totalPL >= 0 ? 'positive' : 'negative'}">${this.formatCurrency(totalValue)}</span>`;
                        summaryText += `\nTotal P/L: <span class="${totalPLClass}">${this.formatCurrency(totalPL)}</span> (<span class="${totalPLClass}">${this.formatNumber(totalPLPercent, 2)}%</span>)`;
                        summaryText += `\nTotal Change Today: <span class="${totalChangeTodayClass}">${this.formatCurrency(totalChangeToday)}</span>`;
                    }
                } else {
                    let totalChangeToday = 0;
                    let totalValue = 0;
                    let totalCostBasis = 0;
                    let totalPLUnrealized = 0;

                    items.forEach(item => {
                        const stats = this.calculateTransactionStats(item.transactions, item.price);
                        totalChangeToday += (item.change || 0) * stats.totalSharesOwned;
                        totalValue += stats.currentValue;
                        totalCostBasis += stats.costOfRemainingShares;
                        totalPLUnrealized += stats.unrealizedPL;
                    });
                    
                    const totalPLPercent = totalCostBasis > 0 ? (totalPLUnrealized / totalCostBasis) * 100 : 0;
                    summaryTitle = `Summary of ${items.length} item(s)`;
                    const totalChangeClass = totalChangeToday >= 0 ? 'positive' : 'negative';
                    const totalPLClass = totalPLUnrealized >= 0 ? 'positive' : 'negative';
                    summaryText = `Total Value: ${this.formatCurrency(totalValue)}\n`;
                    summaryText += `Total Unrealized P/L: <span class="${totalPLClass}">${this.formatCurrency(totalPLUnrealized)}</span> (<span class="${totalPLClass}">${this.formatNumber(totalPLPercent, 2)}%</span>)\n`;
                    summaryText += `Total Change Today: <span class="${totalChangeClass}">${this.formatCurrency(totalChangeToday)}</span>`;
                }
                return { title: summaryTitle, text: summaryText };
            }
            createGroup(title, itemList, headerClass, parent, type, summary = { title: '', text: '' }) {
                if(itemList.length === 0) return;
                const groupWrapper = document.createElement('div');
                groupWrapper.className = 'group-wrapper';

                const header = document.createElement('div');
                header.className = `group-header ${headerClass}`;
                header.innerHTML = `<span>${title} (${itemList.length})</span><span class="toggle-icon">▼</span>`;

                const content = document.createElement('div');
                content.className = `group-content ${headerClass.replace('-header', '')}-content`;
                
                const summaryContainer = document.createElement('div');
                summaryContainer.className = 'summary-content collapsed';
                summaryContainer.innerHTML = `<div class="summary-card"><h4>${summary.title}</h4><p>${summary.text}</p></div>`;
                
                const footer = document.createElement('div');
                footer.className = 'group-footer';
                footer.innerHTML = `<button class="add-btn collapse-group-btn">Collapse</button>`;

                const toggleGroup = () => {
                    const isCollapsed = header.classList.toggle('collapsed');
                    content.classList.toggle('collapsed');
                    
                    summaryContainer.classList.toggle('collapsed', !isCollapsed);

                    footer.classList.toggle('collapsed');

                    const toggleIcon = header.querySelector('.toggle-icon');
                    if(toggleIcon) toggleIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
                    const footerBtn = footer.querySelector('.collapse-group-btn');
                    if(footerBtn) footerBtn.textContent = isCollapsed ? 'Expand' : 'Collapse';
                    this.groupCollapseState[title] = isCollapsed;
                    sessionStorage.setItem('groupCollapseState', JSON.stringify(this.groupCollapseState));
                };

                header.addEventListener('click', toggleGroup);
                const footerBtn = footer.querySelector('.collapse-group-btn');
                if(footerBtn) footerBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleGroup();
                    header.scrollIntoView({ behavior: 'smooth' });
                });

                if (this.groupCollapseState[title] === true) {
                    header.classList.add('collapsed');
                    content.classList.add('collapsed');
                    summaryContainer.classList.remove('collapsed');
                    footer.classList.add('collapsed');
                    const toggleIcon = header.querySelector('.toggle-icon');
                    if(toggleIcon) toggleIcon.style.transform = 'rotate(-90deg)';
                    const footerBtn = footer.querySelector('.collapse-group-btn');
                    if(footerBtn) footerBtn.textContent = 'Expand';
                }

                // Append summary ONLY if not on a non-portfolio tab
                if (this.currentTab === 'stocks' || this.currentTab === 'funds') {
                    groupWrapper.append(header, summaryContainer, content, footer);
                } else {
                    // Only append header, content, and footer for other tabs like Watchlist
                    groupWrapper.append(header, content, footer);
                }
                
                parent.appendChild(groupWrapper);
                this.renderCards(itemList, content, type);
            }

            renderTransactions(transactions = [], dividends = [], itemId, type) {
                const all = [...(transactions || []).map((t, i) => ({ ...t, index: i, date: new Date(t.date), kind: 'transaction' })),
                             ...(dividends || []).map((d, i) => ({ ...d, index: i, date: new Date(d.date), kind: 'dividend' }))]
                    .sort((a, b) => b.date - a.date); // Sort newest first

                if (all.length === 0) return `<p style="text-align: center; color: var(--text-secondary); padding: 5px;">No transactions recorded.</p>`;

                return all.map(entry => {
                    if (entry.kind === 'dividend') {
                        return `
                            <div class="transaction-entry">
                                <div class="transaction-info">
                                    <span class="positive"><strong>DIVIDEND</strong> - ${this.formatCurrency(entry.totalAmount)}</span>
                                    <span>Shares: ${this.formatNumber(entry.shares, 3)} @ ${this.formatCurrency(entry.amountPerShare)} per share</span>
                                    <span style="font-size: 0.8rem; color: var(--text-secondary);">${new Date(entry.date).toLocaleDateString()}</span>
                                </div>
                                <div class="transaction-entry-controls">
                                    <button onclick="window.stockTracker.removeDividend('${itemId}', ${entry.index}, '${type}')" class="delete-transaction-btn">&times;</button>
                                </div>
                            </div>
                        `;
                    } else {
                        const transactionClass = entry.type === 'buy' ? 'buy' : 'sell';
                        const actionText = entry.type.toUpperCase();
                        return `
                            <div class="transaction-entry">
                                <div class="transaction-info">
                                    <span class="${transactionClass}"><strong>${actionText}</strong> ${this.formatNumber(entry.shares, 3)} shares @ ${this.formatCurrency(entry.price)}</span>
                                    <span style="font-size: 0.8rem; color: var(--text-secondary);">
                                        ${entry.platform || 'Unspecified'} - ${new Date(entry.date).toLocaleDateString()}
                                    </span>
                                    ${entry.note ? `<span style="font-style: italic; color: var(--text-secondary); font-size: 0.8rem;">Note: ${entry.note}</span>` : ''}
                                </div>
                                <div class="transaction-entry-controls">
                                    <button data-index="${entry.index}" class="edit-transaction-btn">Edit</button>
                                    <button data-index="${entry.index}" class="delete-transaction-btn">&times;</button>
                                </div>
                            </div>
                        `;
                    }
                }).join('');
            }
            
            renderCards(itemList, container, type) {
                if (!container.classList.contains('group-content')) {
                     container.innerHTML = '';
                }

                itemList.forEach(item => {
                    const card = document.createElement('div');
                    card.className = `${type}-card stock-card`; // Use stock-card for consistent styling
                    card.dataset.id = item.id;
                    card.dataset.type = type;
                    card.dataset.symbol = item.symbol;
                    const stats = this.calculateTransactionStats(item.transactions, item.price);
                    
                    let stockInfoHTML = '';
                    let cardChartHTML = '';
                    let isClosedPosition = false;

                    cardChartHTML = `
                        <div class="card-chart-container">
                            <div class="chart-controls">
                                <button class="chart-range-btn" data-range="1W">1W</button>
                                <button class="chart-range-btn" data-range="1M">1M</button>
                                <button class="chart-range-btn" data-range="6M">6M</button>
                                <button class="chart-range-btn" data-range="YTD">YTD</button>
                                <button class="chart-range-btn active" data-range="1Y">1Y</button>
                                <button class="chart-range-btn" data-range="3Y">3Y</button>
                                <button class="chart-range-btn" data-range="5Y">5Y</button>
                                <button class="chart-range-btn" data-range="All">All</button>
                            </div>
                            <canvas id="chart-${item.id}"></canvas>
                        </div>`;
                    
                    if ( (type === 'stock' || type === 'fund') && stats.totalSharesOwned < 0.0001 && (item.transactions || []).length > 0) {
                        isClosedPosition = true;
                        card.classList.add('closed-position');
                        const realizedPL = stats.realizedPL;
                        const realizedClass = realizedPL >= 0 ? 'positive' : 'negative';
                        stockInfoHTML = `
                            <div class="info-row" style="text-align: center; display: block; margin-bottom: 10px;">
                                <span class="info-label" style="font-weight: bold; font-size: 1.1em;">Position Closed</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Realized P/L</span>
                                <span class="info-value ${realizedClass}" style="font-size: 1.2em;">${this.formatCurrency(realizedPL)}</span>
                            </div>`;
                    } else if ( (type === 'stock' || type === 'fund') && stats.totalSharesOwned < 0.0001 && (item.transactions || []).length === 0) {
                        // Data Mismatch / New Item with Zero Shares
                         card.classList.add('data-mismatch-position'); // Use for styling if needed
                         stockInfoHTML = `
                            <div class="info-row" style="text-align: center; display: block; margin-bottom: 10px;">
                                <span class="info-label" style="font-weight: bold; color: orange; font-size: 1.1em;">Missing Shares/Data</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label">Action Required:</span>
                                <span class="info-value" style="color: var(--text-primary);">Log a BUY transaction.</span>
                            </div>`;
                    } else {
                        const totalPL = stats.unrealizedPL;
                        const totalPLPercent = stats.costOfRemainingShares > 0 ? (totalPL / stats.costOfRemainingShares) * 100 : 0;
                        const positiveClass = value => value >= 0 ? 'positive' : 'negative';
                
                        if (type === 'watchlist') {
                            stockInfoHTML = `<div class="info-row"><span class="info-label">Open:</span><span class="info-value">${this.formatCurrency(item.open || 0)}</span></div><div class="info-row"><span class="info-label">High:</span><span class="info-value">${this.formatCurrency(item.high || 0)}</span></div><div class="info-row"><span class="info-label">Low:</span><span class="info-value">${this.formatCurrency(item.low || 0)}</span></div><div class="info-row"><span class="info-label">Prev. Close:</span><span class="info-value">${this.formatCurrency(item.previousClose || 0)}</span></div>`;
                        } else { // For both stock and fund (active position)
                            stockInfoHTML = `
                                <div class="info-row"> <span class="info-label">Open:</span> <span class="info-value">${this.formatCurrency(item.open || 0)}</span> </div>
                                <div class="info-row"> <span class="info-label">Total Shares:</span> <span class="info-value">${this.formatNumber(stats.totalSharesOwned, 3)}</span> </div>
                                <div class="info-row"> <span class="info-label">Total Value:</span> <span class="info-value ${positiveClass(totalPL)}">${this.formatCurrency(stats.currentValue)}</span> </div>
                                <div class="info-row"> <span class="info-label">Avg. Cost:</span> <span class="info-value">${this.formatCurrency(stats.averageCostBasis)}</span> </div>
                                <div class="info-row"> <span class="info-label">Total P/L:</span> <span class="info-value ${positiveClass(totalPL)}">${this.formatCurrency(totalPL)}</span> </div>
                                <div class="info-row"> <span class="info-label">Total P/L %:</span> <span class="info-value ${positiveClass(totalPLPercent)}">${this.formatNumber(totalPLPercent, 2)}%</span> </div>
                                <div class="info-row"> <span class="info-label">Total Cost Basis:</span> <span class="info-value">${this.formatCurrency(stats.costOfRemainingShares)}</span> </div>`;
                        }
                    }
                    
                    const todayPL = (item.change || 0) * stats.totalSharesOwned; 
                    
                    let cardActionsHTML = '';
                    if (type === 'watchlist') {
                         cardActionsHTML = `
                            <div class="card-actions" style="grid-template-columns: 1fr 1fr;">
                                <button class="add-btn move-to-portfolio-btn" data-id="${item.id}" data-type="${type}">Move to Portfolio</button>
                                <button class="add-btn set-alert-btn" data-id="${item.id}" data-type="${type}">Set Price Alert</button>
                            </div>
                        `;
                    } else if (!isClosedPosition) {
                        // Stock or Fund with an active position or with data mismatch
                         cardActionsHTML = `
                            <div class="card-actions" style="grid-template-columns: repeat(4, 1fr); margin-top: 10px;">
                                <button class="add-btn buy-btn transaction-btn" data-id="${item.id}" data-type="${type}">Buy</button>
                                <button class="add-btn sell-btn transaction-btn" data-id="${item.id}" data-type="${type}">Sell</button>
                                <button class="add-btn set-alert-btn" data-id="${item.id}" data-type="${type}">Alert</button>
                                <button class="add-btn edit-btn" data-id="${item.id}" data-type="${type}">Edit Details</button>
                            </div>
                            <div class="card-actions" style="grid-template-columns: 1fr; margin-top: 12px;">
                                <button class="add-btn transaction-btn" style="background-color: var(--color-positive); opacity: 0.8;" onclick="window.stockTracker.openTransactionModal('${item.id}', '${type}', 'dividend')">Record Dividend</button>
                            </div>
                            <div class="transaction-details">
                                <div class="transaction-header">
                                    <h4>Transactions (${(item.transactions?.length || 0) + (item.dividends?.length || 0)} Txns) <span class="toggle-icon">▶</span></h4>
                                </div>
                                <div class="transactions-container">
                                    ${this.renderTransactions(item.transactions, item.dividends, item.id, type)}
                                </div>
                            </div>
                        `;
                    } else {
                        // Closed Position (only transactions visible)
                         cardActionsHTML = `
                            <div class="card-actions" style="grid-template-columns: 1fr; margin-top: 10px;">
                                <button class="add-btn transaction-btn buy-btn" data-id="${item.id}" data-type="${type}" style="background-color: var(--color-positive);">Re-open Position (Buy)</button>
                            </div>
                            <div class="transaction-details">
                                <div class="transaction-header">
                                    <h4>Transactions (${(item.transactions?.length || 0) + (item.dividends?.length || 0)} Txns) <span class="toggle-icon">▶</span></h4>
                                </div>
                                <div class="transactions-container collapsed">
                                    ${this.renderTransactions(item.transactions, item.dividends, item.id, type)}
                                </div>
                            </div>
                        `;
                    }


                    card.innerHTML = `
                        <div class="stock-header">
                            <span class="${type}-symbol stock-symbol">${item.symbol}</span>
                            <button class="remove-btn" onclick="window.stockTracker.removeItem('${item.id}', '${type}')">×</button>
                        </div>
                        <div class="stock-price">${this.formatCurrency(item.price || 0)}</div>
                        <div class="stock-change ${item.change >= 0 ? 'positive' : 'negative'}">
                            <span>${item.change >= 0 ? '▲' : '▼'} ${this.formatCurrency(item.change || 0)} (${(item.changePercent || 0).toFixed(2)}%)</span>
                        </div>
                        <div class="stock-info">${stockInfoHTML}</div>
                        ${cardChartHTML}
                        <div class="total-pl ${todayPL >= 0 ? 'positive' : 'negative'}">${type !== 'watchlist' ? `P/L Today: ${this.formatCurrency(todayPL)}` : ''}</div>
                        ${cardActionsHTML}
                    `;
                    
                    container.appendChild(card);
                    // No need to add extra event listeners here, as handleCardAction handles the delegated events.
                });
            }
            
            getOldestTransactionDate(item) {
                const transactions = item.transactions || [];
                if (transactions.length === 0) {
                    // Return 5 years ago if no transactions found, matching the default '5Y' data range
                    const d = new Date();
                    d.setFullYear(d.getFullYear() - 5);
                    return d;
                }
                
                // Filter for Buy transactions and find the one with the oldest date
                const buyTransactions = transactions.filter(t => t.type === 'buy');
                
                if (buyTransactions.length === 0) {
                     // If no buy transactions, return 5 years ago
                    const d = new Date();
                    d.setFullYear(d.getFullYear() - 5);
                    return d;
                }

                // Find the transaction with the minimum (oldest) date
                const oldestTransaction = buyTransactions.reduce((oldest, current) => {
                    const oldestDate = new Date(oldest.date);
                    const currentDate = new Date(current.date);
                    return currentDate < oldestDate ? current : oldest;
                });
                
                // Return the date object of the oldest transaction
                return new Date(oldestTransaction.date);
            }


            async renderCardChart(symbol, range = '1Y') {
                const card = document.querySelector(`.stock-card[data-symbol="${symbol}"], .fund-card[data-symbol="${symbol}"]`);
                if (!card) return;

                const chartId = `chart-${card.dataset.id}`;
                const canvas = document.getElementById(chartId);
                if (!canvas) return;
                const ctx = canvas.getContext('2d');

                // Helper to draw error message directly on canvas
                const drawError = (message) => {
                     if (this.cardChartInstances[chartId]) this.cardChartInstances[chartId].destroy();
                     ctx.clearRect(0, 0, canvas.width, canvas.height);
                     ctx.textAlign = 'center';
                     ctx.fillStyle = 'var(--color-negative)';
                     ctx.font = "16px 'Inter', sans-serif";
                     ctx.fillText(message, canvas.width / 2, canvas.height / 2);
                };

                // Update active button state
                const chartControls = card.querySelector('.chart-controls');
                if(chartControls) {
                    chartControls.querySelectorAll('.chart-range-btn').forEach(btn => btn.classList.remove('active'));
                    const newActiveButton = chartControls.querySelector(`[data-range="${range}"]`);
                    if(newActiveButton) newActiveButton.classList.add('active');
                }
                
                // Destroy previous chart instance if it exists
                if (this.cardChartInstances[chartId]) {
                    this.cardChartInstances[chartId].destroy();
                }

                try {
                    let historicalData;
                    if (this.chartDataCache[symbol]) {
                        historicalData = this.chartDataCache[symbol];
                    } else {
                        // Check if Alpha Vantage Key is set before fetching
                        if (!this.config.alphaVantageKey || this.config.alphaVantageKey === 'YOUR_ALPHA_VANTAGE_KEY') {
                            drawError("Alpha Vantage Key Missing. Cannot load chart data.");
                            return;
                        }
                        
                        this.showLoading(true, `Fetching chart data for ${symbol}...`);
                        const result = await this.apiService.fetchHistoricalData(symbol);
                        this.showLoading(false);
                        
                        if (!result.success) {
                            drawError(result.reason.includes('rate limit') ? "Rate Limit Hit. Wait a minute." : `API Error: ${result.reason}`);
                            throw new Error(result.reason); // Throw to skip further processing
                        }
                        this.chartDataCache[symbol] = result.data;
                        historicalData = result.data;
                    }

                    const allDataPoints = Object.entries(historicalData).map(([date, values]) => ({
                        x: new Date(date),
                        y: parseFloat(values['4. close'])
                    })).sort((a, b) => a.x - b.x);
                    
                    // --- LOGIC: Determine Chart Start Date ---
                    const item = this.stocks.find(s => s.symbol === symbol) || this.mutualFunds.find(f => f.symbol === symbol);
                    
                    const now = new Date();
                    let startDate = new Date();

                    switch(range) {
                        case '1W': startDate.setDate(now.getDate() - 7); break;
                        case '1M': startDate.setMonth(now.getMonth() - 1); break;
                        case '6M': startDate.setMonth(now.getMonth() - 6); break;
                        case 'YTD': startDate = new Date(now.getFullYear(), 0, 1); break;
                        case '1Y': startDate.setFullYear(now.getFullYear() - 1); break;
                        case '3Y': startDate.setFullYear(now.getFullYear() - 3); break;
                        case '5Y': startDate.setFullYear(now.getFullYear() - 5); break;
                        case 'All': 
                            // Use the oldest transaction date if available
                            startDate = item ? this.getOldestTransactionDate(item) : new Date(0);
                            break;
                        default: startDate.setFullYear(now.getFullYear() - 1); break;
                    }

                    const chartData = allDataPoints.filter(dp => dp.x >= startDate);
                    if (chartData.length <= 1) {
                        drawError('Not enough historical data for this range.');
                        return;
                    }

                    const firstPrice = chartData[0].y;
                    const lastPrice = chartData[chartData.length - 1].y;
                    const borderColor = lastPrice >= firstPrice ? 'var(--color-positive)' : 'var(--color-negative)';
                    const gridColor = this.isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
                    const labelColor = this.isDarkMode ? '#f1f1f1' : '#666';

                    // --- Dynamic X-Axis Unit Logic ---
                    let timeUnit = 'month';
                    if (range === '1W' || range === '1M') {
                        timeUnit = 'day';
                    } else if (range === '3Y' || range === '5Y' || range === 'All') {
                        timeUnit = 'year';
                    }

                    this.cardChartInstances[chartId] = new Chart(ctx, {
                        type: 'line',
                        data: {
                            datasets: [{
                                label: symbol,
                                data: chartData,
                                borderColor: borderColor,
                                tension: 0.1,
                                borderWidth: 2,
                                pointRadius: 0,
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: {
                                x: {
                                    type: 'time',
                                    time: { unit: timeUnit },
                                    ticks: { color: labelColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
                                    grid: { display: false }
                                },
                                y: {
                                    ticks: { color: labelColor, callback: (value) => this.formatCurrency(value) },
                                    grid: { color: gridColor, drawBorder: false }
                                }
                            },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    mode: 'index',
                                    intersect: false,
                                    callbacks: {
                                        label: (context) => `Price: ${this.formatCurrency(context.parsed.y)}`
                                    }
                                }
                            },
                            interaction: {
                                mode: 'index',
                                intersect: false,
                            }
                        }
                    });

                } catch (error) {
                    // Catch the error thrown if API key is missing or API limits hit.
                    console.error(`Chart rendering error for ${symbol}:`, error);
                    // The error message is already drawn in the catch block above (drawError) if needed.
                }
            }
            
            async moveToPortfolio(id) {
                const stockIndex = this.watchlist.findIndex(stock => stock.id === id);
                if (stockIndex === -1) return;

                const [stockToMove] = this.watchlist.splice(stockIndex, 1);
                
                stockToMove.transactions = [];
                stockToMove.dividends = [];
                
                this.stocks.push(stockToMove);

                await this.saveData();
                this.renderContent();
                this.showSuccess(`✅ Moved ${stockToMove.symbol} to portfolio!`);
            }
            showRefreshStatus(type, stats) {
                const statusDiv = this.elements.refreshStatusPopup;
                if (!statusDiv) return;
                statusDiv.innerHTML = `Refreshed ${stats.success} ${type}(s). ✅ ${stats.gains} gained, 🔻${stats.losses} lost. Failed: ${stats.failed}.`;
                statusDiv.style.display = 'block';
                setTimeout(() => { statusDiv.style.display = 'none'; }, 15000);
            }
            showLoading(show, message = 'Loading...') { if(this.elements.loadingDiv) { this.elements.loadingDiv.style.display = show ? 'block' : 'none'; this.elements.loadingDiv.textContent = message; } }
            showError(message) {
                if(this.elements.errorDiv) {
                    this.elements.errorDiv.style.display = 'block';
                    this.elements.errorDiv.innerHTML = `<h4>Error</h4><p>${message}</p>`;
                    setTimeout(() => { if(this.elements.errorDiv) this.elements.errorDiv.style.display = 'none'; }, 10000);
                }
            }
            showSuccess(message) {
                if(this.elements.successDiv) {
                    this.elements.successDiv.style.display = 'block';
                    this.elements.successDiv.innerHTML = `<h4>Success</h4><p>${message}</p>`;
                    setTimeout(() => { if(this.elements.successDiv) this.elements.successDiv.style.display = 'none'; }, 3000);
                }
            }
            async exportData() {
                this.saveScrollPosition();
                const dataStr = JSON.stringify({ stocks: this.stocks, mutualFunds: this.mutualFunds, watchlist: this.watchlist }, null, 2);
                const blob = new Blob([dataStr], {type: 'application/json'});
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'portfolio-data.json';
                a.click();
                URL.revokeObjectURL(a.href);
            }
            async importData(e) {
                const file = e.target.files[0];
                if (!file) return;
                this.saveScrollPosition();
                const reader = new FileReader();
                reader.onload = async (event) => {
                    try {
                        const data = JSON.parse(event.target.result);
                        this.stocks = data.stocks || this.stocks;
                        this.mutualFunds = data.mutualFunds || this.mutualFunds;
                        this.watchlist = data.watchlist || this.watchlist;
                        await this.saveData();
                        this.renderContent();
                        this.showSuccess(`✅ Data successfully imported!`);
                    } catch (err) { this.showError('❌ Error parsing JSON file.'); }
                };
                reader.readAsText(file);
            }
            // --- NEW: Render Diversification Chart (Style changed to match the visual request) ---
            renderDiversificationChart() {
                const container = this.elements.diversificationChartContainer;
                const allItems = [...this.stocks, ...this.mutualFunds];
                const totalPortfolioValue = allItems.reduce((sum, item) => sum + this.calculateTransactionStats(item.transactions, item.price).currentValue, 0);
                
                const hasTransactions = allItems.some(s => s.transactions && s.transactions.length > 0 && this.calculateTransactionStats(s.transactions).currentValue > 0);
                
                if(container) container.style.display = (this.currentTab === 'stocks' || this.currentTab === 'funds') && hasTransactions ? 'block' : 'none';
                if (!container || container.style.display === 'none') return;
                
                const industryData = allItems.reduce((acc, stock) => {
                    const { currentValue } = this.calculateTransactionStats(stock.transactions, stock.price);
                    if (currentValue > 0) acc[stock.industry || 'Other'] = (acc[stock.industry || 'Other'] || 0) + currentValue;
                    return acc;
                }, {});
                
                const sortedData = Object.entries(industryData)
                    .map(([label, value]) => ({ 
                        label, 
                        value, 
                        percentage: totalPortfolioValue > 0 ? (value / totalPortfolioValue) * 100 : 0 
                    }))
                    .sort((a, b) => b.value - a.value);

                const labels = sortedData.map(item => item.label);
                const data = sortedData.map(item => item.value);

                if (this.diversificationChartInstance) {
                    this.diversificationChartInstance.destroy();
                }

                // Custom color palette matching the requested style (vibrant colors)
                const colors = [
                    '#E74C3C', '#F39C12', '#2ECC71', '#9B59B6', '#3498DB', 
                    '#1ABC9C', '#F1C40F', '#7F8C8D', '#95A5A6', '#D35400',
                    '#5D6D7E', '#2E86C1', '#A93226', '#1E8449', '#6C3483'
                ];
                
                const gridColor = this.isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
                const labelColor = this.isDarkMode ? '#f1f1f1' : '#212529';
                
                // Dynamic mapping of colors to data points
                const backgroundColors = sortedData.map((_, index) => colors[index % colors.length]);

                // Create custom legend HTML
                const legendHtml = sortedData.map((item, index) => {
                    // Check if the allocation is substantial enough to be in the main legend (e.g., > 2%)
                    if (item.percentage >= 2 || index < 6) { 
                        return `
                            <div class="legend-item">
                                <span class="legend-color" style="background-color: ${backgroundColors[index]};"></span>
                                ${item.label}: ${this.formatNumber(item.percentage, 1)}% 
                                (${this.formatCurrency(item.value)})
                            </div>
                        `;
                    }
                    return '';
                }).join('');
                
                // Clear and render the main container layout
                container.innerHTML = `
                    <h4>Asset Allocation Breakdown by Industry</h4>
                    <div class="diversification-content">
                        <div class="diversification-chart-wrapper">
                            <canvas id="diversificationChart"></canvas>
                        </div>
                        <div class="diversification-legend" id="diversification-legend">
                            ${legendHtml}
                        </div>
                    </div>
                `;
                
                const chartCanvas = document.getElementById('diversificationChart');
                if(chartCanvas) {
                    this.diversificationChartInstance = new Chart(chartCanvas, {
                        type: 'bar',
                        data: { 
                            labels, 
                            datasets: [{ 
                                label: 'Value (USD)', 
                                data, 
                                backgroundColor: backgroundColors,
                                borderRadius: 5, // Rounded corners for bars
                            }] 
                        },
                        options: { 
                            responsive: true, 
                            maintainAspectRatio: false, 
                            indexAxis: 'x', // Vertical bars
                            plugins: { 
                                title: { display: false }, 
                                legend: { display: false }, // Use custom HTML legend
                                tooltip: {
                                    callbacks: {
                                        label: (context) => {
                                            const value = context.parsed.y;
                                            const percentage = totalPortfolioValue > 0 ? (value / totalPortfolioValue) * 100 : 0;
                                            return `${context.label}: ${this.formatCurrency(value)} (${this.formatNumber(percentage, 1)}%)`;
                                        }
                                    }
                                }
                            }, 
                            scales: { 
                                y: { 
                                    ticks: { 
                                        color: labelColor, 
                                        callback: (value) => this.formatCurrency(value) 
                                    }, 
                                    grid: { color: gridColor, drawBorder: false } 
                                }, 
                                x: { 
                                    ticks: { 
                                        color: labelColor,
                                        maxRotation: 45, // Rotate labels for better fit
                                        minRotation: 45 
                                    }, 
                                    grid: { color: gridColor, drawBorder: false } 
                                } 
                            } 
                        }
                    });
                }
            }
            // --- END Diversification Chart Update ---
            
            async updatePortfolioHistory() {
                const allItems = [...this.stocks, ...this.mutualFunds];
                 const today = new Date().toISOString().slice(0, 10);
                const lastEntry = this.portfolioHistory.at(-1);
                let totalValue = allItems.reduce((sum, item) => sum + this.calculateTransactionStats(item.transactions, item.price).currentValue, 0);
                if (totalValue <= 0) return;
                
                // Add or update the latest entry only if the date is new or the value changed significantly
                if (!lastEntry || lastEntry.date !== today || Math.abs(lastEntry.value - totalValue) > 1) {
                    if (!lastEntry || lastEntry.date !== today) {
                        // Ensure the new entry is correctly formatted.
                        this.portfolioHistory.push({ date: today, value: totalValue });
                    } else {
                        lastEntry.value = totalValue;
                    }
                     await this.saveData();
                }
                
            }
            
            /**
             * ==================================================================
             * ==      PORTFOLIO PERFORMANCE CHART FUNCTIONS (Bar/Line Switch) ==
             * ==================================================================
             */
            renderTodayPerformanceBarChart() {
                // 1. Prepare Data for Bar Chart
                const allItems = [...this.stocks, ...this.mutualFunds];
                const data = allItems.map(item => {
                    const stats = this.calculateTransactionStats(item.transactions, item.price);
                    const changeToday = (item.change || 0) * stats.totalSharesOwned;
                    const changePercentToday = item.changePercent || 0;
                    return { symbol: item.symbol, change: changeToday, percent: changePercentToday };
                }).filter(item => item.change !== 0); // Filter out only zero-change items, keep gains and losses

                // Sort by absolute change (top movers)
                const topMovers = data.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, this.topMoversCount || 10); // Top N movers

                const labels = topMovers.map(item => item.symbol);
                const barValues = topMovers.map(item => item.change);
                
                // 2. Determine colors
                const backgroundColors = barValues.map(change => 
                    change >= 0 ? 'var(--color-positive)' : 'var(--color-negative)'
                );
                const gridColor = this.isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
                const labelColor = this.isDarkMode ? '#f1f1f1' : '#212529';
                
                // 3. Destroy previous chart
                if (this.portfolioPerformanceBarChartInstance) {
                    this.portfolioPerformanceBarChartInstance.destroy();
                }

                // 4. Initialize Bar Chart
                const ctx = this.elements.portfolioPerformanceBarChart.getContext('2d');
                this.portfolioPerformanceBarChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: "P/L Today ($)",
                            data: barValues,
                            backgroundColor: backgroundColors,
                            borderColor: backgroundColors,
                            borderWidth: 1,
                            borderRadius: 5,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        indexAxis: 'x',
                        plugins: {
                            legend: { display: false },
                            title: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const change = context.parsed.y;
                                        const percent = topMovers[context.dataIndex].percent;
                                        return `${context.label}: ${this.formatCurrency(change)} (${this.formatNumber(percent, 2)}%)`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                title: { display: true, text: 'P/L Value (USD)', color: labelColor },
                                ticks: { color: labelColor, callback: (val) => this.formatCurrency(val) },
                                grid: { color: gridColor, drawBorder: false }
                            },
                            x: {
                                ticks: { color: labelColor, maxRotation: 45, minRotation: 45 },
                                grid: { display: false }
                            }
                        }
                    }
                });
            }

            renderHistoricalLineChart(range = '1Y') {
                const hasHistory = this.portfolioHistory.length > 0;
                
                const ctx = this.elements.portfolioPerformanceChart.getContext('2d');
                
                if (this.portfolioPerformanceChartInstance) {
                    this.portfolioPerformanceChartInstance.destroy();
                    this.portfolioPerformanceChartInstance = null; // Ensure null after destroy
                }

                // If no history, show error on the historical canvas
                if (!hasHistory) {
                    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                    ctx.textAlign = 'center';
                    ctx.fillStyle = this.isDarkMode ? '#adb5bd' : '#6c757d';
                    ctx.font = "16px 'Inter', sans-serif";
                    ctx.fillText('No portfolio history saved yet.', ctx.canvas.width / 2, ctx.canvas.height / 2 - 20);
                    return;
                }
                
                // 1. Data Filtering
                const allDataPoints = this.portfolioHistory.map(e => ({ x: new Date(e.date), y: e.value }));
                const now = new Date();
                let startDate = new Date();

                switch(range) {
                    case '1W': startDate.setDate(now.getDate() - 7); break;
                    case '1M': startDate.setMonth(now.getMonth() - 1); break;
                    case '6M': startDate.setMonth(now.getMonth() - 6); break;
                    case 'YTD': startDate = new Date(now.getFullYear(), 0, 1); break;
                    case '1Y': startDate.setFullYear(now.getFullYear() - 1); break;
                    case '3Y': startDate.setFullYear(now.getFullYear() - 3); break;
                    case '5Y': startDate.setFullYear(now.getFullYear() - 5); break;
                    case 'ALL': startDate = allDataPoints.length > 0 ? new Date(allDataPoints[0].x) : new Date(0); break;
                    default: startDate.setFullYear(now.getFullYear() - 1); break;
                }
                
                // FIX 1: Filter data based on date range
                const chartData = allDataPoints.filter(dp => dp.x >= startDate);

                if (chartData.length <= 1) {
                    // Clear canvas and draw specific message if data is too sparse for the selected range
                    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
                    ctx.textAlign = 'center';
                    ctx.fillStyle = this.isDarkMode ? '#adb5bd' : '#6c757d';
                    ctx.font = "16px 'Inter', sans-serif";
                    ctx.fillText(`Not enough history for the ${range} range.`, ctx.canvas.width / 2, ctx.canvas.height / 2 - 20);
                    return;
                }
                
                // 2. Dynamic Colors/Styles
                const lineRgb = window.getRgbColor('--chart-line-color');
                const fillRgb = window.getRgbColor('--chart-fill-color-rgb');
                const refColor = window.getRgbColor('--chart-reference-color');
                const gridColor = this.isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)';
                const labelColor = this.isDarkMode ? '#f1f1f1' : '#666';
                
                const createGradient = (ctx, area) => {
                    const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
                    const rgbValues = fillRgb.includes(',') ? fillRgb : (this.isDarkMode ? '191, 148, 228' : '153, 102, 204');
                    // Use a slightly darker color at the top of the gradient for better visual depth
                    const darkRgb = this.isDarkMode ? '150, 120, 180' : '100, 80, 120';
                    gradient.addColorStop(0, `rgba(${rgbValues}, 0.5)`); // Increased opacity
                    gradient.addColorStop(0.5, `rgba(${rgbValues}, 0.2)`);
                    gradient.addColorStop(1, `rgba(${rgbValues}, 0)`);
                    return gradient;
                };
                
                // Calculate Start/End Portfolio Value for percentage label and reference line
                const startValue = chartData[0].y;
                const endValue = chartData[chartData.length - 1].y;
                const percentageChange = ((endValue - startValue) / startValue) * 100;
                const changeClass = percentageChange >= 0 ? 'positive' : 'negative';
                const textColor = percentageChange >= 0 ? 'var(--color-positive)' : 'var(--color-negative)';

                // 3. Dynamic X-Axis Unit Logic
                let timeUnit = 'month';
                let displayFormat = 'MMM yy';

                if (range === '1W' || range === '1M') {
                    timeUnit = 'day';
                    displayFormat = 'MMM d';
                } else if (range === '6M' || range === '1Y') {
                    // Use months for 6M and 1Y to avoid overcrowding daily points
                    timeUnit = 'month';
                    displayFormat = 'MMM yy';
                } else if (range === '3Y') {
                    // Use weeks for 3Y
                    timeUnit = 'week';
                    displayFormat = 'MMM yy';
                } else if (range === '5Y' || range === 'ALL') {
                    // Use months for 5Y and ALL, showing month+year
                    timeUnit = 'month';
                    displayFormat = 'MMM yy';
                }

                // 4. Initialize the chart
                this.portfolioPerformanceChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        datasets: [
                            // Dataset 1: The Main Portfolio Line with Area Fill
                            {
                                label: "Portfolio Value ($)",
                                data: chartData,
                                borderColor: lineRgb, 
                                borderWidth: 2, 
                                pointRadius: 0,
                                pointHitRadius: 10,
                                tension: 0.2, // Smoother curve
                                fill: 'origin', // Fill area below the line
                                backgroundColor: (context) => {
                                    const chartArea = context.chart.chartArea;
                                    if (!chartArea) return null;
                                    return createGradient(context.chart.ctx, chartArea);
                                },
                            },
                            // Dataset 2: Simulated Transaction/Event Points (Orange/Yellow dots)
                            {
                                label: "Events",
                                data: chartData.map((point, i) => {
                                    // Simulate transactions/events on random points near the line value
                                    if (i % 10 === 0 && i > 0 && i < chartData.length - 1) {
                                        return {
                                            x: point.x, 
                                            // Slight offset from the line for visibility
                                            y: point.y + (Math.random() - 0.5) * (point.y * 0.005)
                                        };
                                    }
                                    return null;
                                }).filter(point => point !== null),
                                type: 'scatter',
                                borderColor: 'transparent',
                                backgroundColor: '#F39C12', // Orange/Yellow color
                                pointRadius: 5,
                                pointBorderColor: 'white',
                                pointBorderWidth: 1,
                                showLine: false,
                                fill: false,
                                tooltip: {
                                    callbacks: {
                                        label: (ctx) => `Transaction/Event near: ${this.formatCurrency(ctx.parsed.y)}`
                                    }
                                }
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { intersect: false, mode: 'index' },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                mode: 'index',
                                intersect: false,
                                callbacks: {
                                    label: (ctx) => {
                                        if (ctx.datasetIndex === 1) return `Event: ${this.formatCurrency(ctx.parsed.y)}`;
                                        return 'Value: ' + this.formatCurrency(ctx.parsed.y);
                                    },
                                    title: (ctx) => new Date(ctx[0].parsed.x).toLocaleDateString()
                                }
                            },
                            annotation: {
                                annotations: {
                                    // Reference Line at Start Value (Dotted Line)
                                    startLine: {
                                        type: 'line',
                                        yMin: startValue,
                                        yMax: startValue,
                                        borderColor: refColor,
                                        borderWidth: 2,
                                        borderDash: [5, 5],
                                        label: {
                                            content: 'Start Value',
                                            display: false 
                                        },
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                type: 'time',
                                time: { 
                                    unit: timeUnit,
                                    tooltipFormat: 'MM/dd/yyyy',
                                    displayFormats: {
                                        [timeUnit]: displayFormat
                                    }
                                },
                                ticks: { 
                                    color: labelColor, 
                                    maxRotation: 0, 
                                    autoSkip: true, 
                                    maxTicksLimit: (range === '1W' ? 7 : 10),
                                    callback: (value) => {
                                        try {
                                            const d = new Date(value);
                                            if (range === '1W') {
                                                return d.toLocaleDateString(undefined, { weekday: 'short' });
                                            }
                                            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                                        } catch(e) {
                                            return value;
                                        }
                                    }
                                },
                                grid: { color: gridColor, drawBorder: false }
                            },
                            y: {
                                type: 'linear',
                                title: { display: false, text: 'Value (USD)', color: labelColor }, 
                                ticks: {
                                    color: labelColor,
                                    callback: (val) => this.formatCurrency(val)
                                },
                                beginAtZero: false,
                                grid: { color: gridColor, drawBorder: false }
                            },
                            // Custom right-side axis for current price marker
                            yRight: {
                                type: 'linear',
                                position: 'right',
                                title: { display: false },
                                // Ensure the min/max mirrors the main Y axis, but we only calculate after chart draw
                                min: chartData.reduce((min, p) => Math.min(min, p.y), Infinity) * 0.95,
                                max: chartData.reduce((max, p) => Math.max(max, p.y), 0) * 1.05,
                                ticks: {
                                    stepSize: (endValue > 1000) ? 50 : 10,
                                    color: labelColor,
                                    callback: function(val, index, values) {
                                        // Find the closest tick value to the endValue
                                        const formattedEndValue = window.stockTracker.formatNumber(endValue, 2);
                                        // Get the tick values array (excluding the custom end tick)
                                        const tickValues = values.map(v => v.value);

                                        // Only draw custom tick if this is the closest/exact match to the current value
                                        const isEndValue = Math.abs(val - endValue) < (values.length > 1 ? Math.abs(values[1].value - values[0].value) / 2 : 1);
                                        
                                        if (isEndValue) {
                                            // Draw the green current price box
                                            const boxColor = window.getRgbColor('--chart-reference-color');
                                            return {
                                                label: formattedEndValue,
                                                padding: 5,
                                                backgroundColor: boxColor,
                                                borderColor: 'white',
                                                borderWidth: 1,
                                                borderRadius: 4,
                                                font: {
                                                    weight: 'bold',
                                                    size: 12
                                                },
                                                color: 'white'
                                            };
                                        }
                                        return null; // Hide all other ticks on this axis
                                    }
                                },
                                grid: { drawOnChartArea: false, drawBorder: false }
                            }
                        }
                    },
                    plugins: [
                        { // Custom plugin to draw the percentage change annotation box
                            id: 'percentageChangeBox',
                            afterDraw: (chart) => {
                                // Find the index of the start point (first visible point)
                                const startPoint = chart.getDatasetMeta(0).data[0];
                                
                                if (!startPoint) return;
                                
                                const x = startPoint.x;
                                const y = chart.chartArea.top + 10; // Top of the chart area
                                const text = `${window.stockTracker.formatNumber(percentageChange, 2)}%`;
                                const boxWidth = 70;
                                const boxHeight = 25;
                                
                                const ctx = chart.ctx;
                                ctx.save();
                                
                                // Get colors from CSS vars
                                const bgColor = window.getRgbColor('--bg-secondary');
                                const borderColor = window.getRgbColor('--border-color');
                                
                                ctx.fillStyle = `rgb(${bgColor.includes(',') ? bgColor : '255, 255, 255'})`; // Background box
                                ctx.strokeStyle = `rgb(${borderColor.includes(',') ? borderColor : '222, 226, 230'})`;
                                ctx.lineWidth = 1;
                                
                                const cornerRadius = 5;
                                
                                // Draw the box
                                ctx.beginPath();
                                ctx.moveTo(x + cornerRadius, y);
                                ctx.lineTo(x + boxWidth - cornerRadius, y);
                                ctx.arcTo(x + boxWidth, y, x + boxWidth, y + cornerRadius, cornerRadius);
                                ctx.lineTo(x + boxWidth, y + boxHeight - cornerRadius);
                                ctx.arcTo(x + boxWidth, y + boxHeight, x + boxWidth - cornerRadius, y + boxHeight, cornerRadius);
                                ctx.lineTo(x + cornerRadius, y + boxHeight);
                                ctx.arcTo(x, y + boxHeight, x, y + boxHeight - cornerRadius, cornerRadius);
                                ctx.lineTo(x, y + cornerRadius);
                                ctx.arcTo(x, y, x + cornerRadius, y, cornerRadius);
                                ctx.closePath();
                                ctx.fill();
                                ctx.stroke();
                                
                                // Draw the text
                                ctx.font = `bold 12px 'Inter', sans-serif`;
                                ctx.textAlign = 'center';
                                ctx.fillStyle = textColor;
                                ctx.fillText(text, x + boxWidth / 2, y + boxHeight / 2 + 4);
                                
                                ctx.restore();
                            }
                        },
                        ChartAnnotation,
                    ]
                });
            }

            renderPortfolioPerformanceChart(range = 'BAR_TODAY') {
                const container = this.elements.portfolioPerformanceContainer;
                
                if(container) container.style.display = (this.currentTab === 'stocks' || this.currentTab === 'funds') && (this.stocks.length > 0 || this.mutualFunds.length > 0) ? 'block' : 'none';
                if (!container || container.style.display === 'none') return;
                
                const isBarChart = range === 'BAR_TODAY';

                // Toggle Visibility of Chart Wrappers and Update Title
                if (this.elements.historicalChartWrapper) this.elements.historicalChartWrapper.style.display = isBarChart ? 'none' : 'block';
                if (this.elements.barChartWrapper) this.elements.barChartWrapper.style.display = isBarChart ? 'block' : 'none';
                if (this.elements.portfolioChartTitle) this.elements.portfolioChartTitle.textContent = isBarChart ? "Today's Performance Breakdown (Top Movers)" : "Portfolio Performance History";

                // Update active state of range buttons
                if(this.elements.performanceChartControls) {
                    const buttons = this.elements.performanceChartControls.querySelectorAll('.chart-range-btn');
                    buttons.forEach(btn => btn.classList.remove('active'));
                    
                    const newActiveButton = this.elements.performanceChartControls.querySelector(`[data-range="${range}"]`);
                    if(newActiveButton) newActiveButton.classList.add('active');
                }

                // Render the selected chart type
                if (isBarChart) {
                    this.renderTodayPerformanceBarChart();
                } else {
                    this.renderHistoricalLineChart(range);
                }

                // FIX 5: Force a resize event with a delay, which is necessary for Chart.js in embedded/dynamic layouts
                setTimeout(() => {
                    if (this.portfolioPerformanceChartInstance) {
                        this.portfolioPerformanceChartInstance.resize();
                    }
                    if (this.portfolioPerformanceBarChartInstance) {
                        this.portfolioPerformanceBarChartInstance.resize();
                    }
                }, 100);
            }
            openSettingsModal() {
                if (this.elements.settingsModal) this.elements.settingsModal.style.display = 'flex';
                if (this.elements.modalFinnhubKey) this.elements.modalFinnhubKey.value = localStorage.getItem('finnhubApiKey') || this.config.finnhubApiKey;
                if (this.elements.modalAlphaVantageKey) this.elements.modalAlphaVantageKey.value = localStorage.getItem('alphaVantageApiKey') || this.config.alphaVantageKey;
                if (this.elements.modalFmpKey) this.elements.modalFmpKey.value = localStorage.getItem('fmpApiKey') || this.config.fmpApiKey;
                if (this.elements.modalRefreshInterval) this.elements.modalRefreshInterval.value = this.config.refreshIntervalMs / 1000;
            }
            closeSettingsModal() { if (this.elements.settingsModal) this.elements.settingsModal.style.display = 'none'; }
            saveSettings() {
                const finnhubKey = this.elements.modalFinnhubKey ? this.elements.modalFinnhubKey.value.trim() : this.config.finnhubApiKey;
                const alphaVantageKey = this.elements.modalAlphaVantageKey ? this.elements.modalAlphaVantageKey.value.trim() : this.config.alphaVantageKey;
                const fmpKey = this.elements.modalFmpKey ? this.elements.modalFmpKey.value.trim() : this.config.fmpApiKey;
                const refreshInterval = parseInt(this.elements.modalRefreshInterval ? this.elements.modalRefreshInterval.value : 90);

                if (refreshInterval < 10) { this.showError("Refresh interval must be at least 10 seconds."); return; }

                localStorage.setItem('finnhubApiKey', finnhubKey);
                localStorage.setItem('alphaVantageApiKey', alphaVantageKey);
                localStorage.setItem('fmpApiKey', fmpKey);
                localStorage.setItem('refreshIntervalMs', refreshInterval * 1000);

                this.config.finnhubApiKey = finnhubKey;
                this.config.alphaVantageKey = alphaVantageKey;
                this.config.fmpApiKey = fmpKey;
                this.config.refreshIntervalMs = refreshInterval * 1000;
                
                this.apiService = new ApiService(this.config); // Re-initialize API service with new keys

                this.closeSettingsModal();
                this.stopLiveUpdate();
                this.startLiveUpdate();
                this.showSuccess("✅ Settings saved and auto-refresh restarted!");
            }

            // --- Theme/Privacy Toggles ---
            toggleDarkMode() {
                this.isDarkMode = !this.isDarkMode;
                localStorage.setItem('darkMode', this.isDarkMode ? 'enabled' : 'disabled');
                this.applyTheme();
                this.renderContent(); // Re-render charts for color update
            }
            applyTheme() {
                const isDark = localStorage.getItem('darkMode') === 'enabled';
                this.isDarkMode = isDark;
                document.body.classList.toggle('dark-mode', isDark);
                if(this.elements.toggleDarkModeBtn) this.elements.toggleDarkModeBtn.textContent = isDark ? '☀️ Toggle Theme' : '🌙 Toggle Theme';
            }
            togglePrivacyMode() {
                this.isPrivacyMode = !this.isPrivacyMode;
                localStorage.setItem('privacyMode', this.isPrivacyMode ? 'enabled' : 'disabled');
                this.applyPrivacyMode();
            }
            applyPrivacyMode() {
                const isPrivate = localStorage.getItem('privacyMode') === 'enabled';
                this.isPrivacyMode = isPrivate;
                document.body.classList.toggle('privacy-mode', isPrivate);
                if(this.elements.togglePrivacyBtn) this.elements.togglePrivacyBtn.textContent = isPrivate ? '👀 Reveal Values' : '👁️ Privacy Mode';
            }

            // --- Confirm Modal Management ---
            openConfirmModal(message, onConfirmCallback) {
                if (this.elements.confirmModal && this.elements.confirmModalText) {
                    this.elements.confirmModalText.textContent = message;
                    this.elements.confirmModal.style.display = 'flex';
                    this.onConfirm = onConfirmCallback;
                }
            }
            closeConfirmModal(resetOnConfirm = false) {
                if (this.elements.confirmModal) this.elements.confirmModal.style.display = 'none';
                if (resetOnConfirm) this.onConfirm = null;
            }
            handleConfirmAction() {
                if (this.onConfirm) {
                    this.onConfirm();
                }
                this.closeConfirmModal(true);
            }
            
            // --- Edit Stock Details Modal ---
            openEditStockModal(id) {
                const item = this.stocks.find(s => s.id === id) || this.mutualFunds.find(f => f.id === id);
                if (!item || !this.elements.editStockModal) return;

                this.elements.editStockModal.style.display = 'flex';
                this.elements.editStockModal.dataset.editId = id;
                this.elements.editStockSymbolDisplay.textContent = item.symbol;
                
                // Populate fields
                this.elements.editStockSymbol.value = item.symbol;
                this.elements.editStockName.value = item.name || '';
                
                // Get initial buy details (shares, cost, date) from first transaction
                const firstBuy = (item.transactions || []).filter(t => t.type === 'buy').sort((a,b) => new Date(a.date) - new Date(b.date))[0];
                const totalStats = this.calculateTransactionStats(item.transactions, item.price);
                
                // Note: The modal is simplified to edit initial/core data only, 
                // but for complex transactions, editing should be done on the transaction log.
                // We display placeholder values derived from transactions, but saving only updates the core metadata.
                this.elements.editStockShares.value = totalStats.totalSharesOwned > 0 ? totalStats.totalSharesOwned : '';
                this.elements.editStockCost.value = totalStats.averageCostBasis > 0 ? totalStats.averageCostBasis : '';
                this.elements.editStockDate.value = firstBuy ? firstBuy.date.split('T')[0] : '';
                
                // Platform is now stored per transaction, but we can set a primary one for display if all are same
                const uniquePlatforms = [...new Set((item.transactions || []).map(t => t.platform))].filter(p => p);
                this.elements.editStockPlatform.value = uniquePlatforms.length === 1 ? uniquePlatforms[0] : (uniquePlatforms.length > 1 ? 'Multiple Platforms' : '');

                // For simplicity, we disable editing core stats if multiple transactions exist
                const canEditCore = (item.transactions || []).filter(t => t.type === 'buy').length <= 1;
                this.elements.editStockShares.disabled = !canEditCore;
                this.elements.editStockCost.disabled = !canEditCore;
                this.elements.editStockDate.disabled = !canEditCore;
                
                if(!canEditCore) {
                    this.showError("Cannot edit Shares/Cost/Date here. Use 'Buy/Sell' buttons to manage multiple transactions.");
                }
            }
            closeEditStockModal() {
                 if (this.elements.editStockModal) this.elements.editStockModal.style.display = 'none';
            }
            async saveStockDetails() {
                const id = this.elements.editStockModal ? this.elements.editStockModal.dataset.editId : null;
                const item = this.stocks.find(s => s.id === id) || this.mutualFunds.find(f => f.id === id);
                if (!item) { this.showError("Item not found."); return; }

                const newSymbol = this.elements.editStockSymbol ? this.elements.editStockSymbol.value.trim().toUpperCase() : item.symbol;
                const newName = this.elements.editStockName ? this.elements.editStockName.value.trim() : item.name;
                const newPlatform = this.elements.editStockPlatform ? this.elements.editStockPlatform.value.trim() : 'Uncategorized';
                
                // Check if symbol changed and if new symbol is valid
                if (newSymbol !== item.symbol) {
                     this.showError("Symbol change is not supported. Please remove and re-add the item.");
                     return;
                }
                
                item.name = newName;
                item.industry = item.industry.includes('Mutual Fund') ? 'Mutual Fund' : 'Custom Industry'; // Reset industry if name changed (optional)

                // Update platform across all transactions if it's not 'Multiple Platforms'
                if (newPlatform !== 'Multiple Platforms') {
                    (item.transactions || []).forEach(t => t.platform = newPlatform);
                }

                // If user edits shares/cost/date and it was a single transaction, update that transaction (not recommended, but supported for initial entry simplicity)
                const canEditCore = (item.transactions || []).filter(t => t.type === 'buy').length <= 1;
                if (canEditCore && (item.transactions || []).length > 0) {
                    const shares = parseFloat(this.elements.editStockShares ? this.elements.editStockShares.value : 0);
                    const cost = parseFloat(this.elements.editStockCost ? this.elements.editStockCost.value : 0);
                    const date = this.elements.editStockDate ? this.elements.editStockDate.value : '';

                    if (!isNaN(shares) && shares >= 0 && !isNaN(cost) && cost >= 0 && date) {
                        const firstBuyIndex = item.transactions.findIndex(t => t.type === 'buy');
                        if (firstBuyIndex > -1) {
                            item.transactions[firstBuyIndex].shares = shares;
                            item.transactions[firstBuyIndex].price = cost;
                            item.transactions[firstBuyIndex].date = new Date(date).toISOString();
                        }
                    }
                }

                await this.saveData();
                this.renderContent();
                this.closeEditStockModal();
                this.showSuccess(`✅ Details for ${item.symbol} saved.`);
            }

            // --- Price Alert Modals and Logic ---
            openPriceAlertModal(symbol) {
                if (!this.elements.priceAlertModal) return;
                this.elements.priceAlertModal.style.display = 'flex';
                this.elements.alertSymbol.textContent = symbol;
                this.elements.alertPrice.value = '';
                this.elements.alertCondition.value = 'above';
                this.elements.alertPriceLower.value = '';
                this.elements.alertPriceUpper.value = '';
                this.elements.alertType.value = 'single';
                this.toggleAlertInputs('single');
                this.elements.saveAlertBtn.dataset.symbol = symbol;
            }
            closePriceAlertModal() {
                 if (this.elements.priceAlertModal) this.elements.priceAlertModal.style.display = 'none';
            }
            toggleAlertInputs(type) {
                if(this.elements.singlePriceInputs) this.elements.singlePriceInputs.style.display = type === 'single' ? 'grid' : 'none';
                if(this.elements.priceRangeInputs) this.elements.priceRangeInputs.style.display = type === 'range' ? 'grid' : 'none';
            }
            async savePriceAlert() {
                const symbol = this.elements.saveAlertBtn ? this.elements.saveAlertBtn.dataset.symbol : null;
                const type = this.elements.alertType ? this.elements.alertType.value : 'single';
                let price, condition, priceLower, priceUpper;
                
                if (type === 'single') {
                    price = parseFloat(this.elements.alertPrice ? this.elements.alertPrice.value : 0);
                    condition = this.elements.alertCondition ? this.elements.alertCondition.value : 'above';
                    if (isNaN(price) || price <= 0) { this.showError("Please enter a valid target price."); return; }
                } else { // range
                    priceLower = parseFloat(this.elements.alertPriceLower ? this.elements.alertPriceLower.value : 0);
                    priceUpper = parseFloat(this.elements.alertPriceUpper ? this.elements.alertPriceUpper.value : 0);
                    if (isNaN(priceLower) || isNaN(priceUpper) || priceLower <= 0 || priceUpper <= 0 || priceLower >= priceUpper) { 
                        this.showError("Please enter a valid price range (Lower < Upper, both positive)."); return; 
                    }
                    condition = 'range';
                }

                const alert = {
                    id: crypto.randomUUID(),
                    symbol, type, condition,
                    price, priceLower, priceUpper,
                    triggered: false,
                    timestamp: new Date().toISOString()
                };

                this.priceAlerts.push(alert);
                await this.saveData();
                this.closePriceAlertModal();
                this.showSuccess(`🔔 Price alert for ${symbol} set!`);
            }
            checkPriceAlerts() {
                const allItems = [...this.stocks, ...this.mutualFunds, ...this.watchlist];
                const activeAlerts = this.priceAlerts.filter(a => !a.triggered);
                const triggeredAlerts = [];

                for (const alert of activeAlerts) {
                    const item = allItems.find(i => i.symbol === alert.symbol);
                    if (!item || item.price === 0) continue;

                    const currentPrice = item.price;
                    let shouldTrigger = false;

                    if (alert.type === 'single') {
                        if (alert.condition === 'above' && currentPrice > alert.price) shouldTrigger = true;
                        if (alert.condition === 'below' && currentPrice < alert.price) shouldTrigger = true;
                    } else if (alert.type === 'range') {
                        if (currentPrice >= alert.priceLower && currentPrice <= alert.priceUpper) shouldTrigger = true;
                    }

                    if (shouldTrigger) {
                        alert.triggered = true;
                        triggeredAlerts.push(alert);
                    }
                }

                if (triggeredAlerts.length > 0) {
                    this.triggerAlertNotification(triggeredAlerts);
                    this.saveData(); // Save the triggered state
                }
            }
            triggerAlertNotification(alerts) {
                if (!this.elements.alertNotification) return;

                const message = alerts.map(a => {
                    const priceInfo = a.type === 'single' 
                        ? `${a.condition.toUpperCase()} ${this.formatCurrency(a.price)}` 
                        : `IN RANGE [${this.formatCurrency(a.priceLower)} - ${this.formatCurrency(a.priceUpper)}]`;
                    return `${a.symbol} hit price ${priceInfo} at ${this.formatCurrency(this.stocks.find(i => i.symbol === a.symbol)?.price || 0)}`;
                }).join('; ');

                this.elements.alertNotification.innerHTML = `<h4>🔔 Price Alert!</h4><p>${message}</p>`;
                this.elements.alertNotification.style.display = 'block';
                setTimeout(() => { if(this.elements.alertNotification) this.elements.alertNotification.style.display = 'none'; }, 20000);
            }

            openAlertsSummaryModal() {
                 if (!this.elements.alertsSummaryModal) return;
                 this.elements.alertsSummaryModal.style.display = 'flex';
                 this.renderAlertsSummary();
            }

            renderAlertsSummary() {
                if (!this.elements.alertsSummaryContent) return;
                
                const active = this.priceAlerts.filter(a => !a.triggered).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
                const triggered = this.priceAlerts.filter(a => a.triggered).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
                
                let html = '<h4>Active Alerts:</h4>';
                if (active.length === 0) {
                    html += '<p style="color: var(--text-secondary); padding: 10px;">No active alerts set.</p>';
                } else {
                    active.forEach(a => {
                        const priceInfo = a.type === 'single' 
                            ? `${a.condition.toUpperCase()} ${this.formatCurrency(a.price)}` 
                            : `IN RANGE [${this.formatCurrency(a.priceLower)} - ${this.formatCurrency(a.priceUpper)}]`;
                        html += `
                            <div class="info-row" style="padding: 10px 0; border-bottom: 1px dashed var(--border-color);">
                                <span class="info-label">${a.symbol} (${priceInfo})</span>
                                <button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;" onclick="window.stockTracker.removeAlert('${a.id}')">Delete</button>
                            </div>
                        `;
                    });
                }

                html += '<h4 style="margin-top: 20px;">Triggered Alerts (History):</h4>';
                if (triggered.length === 0) {
                    html += '<p style="color: var(--text-secondary); padding: 10px;">No alerts have triggered yet.</p>';
                } else {
                    triggered.forEach(a => {
                        const priceInfo = a.type === 'single' 
                            ? `${a.condition.toUpperCase()} ${this.formatCurrency(a.price)}` 
                            : `IN RANGE [${this.formatCurrency(a.priceLower)} - ${this.formatCurrency(a.priceUpper)}]`;
                        html += `
                            <div class="info-row triggered-alert" style="padding: 10px 0; border-bottom: 1px dashed var(--border-color);">
                                <span class="info-label">${a.symbol} - TRG: ${priceInfo}</span>
                                <button class="btn btn-danger" style="padding: 5px 10px; font-size: 0.8rem;" onclick="window.stockTracker.removeAlert('${a.id}')">Delete</button>
                            </div>
                        `;
                    });
                }
                this.elements.alertsSummaryContent.innerHTML = html;
            }
            
            async removeAlert(id) {
                 this.openConfirmModal('Delete this price alert?', async () => {
                     this.priceAlerts = this.priceAlerts.filter(a => a.id !== id);
                     await this.saveData();
                     this.renderAlertsSummary();
                     this.showSuccess('Alert removed.');
                 });
            }

            // --- Session/Security Logic ---
            setupSessionListener() {
                if (!this.userId) return;
                const sessionDocRef = doc(db, "sessions", this.userId);
                
                // Set the current session ID on login (used for multi-device sign-out)
                try {
                    setDoc(sessionDocRef, { 
                        lastLogin: serverTimestamp(),
                        activeSession: this.sessionId,
                        userId: this.userId
                    }, { merge: true }).catch(err => console.error("Error writing session ID:", err));
                } catch (err) {
                    console.error("Error setting initial session doc (check rules):", err);
                }

                // Listen for changes to the activeSession field
                try {
                    this.sessionUnsubscribe = onSnapshot(sessionDocRef, (doc) => {
                        if (doc.exists() && doc.data().activeSession !== this.sessionId) {
                            // A different session has become the 'active' one (i.e., this session was signed out remotely)
                            this.showError("You have been signed out because a new session was started or an admin action was taken.");
                            this.signOut();
                        }
                    }, (error) => {
                        console.error("Error listening to session document:", error);
                    });
                } catch (err) {
                    console.error("Error setting up session listener (check rules):", err);
                }
            }
            async signOutOtherSessions() {
                if (!this.userId) return;
                 this.openConfirmModal("Are you sure you want to sign out all other devices? This session will remain active.", async () => {
                    const sessionDocRef = doc(db, "sessions", this.userId);
                    // Update the activeSession ID to the current one, which invalidates all others (as they are watching for a mismatch)
                    try {
                        await setDoc(sessionDocRef, { activeSession: this.sessionId, forceSignOut: Date.now() }, { merge: true });
                        this.showSuccess("All other sessions have been signed out.");
                    } catch (err) {
                         this.showError(`Failed to sign out other sessions. Check Firebase permissions.`);
                         console.error("Error signing out other sessions:", err);
                    }
                 });
            }
            
            // --- News Fetch ---
            async fetchAndRenderNews() {
                const container = this.elements.newsArticlesContainer;
                if (!container) return;

                const hasFinnhubKey = this.config.finnhubApiKey && this.config.finnhubApiKey !== 'YOUR_FINNHUB_API_KEY';
                const hasFmpKey = this.config.fmpApiKey && this.config.fmpApiKey !== 'YOUR_FMP_API_KEY';
                
                if (!hasFinnhubKey && !hasFmpKey) {
                    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: var(--color-negative);">
                        <p style="font-size: 1.1rem; font-weight: 600;">⚠️ API Keys Missing for News</p>
                        <p style="margin-top: 10px; color: var(--text-secondary);">Please enter your <strong>Finnhub</strong> and/or <strong>FMP</strong> API Keys in the <button class="btn-primary" style="display: inline-flex; margin: 0 5px;" onclick="window.stockTracker.openSettingsModal()">Settings</button> panel to enable real-time news updates.</p>
                    </div>`;
                    return;
                }

                const now = Date.now();
                // Check if news is older than 30 minutes (reduced refresh rate for API consumption)
                if (this.newsFeed.length === 0 || now - this.newsFetchTime > 1800000) {
                    this.showLoading(true, "Fetching latest news...");
                    
                    const portfolioSymbols = [...new Set([...this.stocks, ...this.mutualFunds].map(s => s.symbol))];
                    let newsSymbols = portfolioSymbols;
                    
                    if (portfolioSymbols.length === 0) {
                        // Fallback: If no stocks are added, use major indices/stocks for general market news
                        newsSymbols = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'GOOGL'];
                    }

                    // --- Fetch News for all symbols with Finnhub priority and FMP fallback ---
                    const newsPromises = newsSymbols.map(symbol => 
                        this.apiService.fetchSymbolNews(symbol).then(news => ({ symbol, news }))
                    );
                    
                    const newsResults = await Promise.all(newsPromises);
                    
                    // Aggregate and deduplicate the news articles
                    let combinedNews = newsResults.flatMap(result => result.news);
                    
                    // Use a Set to track URLs and deduplicate articles
                    const uniqueUrls = new Set();
                    this.newsFeed = combinedNews
                        .filter(article => {
                            if (uniqueUrls.has(article.url)) return false;
                            uniqueUrls.add(article.url);
                            return true;
                        })
                        .sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate)); // Sort newest first
                        
                    this.newsFetchTime = now;
                }
                this.showLoading(false);
                
                // Update title based on whether news is personalized or general
                const titleElement = document.querySelector('#news-tab .watchlist-title');
                let symbolsText = (this.stocks.length > 0 || this.mutualFunds.length > 0) ? 'Your Portfolio' : 'General Market';
                if (titleElement) {
                     titleElement.innerHTML = `📰 Top News for ${symbolsText}`;
                }

                container.innerHTML = this.newsFeed.map(article => `
                    <a href="${article.url}" target="_blank" class="news-article-card">
                        <img src="${article.image}" alt="${article.title}" onerror="this.onerror=null; this.src='https://placehold.co/80x80/6c757d/ffffff?text=News';">
                        <div class="news-article-content">
                            <h4>${article.title}</h4>
                            <p>${article.text}</p>
                            <span style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">Source: ${article.source} (${new Date(article.publishedDate).toLocaleDateString()}) - Priority: ${article.priority}</span>
                        </div>
                    </a>
                `).join('');
                
                if (this.newsFeed.length === 0) {
                     container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: var(--text-secondary);">No relevant news articles found at this time.</div>`;
                }
            }
        }
        
        // Expose instance globally for inline event handlers (essential for this pattern)
        window.stockTracker = new StockTracker();

    
