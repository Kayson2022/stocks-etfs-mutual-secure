/**
 * engine.js - lightweight helpers for the portfolio app (v20)
 * - Currently: only provides a safe global getRgbColor helper for charts.
 * - All quote & mutual fund provider ordering logic now lives directly in index.html (ApiService).
 */

(function () {
    if (typeof window === "undefined") return;

    // Global helper to parse CSS custom properties like "--chart-fill-color-rgb"
    // and return an { r, g, b } object for Chart.js usage.
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

    console.log("engine.js helper loaded (v20: CSS colors only).");
})();
