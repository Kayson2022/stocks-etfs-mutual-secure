/**
 * engine.js — v21
 * Global helpers required BEFORE index.html chart code executes.
 * Ensures window.getRgbColor() always exists.
 */

(function () {
    if (typeof window === "undefined") return;

    // ---- Global color parser for charts ----
    window.getRgbColor = window.getRgbColor || function (varName) {
        try {
            let raw = getComputedStyle(document.documentElement)
                .getPropertyValue(varName)
                .trim();

            if (!raw) return { r: 0, g: 0, b: 0 };

            const parts = raw.split(",").map(n => parseFloat(n.trim()));
            if (parts.length >= 3 && parts.every(n => !isNaN(n))) {
                return { r: parts[0], g: parts[1], b: parts[2] };
            }
        } catch (err) {
            console.warn("getRgbColor failed", varName, err);
        }
        return { r: 0, g: 0, b: 0 };
    };

    console.log("engine.js (v21) loaded successfully.");
})();
