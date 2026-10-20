#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Huepr — Installer
# Sets up the native messaging host, browser extension, and wallpaper hook.
#
# Usage:  bash install.sh [--auto-update] [--dev]
#   --auto-update  enable the weekly systemd timer that runs huepr-update
#   --dev          deploy the unpacked extension for about:debugging instead
#                  of installing the signed release XPI
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

AUTO_UPDATE=0
DEV_MODE=0
for arg in "$@"; do
  case "$arg" in
    --auto-update) AUTO_UPDATE=1 ;;
    --dev)         DEV_MODE=1 ;;
    -h|--help)     sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)             echo "Unknown option: $arg (see --help)" >&2; exit 1 ;;
  esac
done

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
EXT_ID="huepr@localhost"
XPI_CACHE="$HOME/.local/share/huepr/huepr.xpi"
# Newest release first; a release waiting for Mozilla approval has no XPI yet.
RELEASE_API="https://api.github.com/repos/Contraill/huepr/releases?per_page=20"
RELEASES_PAGE="https://github.com/Contraill/huepr/releases/latest"
# Written by older installers; removed again on install/uninstall.
LEGACY_SIG_PREF='user_pref("xpinstall.signatures.required", false);'
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

if [[ $DEV_MODE -eq 0 ]]; then
  if command -v curl &>/dev/null; then
    ok "curl found"
  else
    err "curl not found — needed to download the signed extension"
    DEPS_OK=0
  fi
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

# 6a. Get the extension: signed release XPI by default, unpacked copy with --dev
XPI_READY=0

# Fetch the newest signed XPI from GitHub releases.
# shortcut: only checks that signature files exist; the browser does the real
# signature verification and refuses the XPI if it is invalid.
download_signed_xpi() {
  local url
  url="$(curl -fsSL "$RELEASE_API" | python3 -c '
import json, sys
print(next(a["browser_download_url"] for r in json.load(sys.stdin)
           for a in r["assets"] if a["name"].endswith(".xpi")))
')" || return 1
  curl -fsSL -o "$XPI_CACHE.tmp" "$url" || return 1
  python3 - "$XPI_CACHE.tmp" "$EXT_ID" <<'PY' || { rm -f "$XPI_CACHE.tmp"; return 1; }
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    names = set(z.namelist())
    gecko = json.loads(z.read("manifest.json"))["browser_specific_settings"]["gecko"]
if not ({"META-INF/mozilla.rsa", "META-INF/cose.sig"} & names) or gecko["id"] != sys.argv[2]:
    sys.exit("downloaded XPI is not a signed Huepr build")
PY
  mv -f "$XPI_CACHE.tmp" "$XPI_CACHE"
  ok "Signed extension: $(basename "$url")"
}

if [[ $DEV_MODE -eq 1 ]]; then
  mkdir -p "$EXT_DEST"
  for item in manifest.json background.js background.html content.js popup options icons; do
    if [[ -e "$HUEPR_DIR/$item" ]]; then
      cp -r "$HUEPR_DIR/$item" "$EXT_DEST/"
    fi
  done
  ok "Unpacked extension copied to $EXT_DEST (--dev)"
elif download_signed_xpi; then
  XPI_READY=1
else
  warn "Could not download the signed extension from $RELEASES_PAGE"
fi

# 6b. Remove leftovers of the old unpacked install, then copy the XPI into
#     each browser profile. Browser profiles are never told to accept
#     unsigned extensions.
EXT_INSTALLED=0

remove_legacy_install() {
  local profile_dir="$1"
  local browser_label="$2"
  local proxy="$profile_dir/extensions/$EXT_ID"
  local user_js="$profile_dir/user.js"

  if [[ -f "$proxy" ]]; then
    rm -f "$proxy"
    ok "$browser_label — removed old unpacked-extension proxy file"
  fi
  if grep -qxF "$LEGACY_SIG_PREF" "$user_js" 2>/dev/null; then
    cp -f "$user_js" "$user_js.huepr-bak"
    grep -vxF "$LEGACY_SIG_PREF" "$user_js.huepr-bak" > "$user_js" || true
    warn "$browser_label — removed old signature override from user.js (backup: user.js.huepr-bak)"
    warn "$browser_label — also reset xpinstall.signatures.required in about:config"
  fi
}

