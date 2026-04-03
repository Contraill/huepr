#!/usr/bin/env python3
"""
Huepr Native Messaging Host — persistent process, named-pipe triggered.

Startup:
  1. Reads the wallpaper name from ~/.cache/caelestia/last_wallpaper
  2. Immediately sends the wallpaper name to the extension via NM
  3. Creates ~/.cache/huepr/huepr.pipe (mkfifo)
  4. Waits for wallpaper paths on the pipe (blocking read)
     → on each path: sends the wallpaper name, then waits again

Theme colors are not resolved here; background.js reads them from
browser.storage.local.themes.

On browser close (stdin EOF):
  - stop_event is set
  - The pipe's write end is briefly opened (O_NONBLOCK) to unblock
    the main thread's os.open(O_RDONLY) call
  - Pipe file is deleted
  - Process exits

Trigger:  ~/.local/bin/huepr-notify
  printf '%s\\n' "$WALLPAPER_PATH" > ~/.cache/huepr/huepr.pipe
"""

import sys
import os
import json
import struct
import threading
import time
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────

CAELESTIA_CACHE = Path.home() / ".cache" / "caelestia" / "last_wallpaper"
# Named pipe (FIFO): decouples the wallpaper hook from the host process.
# The hook script (huepr-notify) writes the path; the host reads it.
# This avoids launching a new process per wallpaper change.
PIPE_PATH       = Path.home() / ".cache" / "huepr" / "huepr.pipe"

# ── Native Messaging I/O ──────────────────────────────────────────────────────
# Firefox NM protocol: 4-byte little-endian length prefix + UTF-8 JSON on stdout.

def nm_send(obj: dict) -> None:
    """Write 4-byte LE length prefix + JSON to stdout (NM protocol)."""
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

# ── Wallpaper Helpers ─────────────────────────────────────────────────────────

# Theme matching uses Path.stem to extract the filename without extension.
# e.g. /path/to/Aurora.jpg → "Aurora" — background.js matches this to a theme name.
def send_wallpaper_change(wp_input: str) -> bool:
    """
    wp_input: full path (/path/to/Aurora.jpg) or bare name (Aurora).
    Extracts the stem via Path.stem, notifies the extension via NM.
    Returns True on send, False on empty input.
    """
    name = Path(wp_input.strip()).stem
    if not name:
        return False
    nm_send({"type": "wallpaper_change", "wallpaper": name})
    return True

# ── Stdin Monitor — browser disconnect detection ──────────────────────────────
# Runs in a daemon thread. When stdin hits EOF (browser closed the NM channel),
# it signals the main thread to exit by setting stop_event and poking the pipe.

def monitor_stdin(stop_event: threading.Event) -> None:
    """
    Reads stdin. EOF means the browser closed the NM connection.
    Sets stop_event, then briefly opens the pipe's write end (O_NONBLOCK)
    to unblock the main thread's os.open(O_RDONLY) call.
    """
    while True:
        if not sys.stdin.buffer.read(1):   # EOF
            stop_event.set()
            try:
                fd = os.open(str(PIPE_PATH), os.O_WRONLY | os.O_NONBLOCK)
                os.close(fd)
            except OSError:
                pass
            return

# ── Pipe Cleanup ──────────────────────────────────────────────────────────────

def remove_pipe() -> None:
    PIPE_PATH.unlink(missing_ok=True)

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    # Ensure pipe directory exists and start clean
    PIPE_PATH.parent.mkdir(parents=True, exist_ok=True)
    remove_pipe()
    os.mkfifo(str(PIPE_PATH))

    # Start stdin monitor thread
    stop_event = threading.Event()
    threading.Thread(
        target=monitor_stdin, args=(stop_event,), daemon=True
    ).start()

    # Send initial wallpaper notification.
    # Startup can race with extension listener registration, so send twice.
    if CAELESTIA_CACHE.exists():
        content = CAELESTIA_CACHE.read_text(encoding="utf-8").strip()
        if content:
            for delay_s in (0.35, 1.25):
                if stop_event.is_set():
                    break
                time.sleep(delay_s)
                send_wallpaper_change(content)

    # Pipe read loop
    try:
        while not stop_event.is_set():
            # Blocking open: waits here until huepr-notify writes to the pipe.
            try:
                fd = os.open(str(PIPE_PATH), os.O_RDONLY)
            except OSError:
                break

            try:
                raw = os.read(fd, 4096)
            except OSError:
                raw = b""
            finally:
                os.close(fd)

            if stop_event.is_set():
                break

            wp_path = raw.decode(errors="replace").strip()
            if wp_path:
                send_wallpaper_change(wp_path)

    finally:
        remove_pipe()


if __name__ == "__main__":
    main()
