#!/usr/bin/env python3
"""
Pythonista LAN server for OBS Browser Sources (static HTML + assets).
- Serves files from WEB_ROOT directory, so place beside asset files
- Binds to 0.0.0.0 so other devices can reach it
- Prints the most likely LAN IP and the exact URLs to use in OBS
"""

import os
import sys
import socket
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# --- CONFIG ---
PORT = 8789  # pick any free port (8789 matches your docker example)
WEB_ROOT = Path(__file__).resolve().parent  # folder containing this script + your html files
# --------------


class NoCacheHandler(SimpleHTTPRequestHandler):
    # Make OBS refresh behaviour predictable while iterating
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    # Optional: quieter logs
    def log_message(self, fmt, *args):
        sys.stdout.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))


def get_lan_ip() -> str:
    """
    Determine the LAN IPv4 address by opening a UDP socket to a private network IP.
    No packets need to actually be received; this selects the correct outbound interface.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Any RFC1918 address works; this doesn't need to be reachable.
        s.connect(("192.168.0.1", 80))
        return s.getsockname()[0]
    except OSError:
        # Fallback: hostname lookup (less reliable)
        return socket.gethostbyname(socket.gethostname())
    finally:
        s.close()


def main():
    if not WEB_ROOT.exists():
        raise SystemExit(f"WEB_ROOT does not exist: {WEB_ROOT}")

    os.chdir(WEB_ROOT)

    host_ip = get_lan_ip()

    print("=" * 58)
    print("Pythonista OBS Page Server")
    print("=" * 58)
    print(f"Serving directory: {WEB_ROOT}")
    print(f"Binding: 0.0.0.0:{PORT}")
    print(f"Detected LAN IP: {host_ip}")
    print("-" * 58)
    print("OBS URLs:")
    print(f"  http://{host_ip}:{PORT}/index.html")
    print(f"  http://{host_ip}:{PORT}/procedural.html")
    print(f"  http://{host_ip}:{PORT}/wall.html")
    print("-" * 58)
    print("Tip: in OBS Browser Source set 1080x1920 for 9:19.")
    print("=" * 58)

    server = ThreadingHTTPServer(("0.0.0.0", PORT), NoCacheHandler)

    # Run server until you stop the script
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("\nServer stopped.")


if __name__ == "__main__":
    main()