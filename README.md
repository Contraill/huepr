# Huepr

Hyprland wallpaper changes → browser theme. Huepr listens for wallpaper events via Native Messaging and injects CSS custom properties into whitelisted sites in real time.

Built for [Zen Browser](https://zen-browser.app) and Firefox on Hyprland + [Caelestia](https://github.com/caelestia-dots/caelestia).

---

## How it works

```
caelestia-wallhook → huepr-notify → huepr.pipe → theme_host.py → Native Messaging → background.js → content.js → CSS vars on :root
```

1. Your wallpaper hook calls `huepr-notify` with the new wallpaper path.
2. `theme_host.py` extracts the wallpaper filename stem (e.g. `/path/to/Aurora.jpg` → `Aurora`) and sends it to the extension via Native Messaging. The extension matches this name against your theme names.
3. The extension injects CSS custom properties into every whitelisted site.
4. Sites that map their own CSS variables to theme variables update instantly.

---

## Features

- **Wallpaper-driven theming** — theme switches automatically when your wallpaper changes
- **Per-site CSS variable mapping** — map site variables (e.g. `--background`) to theme variables (e.g. `--theme-bg`)
- **Per-site theme override** — pin a specific theme to a site regardless of wallpaper
- **Custom CSS injection** — inject arbitrary CSS rules per theme (override hardcoded colors, SVG fills, etc.)
- **Auto-detect site variables** — scan the active tab's stylesheets and pick variables to map
- **Color extraction from image** — extract a palette from any image to seed a new theme
- **Hook toggle** — disable wallpaper trigger and pick a theme manually
- **Smooth transitions** — CSS transition injected on theme change, removed after 600ms
- **Popup** — quick access to hook toggle, manual theme select, and "Add current site"
- **Auto-update** — `huepr-update` re-fetches and re-installs from your git remote; optional systemd weekly timer

---

## Installation

```bash
git clone https://github.com/Contraill/huepr
cd huepr
bash install.sh
```

Restart your browser. The extension loads automatically.

> After installation the git directory can be deleted — extension files are copied to `~/.local/share/huepr/`.

### Requirements

- Firefox or Zen Browser
- Python 3.8+
- git (used by `huepr-update` to fetch updates)
- [Caelestia](https://github.com/caelestia-dots/caelestia) with `caelestia-wallhook` (for automatic wallpaper trigger)

### Updating

```bash
huepr-update
```

Or let the systemd weekly timer handle it automatically (installed by default if systemd user instance is available).

---

## Setup

### 1. Add a site

Open the popup (click the Huepr icon) → **Add current site**, or go to **Options → Sites & Mappings** and type a hostname.

### 2. Create a theme

**Options → Themes** → type a name → **Add Theme**. The theme name must match (part of) your wallpaper filename for automatic switching.

Add variables to the theme — e.g. `--theme-bg: #1e1e2e`, `--theme-accent: #cba6f7`.

### 3. Map site variables to theme variables

In **Sites & Mappings**, select a site. Add a mapping:
- **Site variable** — the CSS variable the site uses (e.g. `--background-color`)
- **Theme variable** — the theme variable to pull the value from (e.g. `--theme-bg`)

Use **Detect** to scan the active tab's stylesheets and find variables automatically.

### 4. Optional: Custom CSS

In **Themes**, select a theme and add custom CSS to override hardcoded colors:

```css
/* Override YouTube logo red */
path[fill="#FF0033"] { fill: var(--theme-accent) !important; }
```

---

## Project structure

```
install.sh          — installer: copies files, sets up NM host, patches wallhook
manifest.json       — WebExtension manifest (MV2)
background.js       — background page: NM connection, theme resolution, message routing
content.js          — content script: CSS variable + custom CSS injection
popup/              — browser action popup
options/            — options page (themes, sites & mappings, help)
host/
  theme_host.py     — native messaging host: reads pipe, sends theme to extension
icons/              — extension icons
```

---

## How themes work

A theme is a flat key-value map of CSS custom properties:

```json
{
  "--theme-bg":      "#1e1e2e",
  "--theme-surface": "#313244",
  "--theme-accent":  "#cba6f7",
  "--theme-fg":      "#cdd6f4",
  "--theme-border":  "#45475a"
}
```

When active, all theme variables are injected into `:root` on whitelisted sites. Site mappings then alias site-specific variables to theme values:

```
--site-background  →  value of --theme-bg
--site-link-color  →  value of --theme-accent
```

---

## Troubleshooting

**Extension icon doesn't appear**
Check `about:debugging` → This Firefox → Extensions to verify Huepr is loaded. In `about:config`, confirm `xpinstall.signatures.required` is `false`.

**Theme doesn't switch on wallpaper change**
- Verify `caelestia-wallhook` is patched: `grep huepr-notify ~/.local/bin/caelestia-wallhook`
- Verify the native host is running: `about:debugging` → Huepr → Inspect → check the background console for connection messages

**CSS variables not applying**
Open Options → Sites & Mappings → confirm the site is whitelisted and has mappings. Use the **Detect** button to find available CSS variables on the active tab.

**`huepr-update` fails**
Check that `~/.config/huepr/config` contains a valid `REPO_URL` pointing to a git remote.

---

## License

MIT
