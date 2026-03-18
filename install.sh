#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Huepr — Installer
# Sets up the native messaging host, browser extension, and wallpaper hook.
#
# Usage:  bash install.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  GR='\033[0;32m' YL='\033[0;33m' RD='\033[0;31m'
  CY='\033[0;36m' BL='\033[1;34m' DM='\033[0;90m' BW='\033[1;37m' RS='\033[0m'
else
  GR='' YL='' RD='' CY='' BL='' DM='' BW='' RS=''
fi

ok()   { echo -e "  ${GR}✓${RS}  $*"; }
err()  { echo -e "  ${RD}✗${RS}  $*"; }
warn() { echo -e "  ${YL}!${RS}  $*"; }
info() { echo -e "  ${DM}·${RS}  $*"; }
step() { echo -e "\n${BW}▸ $*${RS}"; }

echo -e "\n${BL}╭──────────────────────────────────────╮${RS}"
echo -e "${BL}│${RS}  ${CY}Huepr${RS} — Wallpaper → Browser Theme   ${BL}│${RS}"
echo -e "${BL}╰──────────────────────────────────────╯${RS}"

HUEPR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_SCRIPT="$HUEPR_DIR/host/theme_host.py"
HOST_BIN="$HOME/.local/bin/huepr-theme-host"
NOTIFY_BIN="$HOME/.local/bin/huepr-notify"
NM_DIR="$HOME/.mozilla/native-messaging-hosts"
EXT_DEST="$HOME/.local/share/huepr/extension"
HUEPR_CONFIG="$HOME/.config/huepr/config"

info "Source: $HUEPR_DIR"

# ── 1. Dependency checks ──────────────────────────────────────────────────────
step "Checking dependencies"

DEPS_OK=1

if command -v python3 &>/dev/null; then
  ok "python3 $(python3 --version 2>&1 | cut -d' ' -f2)"
else
  err "python3 not found — please install Python 3.8+"
  echo -e "       ${DM}Arch: sudo pacman -S python${RS}"
  DEPS_OK=0
fi

if [[ -f "$HOST_SCRIPT" ]]; then
  ok "theme_host.py found"
else
  err "host/theme_host.py not found: $HOST_SCRIPT"
  DEPS_OK=0
fi

if [[ $DEPS_OK -eq 0 ]]; then
  echo -e "\n${RD}Installation aborted — fix the errors above and try again.${RS}\n"
  exit 1
fi

# ── 2. Create directories ─────────────────────────────────────────────────────
step "Creating directories"
mkdir -p "$HOME/.local/bin" "$NM_DIR" "$HOME/.cache/huepr" "$HOME/.config/huepr" \
         "$HOME/.local/share/huepr"
ok "~/.local/bin"
ok "~/.mozilla/native-messaging-hosts"
ok "~/.cache/huepr"

# ── 3. NM host wrapper ────────────────────────────────────────────────────────
step "Installing native messaging host"

# Copy theme_host.py to a stable location independent of the git directory
HOST_PY="$HOME/.local/share/huepr/theme_host.py"
mkdir -p "$HOME/.local/share/huepr"
cp -f "$HOST_SCRIPT" "$HOST_PY"
ok "theme_host.py → $HOST_PY"

cat > "$HOST_BIN" <<WRAPPER
#!/usr/bin/env bash
exec python3 "${HOST_PY}" "\$@"
WRAPPER
chmod +x "$HOST_BIN"
ok "Host binary: $HOST_BIN"

# ── 4. huepr-notify ───────────────────────────────────────────────────────────
cat > "$NOTIFY_BIN" <<'NOTIFY'
#!/usr/bin/env bash
# Writes the current wallpaper path to the named pipe.
# theme_host.py reads from this pipe and notifies the browser extension.
# The timeout guards against a stale pipe (no reader on the other end).
timeout 2 bash -c 'printf "%s\n" "${WALLPAPER_PATH:-}" > ~/.cache/huepr/huepr.pipe' || true
NOTIFY
chmod +x "$NOTIFY_BIN"
ok "Notify script: $NOTIFY_BIN"

