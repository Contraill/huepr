"use strict";

const DEBUG = false;
const log   = (...a) => DEBUG && console.log(...a);

log('[huepr] content.js loaded', window.location.hostname);

// Registry of CSS variables injected into :root by Huepr.
// On each new theme, old entries are removed before new ones are set.
const activeVars = new Set();

let _transitionTimer = null;

function injectTransition() {
  if (document.getElementById("huepr-transition")) return;
  const style = document.createElement("style");
  style.id = "huepr-transition";
  style.textContent =
    "*, *::before, *::after { " +
    "transition: background-color 0.35s ease, color 0.25s ease, " +
    "border-color 0.25s ease, fill 0.25s ease !important; }";
  document.head.appendChild(style);
}

function removeTransition() {
  document.getElementById("huepr-transition")?.remove();
}

function applyCustomCSS(css) {
  const existing = document.getElementById("huepr-custom-css");
  if (!css) {
    existing?.remove();
    return;
  }
  const style = existing ?? document.createElement("style");
  style.id = "huepr-custom-css";
  style.textContent = css;
  if (!existing) document.head.appendChild(style);
}

function applyTheme(cssVars, managedVars = [], customCSS = "") {
  const root = document.documentElement;

  // Remove previous huepr variables (tracked + explicitly managed)
  for (const prop of activeVars) root.style.removeProperty(prop);
  for (const prop of managedVars) root.style.removeProperty(prop);
  activeVars.clear();

  // Always sync custom CSS (clears it when cssVars is empty too)
  applyCustomCSS(customCSS);

  if (!Object.keys(cssVars).length) return;

  // Smooth transition: inject rule, apply vars, then remove rule after 600ms
  injectTransition();
  clearTimeout(_transitionTimer);
  _transitionTimer = setTimeout(removeTransition, 600);

  // Inject new variables
  for (const [prop, value] of Object.entries(cssVars)) {
    root.style.setProperty(prop, value);
    activeVars.add(prop);
  }
}

// Listen for theme pushes and detect_vars requests from background.js
browser.runtime.onMessage.addListener((msg) => {
  log('[huepr] message received', msg);
  if (msg.type === "apply_theme") {
    applyTheme(msg.cssVars ?? {}, msg.managedVars ?? [], msg.customCSS ?? "");
    log('[huepr] theme applied', msg);
  }
  if (msg.type === "detect_vars") {
    const vars = new Set();
    // Method 1: Parse inline <style> tags via textContent — no CORS issues.
    // Catches vars injected by JS frameworks (Polymer, etc.) that use <style> tags.
    document.querySelectorAll("style").forEach(el => {
      for (const m of el.textContent.matchAll(/--[\w-]+/g)) vars.add(m[0]);
    });
    // Method 2: Accessible external stylesheets (same-origin or CORS-enabled).
    [...document.styleSheets].forEach(sheet => {
      try {
        [...sheet.cssRules].forEach(rule => {
          if (rule.style) [...rule.style]
            .filter(p => p.startsWith("--"))
            .forEach(p => vars.add(p));
        });
      } catch {}
    });
    return Promise.resolve({ type: "vars_detected", vars: [...vars].sort() });
  }
});

// Request current theme on page load
// (handles extension restart or user navigating to a whitelisted page)
browser.runtime.sendMessage({ type: "get_theme" })
  .then((resp) => {
    if (resp?.type === "apply_theme") {
      applyTheme(resp.cssVars ?? {}, resp.managedVars ?? [], resp.customCSS ?? "");
    }
  })
  .catch(() => { /* not ready or not whitelisted */ });
