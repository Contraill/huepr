"use strict";

// ── State ────────────────────────────────────────────────────────────────────

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

const state = {
  whitelist:    [],
  mappings:     {},   // { hostname: { siteVar: themeVar } }
  themes:       {},   // { themeName: { cssVar: hexValue } }
  siteThemes:   {},   // { hostname: themeName | "" }
  themeCSS:     {},   // { themeName: css string }
  selectedSite:  null,
  selectedTheme: null,
  activeTab:    "sites",
};

// ── Storage ──────────────────────────────────────────────────────────────────

async function load() {
  const data = await browser.storage.local.get({
    whitelist: [], mappings: {}, themes: {}, siteThemes: {}, themeCSS: {}
  });
  state.whitelist   = data.whitelist;
  state.mappings    = data.mappings;
  state.themes      = data.themes;
  state.siteThemes  = data.siteThemes;
  state.themeCSS    = data.themeCSS;
}

async function save() {
  await browser.storage.local.set({
    whitelist:  state.whitelist,
    mappings:   state.mappings,
    themes:     state.themes,
    siteThemes: state.siteThemes,
    themeCSS:   state.themeCSS,
  });
}

// ── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;

function toast(msg, type = "ok") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className   = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = "", 2400);
}

// ── Tab ──────────────────────────────────────────────────────────────────────

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach(p => {
    p.classList.toggle("active", p.id === `tab-${name}`);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
          .replace(/"/g,"&quot;");
}

function populateThemeSelect(sel, current) {
  sel.innerHTML = Object.keys(state.themes)
    .map(n => `<option value="${esc(n)}"${n === current ? " selected" : ""}>${esc(n)}</option>`)
    .join("");
}

function allThemeVars() {
  const vars = new Set();
  for (const t of Object.values(state.themes))
    for (const k of Object.keys(t)) vars.add(k);
  return [...vars].sort();
}

// ════════════════════════════════════════════════════════════════════════════
// SITES & MAPPINGS tab
// ════════════════════════════════════════════════════════════════════════════

// ── Site List ────────────────────────────────────────────────────────────────

function renderSiteList() {
  const ul = document.getElementById("site-list");
  ul.innerHTML = "";

  if (!state.whitelist.length) {
    ul.innerHTML = `<li class="empty">No sites added yet</li>`;
    return;
  }

  for (const site of state.whitelist) {
    const count = Object.keys(state.mappings[site] ?? {}).length;
    const li = document.createElement("li");
    li.className = "list-item" + (site === state.selectedSite ? " selected" : "");
    li.innerHTML = `
      <span class="name">${esc(site)}</span>
      <span class="badge">${count}v</span>
      <button class="btn-icon" data-del-site="${esc(site)}" title="Remove">✕</button>
    `;
    li.addEventListener("click", e => {
      if (e.target.closest("[data-del-site]")) return;
      selectSite(site);
    });
    li.querySelector("[data-del-site]").addEventListener("click", e => {
      e.stopPropagation();
      removeSite(site);
    });
    ul.appendChild(li);
  }
}

function selectSite(site) {
  state.selectedSite = site;
  renderSiteList();
  renderMappings();
}

async function addSite() {
  const inp = document.getElementById("new-site-input");
  const raw = inp.value.trim().toLowerCase()
    .replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!raw) return;
  if (state.whitelist.includes(raw)) { toast(`${raw} already added`, "err"); return; }
  state.whitelist.push(raw);
  if (!state.mappings[raw]) state.mappings[raw] = {};
  await save();
  inp.value = "";
  renderSiteList();
  selectSite(raw);
  toast(`Added ${raw}`);
}

async function removeSite(site) {
  state.whitelist = state.whitelist.filter(s => s !== site);
  delete state.mappings[site];
  await save();
  if (state.selectedSite === site) {
    state.selectedSite = null;
    renderMappings();
  }
  renderSiteList();
  toast(`Removed ${site}`);
}

// ── Mapping Table ────────────────────────────────────────────────────────────

function renderMappings() {
  const empty   = document.getElementById("mappings-empty");
  const content = document.getElementById("mappings-content");
  const head    = document.getElementById("mappings-head");
  const siteName = document.getElementById("mappings-site-name");

  const detectBtn = document.getElementById("btn-detect");

  if (!state.selectedSite) {
    empty.style.display   = "";
    content.style.display = "none";
    head.textContent = "CSS Variable Mappings";
    detectBtn.style.display = "none";
    return;
  }

  empty.style.display   = "none";
  content.style.display = "";
  head.textContent      = `Mappings — ${state.selectedSite}`;
  siteName.textContent  = state.selectedSite;
  detectBtn.style.display = "";

  // Theme override select
  const overrideSel = document.getElementById("site-theme-override");
  const currentOverride = state.siteThemes[state.selectedSite] ?? "";
  overrideSel.innerHTML =
    `<option value="">— Follow wallpaper —</option>` +
    Object.keys(state.themes).map(n =>
      `<option value="${esc(n)}"${n === currentOverride ? " selected" : ""}>${esc(n)}</option>`
    ).join("");
  overrideSel.value = currentOverride;

  // Refresh theme-var datalist for the autocomplete input
  const dl = document.getElementById("theme-var-list");
  dl.innerHTML = allThemeVars().map(v => `<option value="${esc(v)}">`).join("");

  renderMappingTable();
}

function renderMappingTable() {
  const tbody = document.getElementById("mapping-tbody");
  tbody.innerHTML = "";
  const entries = Object.entries(state.mappings[state.selectedSite] ?? {});

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="color:var(--overlay);text-align:center;
      padding:14px 8px;font-size:12px">No mappings yet</td></tr>`;
    return;
  }

  for (const [siteVar, themeVar] of entries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="chip" title="${esc(siteVar)}">${esc(siteVar)}</span></td>
      <td style="color:var(--overlay);text-align:center">→</td>
      <td><span class="chip" title="${esc(themeVar)}">${esc(themeVar)}</span></td>
      <td>
        <button class="btn-icon" style="color:var(--accent)" data-edit title="Edit">✎</button>
        <button class="btn-icon" data-del title="Remove">✕</button>
      </td>
    `;

    tr.querySelector("[data-edit]").addEventListener("click", () => {
      tr.innerHTML = `
        <td><input type="text" class="mono" value="${esc(siteVar)}" /></td>
        <td style="color:var(--overlay);text-align:center">→</td>
        <td><input type="text" class="mono" value="${esc(themeVar)}" list="theme-var-list" /></td>
        <td>
          <button class="btn-icon" style="color:var(--accent)" data-save title="Save">✓</button>
          <button class="btn-icon" data-cancel title="Cancel">✕</button>
        </td>
      `;
      tr.querySelector("[data-save]").addEventListener("click", async () => {
        const inputs     = tr.querySelectorAll("input");
        const newSiteVar  = inputs[0].value.trim();
        const newThemeVar = inputs[1].value.trim();
        if (!newSiteVar || !newThemeVar) { toast("Fill in both fields", "err"); return; }
        if (!newSiteVar.startsWith("--") || !newThemeVar.startsWith("--")) {
          toast("CSS variables must start with --", "err"); return;
        }
        const m = state.mappings[state.selectedSite];
        delete m[siteVar];
        m[newSiteVar] = newThemeVar;
        await save();
        renderMappingTable();
        renderSiteList();
      });
      tr.querySelector("[data-cancel]").addEventListener("click", () => renderMappingTable());
    });

    tr.querySelector("[data-del]").addEventListener("click", () => removeMapping(siteVar));
    tbody.appendChild(tr);
  }
}

async function addMapping() {
  const siteVarEl  = document.getElementById("new-map-site");
  const themeVarEl = document.getElementById("new-map-theme");
  const siteVar    = siteVarEl.value.trim();
  const themeVar   = themeVarEl.value.trim();

  if (!siteVar || !themeVar) { toast("Fill in both fields", "err"); return; }
  if (!siteVar.startsWith("--") || !themeVar.startsWith("--")) {
    toast("CSS variables must start with --", "err"); return;
  }

  state.mappings[state.selectedSite] ??= {};
  state.mappings[state.selectedSite][siteVar] = themeVar;
  await save();
  siteVarEl.value = themeVarEl.value = "";
  renderMappingTable();
  renderSiteList();
  toast(`${siteVar} → ${themeVar}`);
}

async function removeMapping(siteVar) {
  delete state.mappings[state.selectedSite]?.[siteVar];
  await save();
  renderMappingTable();
  renderSiteList();
  toast(`Removed ${siteVar}`);
}

// ════════════════════════════════════════════════════════════════════════════
// THEMES tab
// ════════════════════════════════════════════════════════════════════════════

// ── Theme List ───────────────────────────────────────────────────────────────

function renderThemeList() {
  const ul = document.getElementById("theme-list");
  ul.innerHTML = "";
  const names = Object.keys(state.themes);

  if (!names.length) {
    ul.innerHTML = `<li class="empty">No themes yet</li>`;
    return;
  }

  const SWATCH_VARS = ["--theme-bg", "--theme-fg", "--theme-accent", "--theme-surface"];

  for (const name of names) {
    const vars  = state.themes[name];
    const count = Object.keys(vars).length;
    const dots  = SWATCH_VARS
      .filter(v => vars[v])
      .map(v => `<span class="theme-dot" style="background:${esc(vars[v])}" title="${esc(v)}"></span>`)
      .join("");
    const li = document.createElement("li");
    li.className = "list-item" + (name === state.selectedTheme ? " selected" : "");
    li.innerHTML = `
      <span class="name">${esc(name)}</span>
      <span class="theme-dots">${dots}</span>
      <span class="badge">${count}v</span>
      <button class="btn-icon" data-del-theme="${esc(name)}" title="Remove">✕</button>
    `;
    li.addEventListener("click", e => {
      if (e.target.closest("[data-del-theme]")) return;
      selectTheme(name);
    });
    li.querySelector("[data-del-theme]").addEventListener("click", e => {
      e.stopPropagation();
      removeTheme(name);
    });
    ul.appendChild(li);
  }
}

function selectTheme(name) {
  state.selectedTheme = name;
  renderThemeList();
  renderThemeVars();
}

async function addTheme() {
  const inp  = document.getElementById("new-theme-name");
  const name = inp.value.trim();
  if (!name) return;
  if (state.themes[name]) { toast(`"${name}" already exists`, "err"); return; }
  state.themes[name] = {};
  await save();
  inp.value = "";
  renderThemeList();
  selectTheme(name);
  toast(`Theme "${name}" created`);
}

async function removeTheme(name) {
  delete state.themes[name];
  await save();
  if (state.selectedTheme === name) {
    state.selectedTheme = null;
    renderThemeVars();
  }
  renderThemeList();
  toast(`Removed theme "${name}"`);
}

// ── Theme Vars Table ─────────────────────────────────────────────────────────

function renderThemeVars() {
  const empty   = document.getElementById("theme-vars-empty");
  const content = document.getElementById("theme-vars-content");
  const head    = document.getElementById("theme-vars-head");
  const title   = document.getElementById("theme-vars-title");

  const extractBtn = document.getElementById("btn-extract");

  if (!state.selectedTheme) {
    empty.style.display   = "";
    content.style.display = "none";
    head.textContent = "Theme Variables";
    extractBtn.style.display = "none";
    return;
  }

  empty.style.display   = "none";
  content.style.display = "";
  head.textContent      = `Variables — ${state.selectedTheme}`;
  title.textContent     = state.selectedTheme;
  extractBtn.style.display = "";
  document.getElementById("theme-custom-css").value = state.themeCSS[state.selectedTheme] ?? "";
  renderThemeVarsTable();
}

function renderThemeVarsTable() {
  const tbody  = document.getElementById("theme-vars-tbody");
  tbody.innerHTML = "";
  const entries = Object.entries(state.themes[state.selectedTheme] ?? {});

  if (!entries.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--overlay);text-align:center;
      padding:14px 8px;font-size:12px">No variables yet</td></tr>`;
    return;
  }

  for (const [varName, value] of entries) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="chip">${esc(varName)}</span></td>
      <td>
        <div class="color-cell">
          <span class="swatch" style="background:${esc(value)}"></span>
          <span class="chip">${esc(value)}</span>
        </div>
      </td>
      <td>
        <button class="btn-icon" style="color:var(--accent)" data-edit title="Edit">✎</button>
        <button class="btn-icon" data-del-var="${esc(varName)}" title="Remove">✕</button>
      </td>
    `;
    tr.querySelector("[data-edit]").addEventListener("click", () => {
      tr.innerHTML = `
        <td><input type="text" class="mono" value="${esc(varName)}" /></td>
        <td>
          <div class="color-cell">
            <input type="color" value="${esc(value)}" style="width:28px;height:24px;padding:0;border:none;cursor:pointer" />
            <input type="text" class="mono" value="${esc(value)}" style="width:80px" />
          </div>
        </td>
        <td>
          <button class="btn-icon" style="color:var(--accent)" data-save title="Save">✓</button>
          <button class="btn-icon" data-cancel title="Cancel">✕</button>
        </td>
      `;
      const nameInput   = tr.querySelector("td:first-child input");
      const pickerInput = tr.querySelector("input[type='color']");
      const hexInput    = tr.querySelector("input[type='text']:last-of-type");
      pickerInput.addEventListener("input", () => { hexInput.value = pickerInput.value; });
      hexInput.addEventListener("input", () => {
        if (HEX_RE.test(hexInput.value)) pickerInput.value = hexInput.value;
      });
      tr.querySelector("[data-save]").addEventListener("click", async () => {
        const newName  = nameInput.value.trim();
        const newValue = hexInput.value.trim() || pickerInput.value;
        if (!newName) { toast("Enter a variable name", "err"); return; }
        if (!newName.startsWith("--")) { toast("Variable must start with --", "err"); return; }
        if (!HEX_RE.test(newValue)) { toast("Enter a valid hex color", "err"); return; }
        const t = state.themes[state.selectedTheme];
        delete t[varName];
        t[newName] = newValue;
        await save();
        renderThemeVarsTable();
        renderThemeList();
        const dl = document.getElementById("theme-var-list");
        dl.innerHTML = allThemeVars().map(v => `<option value="${esc(v)}">`).join("");
      });
      tr.querySelector("[data-cancel]").addEventListener("click", () => renderThemeVarsTable());
    });
    tr.querySelector("[data-del-var]").addEventListener("click", () => removeThemeVar(varName));
    tbody.appendChild(tr);
  }
}

async function addThemeVar() {
  const nameEl   = document.getElementById("new-var-name");
  const hexEl    = document.getElementById("new-var-hex");
  const pickerEl = document.getElementById("new-var-picker");

  const varName = nameEl.value.trim();
  const value   = hexEl.value.trim() || pickerEl.value;

  if (!varName) { toast("Enter a variable name", "err"); return; }
  if (!varName.startsWith("--")) { toast("Variable must start with --", "err"); return; }
  if (!HEX_RE.test(value)) { toast("Enter a valid hex color", "err"); return; }

  state.themes[state.selectedTheme] ??= {};
  state.themes[state.selectedTheme][varName] = value;
  await save();
  nameEl.value = hexEl.value = "";
  pickerEl.value = "#cba6f7";
  renderThemeVarsTable();
  renderThemeList();
  // Keep theme-var datalist in Mappings tab in sync
  const dl = document.getElementById("theme-var-list");
  dl.innerHTML = allThemeVars().map(v => `<option value="${esc(v)}">`).join("");
  toast(`${varName}: ${value}`);
}

async function removeThemeVar(varName) {
  delete state.themes[state.selectedTheme]?.[varName];
  await save();
  renderThemeVarsTable();
  renderThemeList();
  toast(`Removed ${varName}`);
}

// ── Color picker sync ────────────────────────────────────────────────────────

document.getElementById("new-var-picker").addEventListener("input", function() {
  document.getElementById("new-var-hex").value = this.value;
});

document.getElementById("new-var-hex").addEventListener("input", function() {
  if (HEX_RE.test(this.value))
    document.getElementById("new-var-picker").value = this.value;
});

// ════════════════════════════════════════════════════════════════════════════
// Export / Import
// ════════════════════════════════════════════════════════════════════════════

function exportData() {
  let data, filename;

  if (state.activeTab === "themes") {
    data     = JSON.stringify(state.themes, null, 2);
    filename = "themes.json";
  } else {
    data     = JSON.stringify({ whitelist: state.whitelist, mappings: state.mappings }, null, 2);
    filename = "huepr-config.json";
  }

  const blob = new Blob([data], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${filename}`);
}