# ── 5. Native messaging manifests ─────────────────────────────────────────────
step "Writing native messaging manifests"

write_manifest() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  cat > "$dest" <<JSON
{
  "name": "com.huepr.theme_host",
  "description": "Huepr — delivers wallpaper change events to the browser",
  "path": "${HOST_BIN}",
  "type": "stdio",
  "allowed_extensions": ["huepr@localhost"]
}
JSON
  ok "Manifest: $dest"
}

write_manifest "$NM_DIR/com.huepr.theme_host.json"

if [[ -d "$HOME/.zen" ]]; then
  write_manifest "$HOME/.zen/native-messaging-hosts/com.huepr.theme_host.json"
fi

# ── 6. Extension deployment ───────────────────────────────────────────────────
step "Deploying extension files"

# 6a. Copy extension files to a stable location (independent of this git dir)
mkdir -p "$EXT_DEST"
for item in manifest.json background.js background.html content.js popup options icons; do
  if [[ -e "$HUEPR_DIR/$item" ]]; then
    cp -r "$HUEPR_DIR/$item" "$EXT_DEST/"
  fi
done
ok "Extension copied to $EXT_DEST"

# 6b. Write proxy file + user.js pref for each browser profile
EXT_INSTALLED=0

install_to_profile() {
  local profile_dir="$1"
  local browser_label="$2"
  local ext_dir="$profile_dir/extensions"
  mkdir -p "$ext_dir"

  # Proxy file: plain text file containing the path to the unpacked extension
  printf '%s' "$EXT_DEST" > "$ext_dir/huepr@localhost"
  ok "$browser_label — proxy: $(basename "$profile_dir")/extensions/huepr@localhost"

  # user.js: disable signature requirement (needed for unsigned/sideloaded extensions)
  local user_js="$profile_dir/user.js"
  local pref='user_pref("xpinstall.signatures.required", false);'
  if grep -qF "$pref" "$user_js" 2>/dev/null; then
    info "$browser_label — user.js pref already present"
  else
    printf '\n%s\n' "$pref" >> "$user_js"
    ok "$browser_label — user.js updated"
  fi

  EXT_INSTALLED=1
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
      [[ -d "$full_path" ]] && install_to_profile "$full_path" "$browser_label"
      is_relative=1; path_val=""
    fi
  done < "$ini"
}

read_profiles_ini "$HOME/.mozilla/firefox/profiles.ini" "Firefox"
read_profiles_ini "$HOME/.zen/profiles.ini"              "Zen Browser"

if [[ $EXT_INSTALLED -eq 0 ]]; then
  warn "No browser profiles found — load the extension manually:"
  warn "about:debugging → Load Temporary Add-on → $EXT_DEST/manifest.json"
fi

# 6c. Save repo URL for huepr-update
REPO_URL=""
if git -C "$HUEPR_DIR" remote get-url origin &>/dev/null; then
  REPO_URL="$(git -C "$HUEPR_DIR" remote get-url origin)"
fi
cat > "$HUEPR_CONFIG" <<CFG
REPO_URL=${REPO_URL}
CFG
if [[ -n "$REPO_URL" ]]; then
  ok "Repo URL saved: $REPO_URL"
else
  info "Not a git repo — huepr-update will require a manual repo URL in $HUEPR_CONFIG"
fi

# 6d. Write huepr-update script
UPDATE_BIN="$HOME/.local/bin/huepr-update"
cat > "$UPDATE_BIN" <<'UPDATESCRIPT'
#!/usr/bin/env bash
# Re-fetches the latest Huepr from git and re-installs.
source "$HOME/.config/huepr/config" 2>/dev/null || true
if [[ -z "${REPO_URL:-}" ]]; then
  echo "No repo URL saved. Run install.sh from the git directory first."
  exit 1
fi
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT
git clone --depth=1 "$REPO_URL" "$TMP/huepr"
bash "$TMP/huepr/install.sh"
UPDATESCRIPT
chmod +x "$UPDATE_BIN"
ok "Update command: huepr-update"

