"use strict";

(function exposeQlexTheme(root, factory) {
    const api = factory(root?.TokenMonitorGlassRendering);
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.QlexTheme = api;
})(typeof window !== "undefined" ? window : globalThis, function createQlexTheme(glassRendering) {
    const PRESETS = {
        default: {
            id: "default",
            name: "石墨毛玻璃",
            accent: "#b7ead4",
            accentRgb: "183, 234, 212",
            chart: "#73bdf5",
            bg: "#303438",
            bgRgb: "48, 52, 56",
            text: "#eef5fb",
            muted: "#a3adbb",
            light: false,
        },
        obsidian: {
            id: "obsidian",
            name: "曜石深空",
            accent: "#e6e8ec",
            accentRgb: "230, 232, 236",
            chart: "#73bdf5",
            bg: "#0b0c0e",
            bgRgb: "11, 12, 14",
            text: "#eceef2",
            muted: "#8f949c",
            light: false,
        },
        porcelain: {
            id: "porcelain",
            name: "瓷白浅雾",
            accent: "#2563eb",
            accentRgb: "37, 99, 235",
            chart: "#2563eb",
            bg: "#f6f7f9",
            bgRgb: "246, 247, 249",
            text: "#1c1f26",
            muted: "#5b626d",
            light: true,
        },
    };

    const SOURCE_COLORS = {
        antigravity: "#73bdf5",
        codex: "#b7ead4",
        claude: "#f4a073",
        hermes: "#b394f4",
        dsh: "#f1d973",
        workbuddy: "#5eead4",
        zcode: "#f9a8d4",
        t3code: "#93c5fd",
    };

    function applyAppearance(appearance = {}, rootEl = document.documentElement, bodyEl = document.body) {
        const preset = PRESETS[appearance.themePreset] || PRESETS.default;
        const opacity = glassRendering
            ? glassRendering.renderedGlassOpacity(appearance, { platform: "darwin" })
            : Math.max(0.15, Math.min(1, Number(appearance.glassOpacity ?? 68) / 100));

        const vars = {
            "--glass-rgb": preset.bgRgb,
            "--glass-alpha": String(opacity),
            "--accent": preset.accent,
            "--accent-rgb": preset.accentRgb,
            "--chart-color": preset.chart,
            "--text": preset.text,
            "--number": preset.text,
            "--muted": preset.muted,
            "--overlay-rgb": preset.light ? "15, 18, 24" : "255, 255, 255",
            "--line-rgb": preset.light ? "24, 28, 36" : "232, 238, 244",
            "--panel-rgb": preset.light ? "255, 255, 255" : "16, 21, 30",
            "--sunken-rgb": preset.light ? "188, 196, 206" : "4, 8, 13",
            "--success": preset.light ? "#18794e" : "#b7ead4",
            "--success-rgb": preset.light ? "24, 121, 78" : "183, 234, 212",
            "color-scheme": preset.light ? "light" : "dark",
        };
        for (const [k, v] of Object.entries(vars)) {
            rootEl.style.setProperty(k, v);
        }
        rootEl.classList.toggle("system-glass-disabled", appearance.systemGlass === false);
        bodyEl?.classList.toggle("light-theme", preset.light);
        return preset;
    }

    function applyNativeMaterial(material, rootEl = document.documentElement, bodyEl = document.body) {
        if (!material) return null;
        if (glassRendering) {
            return glassRendering.applyNativeMaterialClasses(material, rootEl, bodyEl);
        }
        for (const node of [rootEl, bodyEl]) {
            if (!node) continue;
            node.classList.toggle("native-liquid-glass", material.type === "liquid-glass");
            node.classList.toggle("native-material-opaque", material.type === "opaque");
            node.classList.toggle("native-reduced-transparency", Boolean(material.reducedTransparency));
            node.classList.toggle("native-high-contrast", Boolean(material.highContrast));
        }
        return material;
    }

    return { PRESETS, SOURCE_COLORS, applyAppearance, applyNativeMaterial };
});
