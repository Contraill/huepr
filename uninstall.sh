#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Huepr — Uninstaller
# Reverts everything install.sh set up: native messaging host, helper
# scripts, auto-update timer, wallpaper hook lines and browser profile files.
# Installed as ~/.local/bin/huepr-uninstall, so the git directory is not needed.
#
# Usage:  bash uninstall.sh [--yes]   (or: huepr-uninstall [--yes])
#   --yes  do not ask for confirmation when a browser is running
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [[ -t 1 ]]; then
  GR='\033[0;32m' YL='\033[0;33m' CY='\033[0;36m' BL='\033[1;34m'
  DM='\033[0;90m' BW='\033[1;37m' RS='\033[0m'
else
  GR='' YL='' CY='' BL='' DM='' BW='' RS=''
fi

ok()   { echo -e "  ${GR}✓${RS}  $*"; }
warn() { echo -e "  ${YL}!${RS}  $*"; }
info() { echo -e "  ${DM}·${RS}  $*"; }
step() { echo -e "\n${BW}▸ $*${RS}"; }

echo -e "\n${BL}╭──────────────────────────────────────╮${RS}"
echo -e "${BL}│${RS}  ${CY}Huepr${RS} — Uninstall                   ${BL}│${RS}"
echo -e "${BL}╰──────────────────────────────────────╯${RS}"

EXT_ID="huepr@localhost"
LEGACY_SIG_PREF='user_pref("xpinstall.signatures.required", false);'
HOOK_MARKER='# ---- Huepr: browser CSS variable sync ----'

remove_file() {
  if [[ -e "$1" ]]; then
    rm -rf "$1"
    ok "Removed ${1/#$HOME/\~}"
  fi
}

if [[ "${1:-}" != "--yes" ]] && pgrep -x 'firefox|firefox-bin|zen|zen-bin' &>/dev/null; then
  warn "A browser seems to be running. Close it before continuing so profile"
  warn "files are not rewritten while it is open."
  read -rp "  Continue anyway? [y/N] " answer || true
  [[ "${answer:-}" == [yY] ]] || exit 1
fi

# ── 1. Auto-update timer ──────────────────────────────────────────────────────
step "Removing auto-update timer"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
if [[ -f "$SYSTEMD_USER_DIR/huepr-update.timer" ]]; then
  systemctl --user disable --now huepr-update.timer &>/dev/null || true
  remove_file "$SYSTEMD_USER_DIR/huepr-update.timer"
  remove_file "$SYSTEMD_USER_DIR/huepr-update.service"
  systemctl --user daemon-reload &>/dev/null || true
else
  info "No timer installed"
fi

# ── 2. Wallpaper hook ─────────────────────────────────────────────────────────
step "Removing wallpaper hook lines"
WALLHOOK=""
for candidate in \
  "$HOME/.local/bin/caelestia-wallhook" \
  "$(command -v caelestia-wallhook 2>/dev/null || true)"
do
  [[ -f "$candidate" ]] && { WALLHOOK="$candidate"; break; }
done

if [[ -z "$WALLHOOK" ]] || ! grep -q "huepr-notify" "$WALLHOOK"; then
  info "No Huepr lines found in a wallpaper hook"
  info "If you added the huepr-notify line to another script, remove it there"
elif [[ ! -w "$WALLHOOK" ]]; then
  warn "$WALLHOOK is not writable — remove the huepr-notify lines yourself"
else
  cp -f "$WALLHOOK" "$WALLHOOK.huepr-uninstall-bak"
  # Drop what install.sh added: blank line + marker comment + huepr-notify line.
  awk -v marker="$HOOK_MARKER" '
    $0 == ""       { blank++; next }
    $0 == marker   { blank = 0; next }
    /huepr-notify/ { next }
    { while (blank > 0) { print ""; blank-- } print }
    END { while (blank > 0) { print ""; blank-- } }
  ' "$WALLHOOK.huepr-uninstall-bak" > "$WALLHOOK"
  ok "Cleaned $WALLHOOK (backup: $(basename "$WALLHOOK").huepr-uninstall-bak)"
fi

# ── 3. Browser profiles ───────────────────────────────────────────────────────
step "Cleaning browser profiles"

clean_profile() {
  local profile_dir="$1"
  local browser_label="$2"
  local name; name="$(basename "$profile_dir")"
  local user_js="$profile_dir/user.js"

  # Signed XPI (current installer) and proxy file (older installers).
  # The browser notices the missing add-on on next start and drops it.
  for f in "$profile_dir/extensions/$EXT_ID.xpi" "$profile_dir/extensions/$EXT_ID"; do
    if [[ -f "$f" ]]; then
      rm -f "$f"
      ok "$browser_label — removed $name/extensions/$(basename "$f")"
    fi
  done

  if grep -qxF "$LEGACY_SIG_PREF" "$user_js" 2>/dev/null; then
    cp -f "$user_js" "$user_js.huepr-bak"
    grep -vxF "$LEGACY_SIG_PREF" "$user_js.huepr-bak" > "$user_js" || true
    ok "$browser_label — removed signature override from $name/user.js (backup: user.js.huepr-bak)"
    warn "$browser_label — reset xpinstall.signatures.required in about:config"
  fi
}

read_profiles_ini() {
  local ini="$1"
  local browser_label="$2"
  [[ ! -f "$ini" ]] && return
  local base_dir; base_dir="$(dirname "$ini")"
  local is_relative=1 path_val=""

  while IFS='=' read -r key val || [[ -n "$key" ]]; do
    key="${key// /}"
    [[ "$key" == "IsRelative" ]] && is_relative="$val"
    if [[ "$key" == "Path" ]]; then
      path_val="$val"
      local full_path
      if [[ "$is_relative" == "1" ]]; then
        full_path="$base_dir/$path_val"
      else
        full_path="$path_val"
      fi
      [[ -d "$full_path" ]] && clean_profile "$full_path" "$browser_label"
      is_relative=1; path_val=""
    fi
  done < "$ini"
}

read_profiles_ini "$HOME/.mozilla/firefox/profiles.ini"        "Firefox"
read_profiles_ini "$HOME/.config/mozilla/firefox/profiles.ini" "Firefox"
read_profiles_ini "$HOME/.zen/profiles.ini"                    "Zen Browser"
read_profiles_ini "$HOME/.config/zen/profiles.ini"             "Zen Browser"

# ── 4. Native messaging host and helper scripts ───────────────────────────────
step "Removing native messaging host and helper scripts"
remove_file "$HOME/.mozilla/native-messaging-hosts/com.huepr.theme_host.json"
remove_file "$HOME/.zen/native-messaging-hosts/com.huepr.theme_host.json"
remove_file "$HOME/.local/bin/huepr-theme-host"
remove_file "$HOME/.local/bin/huepr-notify"
remove_file "$HOME/.local/bin/huepr-update"
remove_file "$HOME/.local/share/huepr"
remove_file "$HOME/.cache/huepr"
remove_file "$HOME/.config/huepr"

# Last, because this script may be running from here.
UNINSTALL_BIN="$HOME/.local/bin/huepr-uninstall"
if [[ -e "$UNINSTALL_BIN" ]]; then
  rm -f "$UNINSTALL_BIN"
  ok "Removed ~/.local/bin/huepr-uninstall"
fi

echo -e "\n${BL}──────────────────────────────────────────${RS}"
echo -e "  ${GR}Huepr removed.${RS}"
echo -e "${BL}──────────────────────────────────────────${RS}\n"
echo -e "  Themes and site mappings live in the browser's extension storage."
echo -e "  ${DM}They are deleted when the add-on itself is removed (about:addons).${RS}\n"