# 6e. Systemd weekly auto-update timer (optional)
SYSTEMD_TIMER_INSTALLED=0
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"

if systemctl --user status &>/dev/null; then
  mkdir -p "$SYSTEMD_USER_DIR"

  cat > "$SYSTEMD_USER_DIR/huepr-update.service" <<SERVICE
[Unit]
Description=Huepr auto-update

[Service]
Type=oneshot
ExecStart=%h/.local/bin/huepr-update
SERVICE

  cat > "$SYSTEMD_USER_DIR/huepr-update.timer" <<TIMER
[Unit]
Description=Huepr weekly auto-update

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
TIMER

  systemctl --user daemon-reload
  systemctl --user enable --now huepr-update.timer
  SYSTEMD_TIMER_INSTALLED=1
  ok "Auto-update timer enabled (weekly)"
else
  info "systemd user instance not available — skipping auto-update timer"
  info "Run huepr-update manually to update"
fi

# ── 7. Patch caelestia-wallhook ───────────────────────────────────────────────
step "Setting up wallpaper hook"

WALLHOOK=""
for candidate in \
  "$HOME/.local/bin/caelestia-wallhook" \
  "$(command -v caelestia-wallhook 2>/dev/null || true)"
do
  [[ -f "$candidate" ]] && { WALLHOOK="$candidate"; break; }
done

if [[ -z "$WALLHOOK" ]]; then
  warn "caelestia-wallhook not found — skipping hook setup"
  warn "Add this line to your wallpaper hook script:"
  echo -e "       ${CY}WALLPAPER_PATH=\"\$WP\" \"$NOTIFY_BIN\" || true${RS}"
elif grep -q "huepr-notify" "$WALLHOOK" 2>/dev/null; then
  ok "Hook already present in $WALLHOOK"
else
  # Insert right after the line that writes WP to the cache file
  if grep -qE 'echo.*WP.*>.*CACHE|echo.*>.*last_wallpaper' "$WALLHOOK"; then
    sed -i '/echo.*WP.*>.*CACHE\|echo.*>.*last_wallpaper/a \
\
# ---- Huepr: browser CSS variable sync ----\
WALLPAPER_PATH="$WP" "'"$NOTIFY_BIN"'" || true' "$WALLHOOK"
    ok "Hook injected after cache write in $WALLHOOK"
  else
    # Fallback: insert before exit 0
    sed -i '/^exit 0/i \
\
# ---- Huepr: browser CSS variable sync ----\
WALLPAPER_PATH="$WP" "'"$NOTIFY_BIN"'" || true\
' "$WALLHOOK"
    ok "Hook injected before exit 0 in $WALLHOOK"
  fi
fi

# ── 8. Summary ────────────────────────────────────────────────────────────────
echo -e "\n${BL}──────────────────────────────────────────${RS}"
echo -e "  ${GR}Installation complete!${RS}"
echo -e "${BL}──────────────────────────────────────────${RS}\n"

if [[ $EXT_INSTALLED -eq 1 ]]; then
  echo -e "  ${BW}Next step:${RS} Restart your browser."
  echo -e "  Huepr will be loaded automatically from your profile.\n"
else
  echo -e "  ${BW}Load the extension manually:${RS}"
  echo -e "  about:debugging → Load Temporary Add-on"
  echo -e "  → ${CY}$EXT_DEST/manifest.json${RS}\n"
fi

echo -e "  ${BW}Options:${RS} Right-click the Huepr icon → Manage Extension → Preferences"
echo -e "  ${BW}Themes:${RS}  Add themes in Options → Themes tab (name must match wallpaper filename)"
echo -e "  ${DM}Git directory can now be deleted${RS}"
echo -e "  ${DM}Run huepr-update anytime to update to the latest version${RS}"
if [[ $SYSTEMD_TIMER_INSTALLED -eq 1 ]]; then
  echo -e "  ${GR}Auto-update enabled (weekly)${RS}"
fi
echo ""
