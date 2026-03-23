"use strict";

const DEBUG = false;
const log   = (...a) => DEBUG && console.log(...a);

const NATIVE_HOST = "com.huepr.theme_host";

// ── Default data (written to storage on first install) ────────────────────────

const DEFAULT_WHITELIST = [];

// Bundled theme presets. Storage themes override individual variables —
// a user theme with only --theme-bg still inherits the rest from here.
const DEFAULT_THEMES = {
  "Aurora": {
    "--theme-bg":      "#1e1e2e",
    "--theme-fg":      "#cdd6f4",
    "--theme-accent":  "#cba6f7",
    "--theme-surface": "#313244",
    "--theme-border":  "#45475a",
    "--theme-red":     "#f38ba8",
    "--theme-green":   "#a6e3a1",
    "--theme-yellow":  "#f9e2af",
    "--theme-blue":    "#89b4fa",
  },
  "Sunset": {
    "--theme-bg":      "#1a1a2e",
    "--theme-fg":      "#e2e2e2",
    "--theme-accent":  "#e94560",
    "--theme-surface": "#16213e",
    "--theme-border":  "#0f3460",
    "--theme-red":     "#e94560",
    "--theme-green":   "#4ecca3",
    "--theme-yellow":  "#f5a623",
    "--theme-blue":    "#4fc3f7",
  },
  "Latte": {
    "--theme-bg":      "#eff1f5",
    "--theme-fg":      "#4c4f69",
    "--theme-accent":  "#8839ef",
    "--theme-surface": "#e6e9ef",
    "--theme-border":  "#ccd0da",
    "--theme-red":     "#d20f39",
    "--theme-green":   "#40a02b",
    "--theme-yellow":  "#df8e1d",
    "--theme-blue":    "#1e66f5",
  },
  "Frappe": {
    "--theme-bg":      "#303446",
    "--theme-fg":      "#c6d0f5",
    "--theme-accent":  "#ca9ee6",
    "--theme-surface": "#414559",
    "--theme-border":  "#51576d",
    "--theme-red":     "#e78284",
    "--theme-green":   "#a6d189",
    "--theme-yellow":  "#e5c890",
    "--theme-blue":    "#8caaee",
  },
};

// ── State ─────────────────────────────────────────────────────────────────────

let port             = null;
let currentWallpaper = null;
let _retries         = 0;
const MAX_RETRIES    = 10;
let _applyDebounce   = null;

// ── Storage ───────────────────────────────────────────────────────────────────

// Read config from storage, merging DEFAULT_THEMES as base per theme.
async function getConfig() {
  const data = await browser.storage.local.get({
    whitelist:   DEFAULT_WHITELIST,
    mappings:    {},
    hookEnabled: true,
    themes:      {},
    siteThemes:  {},
    siteCSS:     {},
  });

  // Merge DEFAULT_THEMES as base: storage vars override defaults per theme.
  // A storage theme with only --theme-bg still inherits the rest from
  // DEFAULT_THEMES if available.
  const themes = {};
  const allNames = new Set([
    ...Object.keys(DEFAULT_THEMES),
    ...Object.keys(data.themes),
  ]);
  for (const name of allNames) {
    themes[name] = {
      ...(DEFAULT_THEMES[name] ?? {}),
      ...(data.themes[name]  ?? {}),
    };
  }

  return { ...data, themes };
}

// ── Native Messaging — persistent connection ──────────────────────────────────

// Connect to the native messaging host. Retries up to MAX_RETRIES times
// (5s apart) on failure or disconnect.
function connectNative() {
  log('[huepr] connectNative calling...');
  try {
    port = browser.runtime.connectNative(NATIVE_HOST);
    log('[huepr] connectNative called', port);
  } catch (err) {
    console.error("[huepr] connectNative failed:", err);
    if (_retries++ < MAX_RETRIES) setTimeout(connectNative, 5000);
    else console.error('[huepr] native host connection failed, giving up.');
    return;
  }

  // Wallpaper change flow: theme_host.py → NM message → update currentWallpaper
  // → debounced applyThemeToAllTabs (100ms, shared timer with storage.onChanged).
  port.onMessage.addListener(async (msg) => {
    _retries = 0;
    log('[huepr] NM message received:', msg.type, msg.wallpaper ?? '');
    if (msg.type !== "wallpaper_change" || !msg.wallpaper) return;
    const { hookEnabled } = await browser.storage.local.get({ hookEnabled: true });
    if (!hookEnabled) return;
    currentWallpaper = msg.wallpaper;
    clearTimeout(_applyDebounce);
    _applyDebounce = setTimeout(() => applyThemeToAllTabs(), 100);
  });

  port.onDisconnect.addListener(() => {
    const err = browser.runtime.lastError;
    console.warn("[huepr] host disconnected:", err?.message ?? "unknown");
    port = null;
    if (_retries++ < MAX_RETRIES) setTimeout(connectNative, 5000);
    else console.error('[huepr] native host connection failed, giving up.');
  });
}

// ── CSS Variable Resolution ───────────────────────────────────────────────────

/**
 * Layer 1 (theme) + Layer 2 (siteMappings) → final map to inject.
 *
 * theme        = { "--theme-bg": "#1e1e2e" }
 * siteMappings = { "--color-canvas-default": "--theme-bg" }
 * result       = { "--color-canvas-default": "#1e1e2e" }
 */
function resolveVars(theme, siteMappings) {
  const out = {};
  for (const [siteVar, themeVar] of Object.entries(siteMappings)) {
    const value = theme[themeVar];
    if (value !== undefined) out[siteVar] = value;
  }
  return out;
}

