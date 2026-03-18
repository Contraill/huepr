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
  sel.innerHTML = status.themes
    .map(n => `<option value="${n}"${n === status.manualTheme ? " selected" : ""}>${n}</option>`)
    .join("");

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

  // Add current site button
  document.getElementById("btn-add-site").addEventListener("click", async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) { toast("No active tab", "err"); return; }

    let host;
    try {
      const h = new URL(tab.url).hostname;
      host = h.startsWith("www.") ? h.slice(4) : h;
    } catch {
      toast("Invalid tab URL", "err");
      return;
    }

    if (!host) { toast("No hostname", "err"); return; }

    const { whitelist, mappings } = await browser.storage.local.get({
      whitelist: [], mappings: {},
    });

    if (whitelist.includes(host)) {
      toast(`${host} already added`);
      return;
    }

    whitelist.push(host);
    if (!mappings[host]) mappings[host] = {};
    await browser.storage.local.set({ whitelist, mappings });
    toast(`Added ${host}`);
  });

  // Open Options button
  document.getElementById("btn-options").addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });
})();
