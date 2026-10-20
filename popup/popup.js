"use strict";

let _toastTimer = null;

function toast(msg, type = "ok") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className   = `show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ""; }, 2200);
}

// ── Init ──────────────────────────────────────────────────────────────────────
// On load: fetch status from background.js (wallpaper, hook state, theme list),
// populate the UI, and wire up event listeners.

(async () => {
  const status = await browser.runtime.sendMessage({ type: "get_status" });

  // Wallpaper name
  document.getElementById("wallpaper-name").textContent =
    status.currentWallpaper ?? "no wallpaper";

  // Hook toggle
  const chk = document.getElementById("chk-hook");
  const manualRow = document.getElementById("manual-row");
  const sel = document.getElementById("theme-select");

  chk.checked = status.hookEnabled;
  manualRow.style.display = status.hookEnabled ? "none" : "";

  // Populate theme select
  sel.replaceChildren(...status.themes.map(n => new Option(n, n, false, n === status.manualTheme)));

  // Hook toggle: writing hookEnabled to storage triggers background.js
  // storage.onChanged, which debounces a re-apply to all tabs.
  chk.addEventListener("change", async () => {
    await browser.storage.local.set({ hookEnabled: chk.checked });
    manualRow.style.display = chk.checked ? "none" : "";
  });

  // Manual theme select listener
  sel.addEventListener("change", async () => {
    await browser.storage.local.set({ manualTheme: sel.value });
  });

  // Add current site button. The active tab is looked up before the click:
  // permissions.request() must run directly in the click handler.
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  let host = null;
  try {
    const u = new URL(tab?.url ?? "");
    if (/^https?:$/.test(u.protocol)) host = u.hostname.replace(/^www\./, "");
  } catch { /* not a web page */ }

  document.getElementById("btn-add-site").addEventListener("click", async () => {
    if (!host) { toast("Not a web page", "err"); return; }
    // The popup may close while the prompt is open; background.js then
    // whitelists the site when the permission is granted.
    const granted = await browser.permissions.request({
      origins: [`*://${host}/*`, `*://www.${host}/*`],
    });
    if (!granted) { toast("Site access not granted", "err"); return; }
    await browser.runtime.sendMessage({ type: "add_site", hostname: host });
    toast(`Added ${host}`);
  });

  // Open Options button
  document.getElementById("btn-options").addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });
})();