// Pick the effective theme for a host (site override or current wallpaper),
// resolve site var mappings against it, and return cssVars + customCSS.
function resolveForHost(host, mappings, themes, siteThemes = {}, siteCSS = {}) {
  const hostMappings = mappings[host] ?? {};
  const effectiveThemeName = siteThemes[host] || currentWallpaper;
  const theme = themes[effectiveThemeName];
  const cssLines = siteCSS[host];
  return {
    cssVars:     theme ? { ...theme, ...resolveVars(theme, hostMappings) } : {},
    managedVars: [...Object.keys(theme ?? {}), ...Object.keys(hostMappings)],
    customCSS:   theme && Array.isArray(cssLines) ? cssLines.join("\n") : "",
  };
}

// ── Theme Application ─────────────────────────────────────────────────────────

// Push the current theme to every whitelisted tab.
async function applyThemeToAllTabs() {
  if (!currentWallpaper) return;
  const { whitelist, mappings, themes, siteThemes, siteCSS } = await getConfig();
  log('[huepr] applyThemeToAllTabs, whitelist:', whitelist);
  const tabs = await browser.tabs.query({});

  for (const tab of tabs) {
    const host = hostnameOf(tab.url);
    log('[huepr] tab check:', tab.url, '→ host:', host, '→ listed:', whitelist.includes(host ?? ''));
    if (!host || !whitelist.includes(host)) continue;
    const { cssVars, managedVars, customCSS } = resolveForHost(host, mappings, themes, siteThemes, siteCSS);
    log('[huepr] sending:', host, cssVars);
    browser.tabs.sendMessage(tab.id, { type: "apply_theme", cssVars, managedVars, customCSS }).catch((e) => {
      console.warn('[huepr] sendMessage error:', host, e.message);
    });
  }
}

// Push the current theme to a single tab (used on tab load/activate).
async function applyThemeToTab(tabId, url) {
  if (!currentWallpaper) return;
  const { whitelist, mappings, themes, siteThemes, siteCSS } = await getConfig();
  const host = hostnameOf(url);
  log('[huepr] applyThemeToTab:', url, '→ host:', host, '→ listed:', whitelist.includes(host ?? ''));
  if (!host || !whitelist.includes(host)) return;
  const { cssVars, managedVars, customCSS } = resolveForHost(host, mappings, themes, siteThemes, siteCSS);
  log('[huepr] sending:', host, cssVars);
  browser.tabs.sendMessage(tabId, { type: "apply_theme", cssVars, managedVars, customCSS }).catch((e) => {
    console.warn('[huepr] sendMessage error:', host, e.message);
  });
}

async function applyManualTheme(themeName) {
  currentWallpaper = themeName;
  await applyThemeToAllTabs();
}

// ── Event Listeners ───────────────────────────────────────────────────────────

// content.js requests current theme on page load; popup requests status
browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === "get_status") {
    const { hookEnabled, manualTheme, themes } = await browser.storage.local.get({
      hookEnabled: true,
      manualTheme: null,
      themes:      {},
    });
    return {
      currentWallpaper,
      hookEnabled,
      manualTheme,
      themes: Object.keys({ ...DEFAULT_THEMES, ...themes }),
    };
  }

  if (msg.type === "detect_vars") {
    const { hostname } = msg;
    const tabs = await browser.tabs.query({});
    const tab = tabs.find(t => {
      try { return hostnameOf(t.url) === hostname; } catch { return false; }
    });
    if (!tab) return { type: "vars_detected", vars: [], noTab: true };
    try {
      return await browser.tabs.sendMessage(tab.id, { type: "detect_vars" });
    } catch {
      return { type: "vars_detected", vars: [], noTab: true };
    }
  }

  if (msg.type === "add_site") {
    const { hostname } = msg;
    const { whitelist, mappings } = await browser.storage.local.get({
      whitelist: [], mappings: {},
    });
    if (!whitelist.includes(hostname)) {
      whitelist.push(hostname);
      if (!mappings[hostname]) mappings[hostname] = {};
      await browser.storage.local.set({ whitelist, mappings });
    }
    return { added: whitelist.includes(hostname) };
  }

  if (msg.type !== "get_theme") return;
  if (!currentWallpaper || !sender.tab?.url) return;

  const { whitelist, mappings, themes, siteThemes, siteCSS } = await getConfig();
  const host = hostnameOf(sender.tab.url);
  if (!host || !whitelist.includes(host)) return;

  const { cssVars, managedVars, customCSS } = resolveForHost(host, mappings, themes, siteThemes, siteCSS);
  return { type: "apply_theme", cssVars, managedVars, customCSS };
});

// Re-apply theme when a tab finishes loading
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    applyThemeToTab(tabId, tab.url);
  }
});

// Re-apply theme when switching to an already-open whitelisted tab
browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await browser.tabs.get(tabId);
  if (tab.url) applyThemeToTab(tabId, tab.url);
});

// Re-apply when config changes in options. Debounced (100ms) to prevent
// hammering tabs during rapid saves (e.g. typing in custom CSS textarea).
browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.manualTheme) {
    const { hookEnabled } = await browser.storage.local.get({ hookEnabled: true });
    if (!hookEnabled && changes.manualTheme.newValue) {
      currentWallpaper = changes.manualTheme.newValue;
    }
  }
  if (changes.mappings || changes.whitelist || changes.themes || changes.siteThemes || changes.siteCSS || changes.manualTheme) {
    clearTimeout(_applyDebounce);
    _applyDebounce = setTimeout(() => applyThemeToAllTabs(), 100);
  }
});


// ── Helpers ───────────────────────────────────────────────────────────────────

function hostnameOf(url) {
  try {
    const h = new URL(url).hostname;
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch { return null; }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

connectNative();