async function importData(file) {
  try {
    const parsed = JSON.parse(await file.text());

    if (state.activeTab === "themes") {
      // Expect themes.json format: { "ThemeName": { "--var": "#hex" } }
      if (typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Expected an object");
      Object.assign(state.themes, parsed);
      await save();
      renderThemeList();
      if (state.selectedTheme) renderThemeVars();
      const dl = document.getElementById("theme-var-list");
      dl.innerHTML = allThemeVars().map(v => `<option value="${esc(v)}">`).join("");
      toast(`Themes imported (${Object.keys(parsed).length} themes)`);
    } else {
      // Expect { whitelist, mappings }
      if (!Array.isArray(parsed.whitelist) || typeof parsed.mappings !== "object")
        throw new Error("Expected { whitelist, mappings }");
      state.whitelist = parsed.whitelist;
      state.mappings  = parsed.mappings;
      await save();
      state.selectedSite = null;
      renderSiteList();
      renderMappings();
      toast("Config imported");
    }
  } catch (err) {
    toast("Import failed: " + err.message, "err");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Extract Palette
// ════════════════════════════════════════════════════════════════════════════

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function toHex(r, g, b) {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

function extractPalette(imgEl) {
  const SIZE = 50;
  const canvas = document.getElementById("extract-canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgEl, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

  // Collect pixel colors
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    pixels.push({ r, g, b, h, s, l });
  }

  if (!pixels.length) return null;

  // Sort by luminance to pick buckets
  const byLum = [...pixels].sort((a, b) => a.l - b.l);
  const n = byLum.length;

  // Bucket indices: darkest, second-darkest, median, second-lightest, lightest
  const bucket = i => byLum[Math.min(Math.floor(i * n), n - 1)];
  const darkest       = bucket(0.05);
  const secondDarkest = bucket(0.20);
  const median        = bucket(0.50);
  const lightest      = bucket(0.95);

  // Most saturated pixel → accent
  const mostSaturated = pixels.reduce((a, b) => b.s > a.s ? b : a);

  return {
    "--theme-bg":      toHex(darkest.r,       darkest.g,       darkest.b),
    "--theme-surface": toHex(secondDarkest.r,  secondDarkest.g,  secondDarkest.b),
    "--theme-border":  toHex(median.r,         median.g,         median.b),
    "--theme-fg":      toHex(lightest.r,       lightest.g,       lightest.b),
    "--theme-accent":  toHex(mostSaturated.r,  mostSaturated.g,  mostSaturated.b),
  };
}

let _pendingPalette = null;

function openExtractOverlay(palette) {
  _pendingPalette = palette;
  const preview = document.getElementById("extract-preview");
  preview.innerHTML = Object.entries(palette).map(([varName, hex]) => `
    <div class="extract-swatch-row">
      <div class="extract-swatch" style="background:${esc(hex)}"></div>
      <span class="extract-var-name">${esc(varName)}</span>
      <span class="extract-hex">${esc(hex)}</span>
    </div>
  `).join("");
  document.getElementById("extract-overlay").style.display = "";
}

function closeExtractOverlay() {
  document.getElementById("extract-overlay").style.display = "none";
  _pendingPalette = null;
}

document.getElementById("extract-close").addEventListener("click",  closeExtractOverlay);
document.getElementById("extract-cancel").addEventListener("click", closeExtractOverlay);
document.getElementById("extract-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("extract-overlay")) closeExtractOverlay();
});

document.getElementById("extract-apply").addEventListener("click", async () => {
  if (!_pendingPalette || !state.selectedTheme) return;
  state.themes[state.selectedTheme] ??= {};
  Object.assign(state.themes[state.selectedTheme], _pendingPalette);
  await save();
  renderThemeVarsTable();
  renderThemeList();
  const dl = document.getElementById("theme-var-list");
  dl.innerHTML = allThemeVars().map(v => `<option value="${esc(v)}">`).join("");
  closeExtractOverlay();
  toast("Palette applied");
});

document.getElementById("btn-extract").addEventListener("click", () => {
  document.getElementById("extract-file").click();
});

document.getElementById("extract-file").addEventListener("change", e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    const palette = extractPalette(img);
    if (!palette) { toast("Could not read image pixels", "err"); return; }
    openExtractOverlay(palette);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("Failed to load image", "err"); };
  img.src = url;
});

// ════════════════════════════════════════════════════════════════════════════
// Detect Overlay
// ════════════════════════════════════════════════════════════════════════════

function openDetectOverlay(vars) {
  const overlay    = document.getElementById("detect-overlay");
  const list       = document.getElementById("detect-list");
  const filterInp  = document.getElementById("detect-filter");

  filterInp.value = "";

  function renderList(filter) {
    const q = filter.toLowerCase();
    list.innerHTML = "";
    const matches = vars.filter(v => !q || v.includes(q));
    if (!matches.length) {
      list.innerHTML = `<li style="color:var(--overlay);font-size:12px;padding:10px 14px">No matches</li>`;
      return;
    }
    for (const v of matches) {
      const li = document.createElement("li");
      li.className = "detect-item";
      li.innerHTML = `<span class="var-name" title="${esc(v)}">${esc(v)}</span>
        <button class="btn-use" data-var="${esc(v)}">Use</button>`;
      li.querySelector(".btn-use").addEventListener("click", () => {
        document.getElementById("new-map-site").value = v;
        closeDetectOverlay();
        document.getElementById("new-map-site").focus();
      });
      list.appendChild(li);
    }
  }

  renderList("");
  filterInp.addEventListener("input", () => renderList(filterInp.value));
  overlay.style.display = "";
  filterInp.focus();
}

function closeDetectOverlay() {
  document.getElementById("detect-overlay").style.display = "none";
}

document.getElementById("detect-close").addEventListener("click", closeDetectOverlay);
document.getElementById("detect-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("detect-overlay")) closeDetectOverlay();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeDetectOverlay();
});