install_to_profile() {
  local profile_dir="$1"
  local browser_label="$2"
  local ext_dir="$profile_dir/extensions"

  remove_legacy_install "$profile_dir" "$browser_label"
  [[ $XPI_READY -eq 1 ]] || return 0

  mkdir -p "$ext_dir"
  cp -f "$XPI_CACHE" "$ext_dir/$EXT_ID.xpi"
  ok "$browser_label — $(basename "$profile_dir")/extensions/$EXT_ID.xpi"
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

read_profiles_ini "$HOME/.mozilla/firefox/profiles.ini"        "Firefox"
read_profiles_ini "$HOME/.config/mozilla/firefox/profiles.ini" "Firefox"
read_profiles_ini "$HOME/.zen/profiles.ini"                    "Zen Browser"
read_profiles_ini "$HOME/.config/zen/profiles.ini"             "Zen Browser"

if [[ $EXT_INSTALLED -eq 0 && $DEV_MODE -eq 0 ]]; then
  if [[ $XPI_READY -eq 1 ]]; then
    warn "No browser profiles found — install the extension manually:"
    warn "about:addons → ⚙ → Install Add-on From File → $XPI_CACHE"
  else
    warn "Install the extension manually from $RELEASES_PAGE"
  fi
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

UNINSTALL_BIN="$HOME/.local/bin/huepr-uninstall"
cp -f "$HUEPR_DIR/uninstall.sh" "$UNINSTALL_BIN"
chmod +x "$UNINSTALL_BIN"
ok "Uninstall command: huepr-uninstall"

# 6e. Systemd weekly auto-update timer (opt-in: it runs install.sh from the
#     git remote unattended)
SYSTEMD_TIMER_INSTALLED=0
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"

if [[ $AUTO_UPDATE -eq 0 ]]; then
  if [[ -f "$SYSTEMD_USER_DIR/huepr-update.timer" ]]; then
    info "Weekly auto-update timer already installed — huepr-uninstall removes it"
  else
    info "Weekly auto-update not enabled (re-run with --auto-update to enable)"
  fi
elif systemctl --user status &>/dev/null; then
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
  warn "systemd user instance not available — skipping auto-update timer"
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
elif [[ ! -w "$WALLHOOK" ]]; then
  warn "$WALLHOOK is not writable — add this line to it yourself:"
  echo -e "       ${CY}WALLPAPER_PATH=\"\$WP\" \"$NOTIFY_BIN\" || true${RS}"
else
  cp -f "$WALLHOOK" "$WALLHOOK.huepr-bak"
  info "Backup: $WALLHOOK.huepr-bak"
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
WALLPAPER_PATH="$WP" "'"$NOTIFY_BIN"'" || true' "$WALLHOOK"
    ok "Hook injected before exit 0 in $WALLHOOK"
  fi
fi

# ── 8. Summary ────────────────────────────────────────────────────────────────
echo -e "\n${BL}──────────────────────────────────────────${RS}"
echo -e "  ${GR}Installation complete!${RS}"
echo -e "${BL}──────────────────────────────────────────${RS}\n"

if [[ $DEV_MODE -eq 1 ]]; then
  echo -e "  ${BW}Load the unpacked extension (--dev):${RS}"
  echo -e "  about:debugging → This Firefox → Load Temporary Add-on"
  echo -e "  → ${CY}$EXT_DEST/manifest.json${RS}"
  echo -e "  ${DM}Temporary add-ons are removed when the browser closes.${RS}\n"
elif [[ $EXT_INSTALLED -eq 1 ]]; then
  echo -e "  ${BW}Next step:${RS} Restart your browser."
  echo -e "  Approve Huepr when the browser asks about the new add-on"
  echo -e "  (or enable it in about:addons).\n"
fi

echo -e "  ${BW}Options:${RS} Right-click the Huepr icon → Manage Extension → Preferences"
echo -e "  ${BW}Themes:${RS}  Add themes in Options → Themes tab (name must match wallpaper filename)"
echo -e "  ${DM}Git directory can now be deleted${RS}"
echo -e "  ${DM}Run huepr-update anytime to update to the latest version${RS}"
echo -e "  ${DM}Run huepr-uninstall to remove everything Huepr installed${RS}"
if [[ $SYSTEMD_TIMER_INSTALLED -eq 1 ]]; then
  echo -e "  ${GR}Auto-update enabled (weekly)${RS}"
fi
echo ""