document.getElementById("btn-detect").addEventListener("click", async () => {
  if (!state.selectedSite) return;
  const btn = document.getElementById("btn-detect");
  btn.textContent = "Detecting…";
  btn.disabled = true;
  try {
    const resp = await browser.runtime.sendMessage({
      type: "detect_vars",
      hostname: state.selectedSite,
    });
    if (resp?.noTab) {
      toast(`Open ${state.selectedSite} in a tab first`, "err");
    } else {
      openDetectOverlay(resp?.vars ?? []);
    }
  } finally {
    btn.textContent = "Detect";
    btn.disabled = false;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Event Wiring
// ════════════════════════════════════════════════════════════════════════════

// Tabs
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// Sites tab
document.getElementById("btn-add-site").addEventListener("click", addSite);
document.getElementById("new-site-input").addEventListener("keydown", e => {
  if (e.key === "Enter") addSite();
});

document.getElementById("btn-add-mapping").addEventListener("click", addMapping);
document.getElementById("new-map-theme").addEventListener("keydown", e => {
  if (e.key === "Enter") addMapping();
});

document.getElementById("site-theme-override").addEventListener("change", async function() {
  if (!state.selectedSite) return;
  if (this.value) {
    state.siteThemes[state.selectedSite] = this.value;
  } else {
    delete state.siteThemes[state.selectedSite];
  }
  await save();
});

document.getElementById("theme-custom-css").addEventListener("input", async function() {
  if (!state.selectedTheme) return;
  if (this.value.trim()) {
    state.themeCSS[state.selectedTheme] = this.value;
  } else {
    delete state.themeCSS[state.selectedTheme];
  }
  await save();
});

// Themes tab
document.getElementById("btn-add-theme").addEventListener("click", addTheme);
document.getElementById("new-theme-name").addEventListener("keydown", e => {
  if (e.key === "Enter") addTheme();
});

document.getElementById("btn-add-var").addEventListener("click", addThemeVar);
document.getElementById("new-var-hex").addEventListener("keydown", e => {
  if (e.key === "Enter") addThemeVar();
});

// Export / Import
document.getElementById("btn-export").addEventListener("click", exportData);
document.getElementById("btn-import").addEventListener("click", () => {
  document.getElementById("import-file").click();
});
document.getElementById("import-file").addEventListener("change", e => {
  const f = e.target.files[0];
  if (f) importData(f);
  e.target.value = "";
});

// ════════════════════════════════════════════════════════════════════════════
// Init
// ════════════════════════════════════════════════════════════════════════════

(async () => {
  await load();
  renderSiteList();
  renderMappings();
  renderThemeList();
  renderThemeVars();

  const { hookEnabled, manualTheme } = await browser.storage.local.get({ hookEnabled: true, manualTheme: null });
  const chk = document.getElementById("chk-hook");
  const sel = document.getElementById("manual-theme-select");
  chk.checked = hookEnabled;
  sel.style.display = hookEnabled ? "none" : "";
  populateThemeSelect(sel, manualTheme);

  chk.addEventListener("change", async () => {
    await browser.storage.local.set({ hookEnabled: chk.checked });
    sel.style.display = chk.checked ? "none" : "";
  });

  sel.addEventListener("change", async () => {
    await browser.storage.local.set({ manualTheme: sel.value });
  });
})();
