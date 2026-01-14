#!/usr/bin/env python3
"""
obs_ws_bridge.py (Pythonista-friendly)
- Runs a tiny HTTP server on your iPhone.
- Serves obs_ws_bridge.html from the same folder.
- Bridges HTTP -> obs-websocket v5 over a raw WebSocket client (no external deps).

Quick start (iPhone):
1) Put obs_ws_bridge.py and obs_ws_bridge.html in the same folder in Pythonista.
2) Edit OBS_HOST / OBS_PASSWORD below.
3) Run this script in Pythonista.
4) Open Safari on the iPhone: http://127.0.0.1:8788/

Notes:
- OBS must have Tools -> WebSocket Server enabled (default port 4455).
- This implements obs-websocket v5 auth + request/response + a few useful endpoints.
"""

import base64
import hashlib
import json
import os
import socket
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# ---------------------------
# Config (EDIT THESE)
# ---------------------------
OBS_HOST = "192.168.0.25"      # <-- OBS machine LAN IP
OBS_PORT = 4455               # default obs-websocket v5 port
OBS_PASSWORD = "CHANGE_ME"    # <-- OBS WebSocket password (Tools -> WebSocket Server Settings)

HTTP_HOST = "0.0.0.0"
HTTP_PORT = 8788

HTML_FILENAME = "obs_ws_bridge.html"

# ---------------------------
# Tiny WebSocket client (RFC6455) - enough for obs-websocket v5 JSON text frames
# ---------------------------

def _sha256_bytes(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()

def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("utf-8")

def _recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("Socket closed")
        buf += chunk
    return buf

def _ws_mask(payload: bytes, mask_key: bytes) -> bytes:
    out = bytearray(payload)
    for i in range(len(out)):
        out[i] ^= mask_key[i % 4]
    return bytes(out)

class RawWebSocket:
    """
    Minimal client-side websocket:
    - handshake
    - send text
    - recv frames (text, close, ping/pong)
    """
    def __init__(self, host: str, port: int, use_ssl: bool = False, timeout: float = 5.0):
        self.host = host
        self.port = port
        self.use_ssl = use_ssl
        self.timeout = timeout
        self.sock = None
        self._lock = threading.Lock()

    def connect(self, path: str = "/"):
        # TCP connect
        s = socket.create_connection((self.host, self.port), timeout=self.timeout)
        s.settimeout(self.timeout)

        if self.use_ssl:
            ctx = ssl.create_default_context()
            s = ctx.wrap_socket(s, server_hostname=self.host)

        # WS handshake
        key = _b64(os.urandom(16))
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        ).encode("utf-8")

        s.sendall(req)

        # Read HTTP response headers
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = s.recv(4096)
            if not chunk:
                raise ConnectionError("Handshake failed (socket closed)")
            resp += chunk

        header_blob = resp.split(b"\r\n\r\n", 1)[0].decode("utf-8", errors="replace")
        if " 101 " not in header_blob:
            raise ConnectionError(f"Handshake failed: {header_blob}")

        # Optionally validate Sec-WebSocket-Accept (nice but not strictly required)
        # accept = base64(sha1(key + GUID))
        # We'll skip strict validate for simplicity.

        self.sock = s

    def close(self):
        with self._lock:
            if self.sock:
                try:
                    self._send_frame(opcode=0x8, payload=b"")
                except Exception:
                    pass
                try:
                    self.sock.close()
                except Exception:
                    pass
                self.sock = None

    def send_text(self, text: str):
        payload = text.encode("utf-8")
        with self._lock:
            self._send_frame(opcode=0x1, payload=payload)

    def recv_message(self) -> str:
        """
        Blocking read for next TEXT message (returns decoded string).
        Auto-replies to ping with pong.
        """
        while True:
            fin, opcode, payload = self._recv_frame()
            if opcode == 0x1:  # text
                return payload.decode("utf-8", errors="replace")
            if opcode == 0x8:  # close
                self.close()
                raise ConnectionError("WebSocket closed by server")
            if opcode == 0x9:  # ping
                # pong same payload
                with self._lock:
                    self._send_frame(opcode=0xA, payload=payload)
                continue
            if opcode == 0xA:  # pong
                continue
            # ignore other opcodes

    def _send_frame(self, opcode: int, payload: bytes):
        if not self.sock:
            raise ConnectionError("Not connected")

        fin = 0x80
        b1 = fin | (opcode & 0x0F)

        # client MUST mask
        mask_bit = 0x80
        ln = len(payload)

        if ln < 126:
            header = bytes([b1, mask_bit | ln])
        elif ln < (1 << 16):
            header = bytes([b1, mask_bit | 126]) + ln.to_bytes(2, "big")
        else:
            header = bytes([b1, mask_bit | 127]) + ln.to_bytes(8, "big")

        mask_key = os.urandom(4)
        masked = _ws_mask(payload, mask_key)

        self.sock.sendall(header + mask_key + masked)

    def _recv_frame(self):
        if not self.sock:
            raise ConnectionError("Not connected")

        h = _recv_exact(self.sock, 2)
        b1, b2 = h[0], h[1]

        fin = (b1 & 0x80) != 0
        opcode = b1 & 0x0F

        masked = (b2 & 0x80) != 0
        ln = b2 & 0x7F

        if ln == 126:
            ln = int.from_bytes(_recv_exact(self.sock, 2), "big")
        elif ln == 127:
            ln = int.from_bytes(_recv_exact(self.sock, 8), "big")

        mask_key = b""
        if masked:
            mask_key = _recv_exact(self.sock, 4)

        payload = _recv_exact(self.sock, ln) if ln else b""
        if masked:
            payload = _ws_mask(payload, mask_key)

        return fin, opcode, payload

# ---------------------------
# obs-websocket v5 client
# ---------------------------

class OBSWSClient:
    """
    obs-websocket v5:
    - Connect, handle Hello -> Identify (auth)
    - Send Request (op=6) and await Response (op=7)
    """
    def __init__(self, host: str, port: int, password: str, use_ssl: bool = False):
        self.host = host
        self.port = port
        self.password = password
        self.use_ssl = use_ssl

        self.ws = None
        self._rx_thread = None
        self._stop = threading.Event()

        self._connected = False
        self._conn_lock = threading.Lock()

        self._req_lock = threading.Lock()
        self._pending = {}  # requestId -> {"event": Event, "resp": dict}

        self._last_error = None
        self._last_hello = None

    def connect(self):
        with self._conn_lock:
            if self._connected:
                return

            self._stop.clear()
            self._last_error = None

            ws = RawWebSocket(self.host, self.port, use_ssl=self.use_ssl, timeout=8.0)
            ws.connect(path="/")
            self.ws = ws

            # Expect Hello (op=0)
            hello = json.loads(self.ws.recv_message())
            self._last_hello = hello
            if hello.get("op") != 0:
                raise ConnectionError(f"Expected Hello (op=0), got: {hello}")

            d = hello.get("d", {}) or {}
            auth = d.get("authentication")

            identify = {
                "op": 1,
                "d": {
                    "rpcVersion": 1,
                    # eventSubscriptions optional; 0 means none
                    "eventSubscriptions": 0,
                }
            }

            # If OBS requires auth, compute it
            if auth and auth.get("challenge") and auth.get("salt"):
                challenge = auth["challenge"]
                salt = auth["salt"]
                identify["d"]["authentication"] = self._compute_auth(self.password, salt, challenge)

            # Send Identify
            self.ws.send_text(json.dumps(identify))

            # Expect Identified (op=2)
            identified = json.loads(self.ws.recv_message())
            if identified.get("op") != 2:
                raise ConnectionError(f"Expected Identified (op=2), got: {identified}")

            self._connected = True

            # Start RX thread (to handle responses)
            self._rx_thread = threading.Thread(target=self._rx_loop, daemon=True)
            self._rx_thread.start()

    def disconnect(self):
        with self._conn_lock:
            self._stop.set()
            self._connected = False
            if self.ws:
                try:
                    self.ws.close()
                except Exception:
                    pass
                self.ws = None

            # unblock all pending
            with self._req_lock:
                for rid, slot in list(self._pending.items()):
                    slot["resp"] = {"ok": False, "error": "disconnected"}
                    slot["event"].set()
                self._pending.clear()

    def is_connected(self) -> bool:
        return self._connected

    def last_error(self):
        return self._last_error

    def _compute_auth(self, password: str, salt: str, challenge: str) -> str:
        # obs-websocket v5 auth:
        # secret = base64( sha256(password + salt) )
        # auth = base64( sha256(secret + challenge) )
        secret = _b64(_sha256_bytes((password + salt).encode("utf-8")))
        auth = _b64(_sha256_bytes((secret + challenge).encode("utf-8")))
        return auth

    def _rx_loop(self):
        try:
            while not self._stop.is_set():
                msg = self.ws.recv_message()
                data = json.loads(msg)
                op = data.get("op")

                # Response: op=7
                if op == 7:
                    d = data.get("d", {}) or {}
                    rid = d.get("requestId")
                    if rid:
                        with self._req_lock:
                            slot = self._pending.get(rid)
                            if slot:
                                slot["resp"] = data
                                slot["event"].set()
                    continue

                # Events: op=5 (ignored here; you can extend later)
                continue

        except Exception as e:
            self._last_error = str(e)
            self.disconnect()

    def request(self, request_type: str, request_data: dict | None = None, timeout: float = 4.0) -> dict:
        """
        Returns a normalized dict:
        {
          "ok": bool,
          "requestType": str,
          "requestId": str,
          "responseData": dict | None,
          "raw": dict (full obs response)
        }
        """
        self.connect()

        rid = f"req_{int(time.time()*1000)}_{os.urandom(3).hex()}"
        slot = {"event": threading.Event(), "resp": None}

        with self._req_lock:
            self._pending[rid] = slot

        payload = {
            "op": 6,
            "d": {
                "requestType": request_type,
                "requestId": rid,
                "requestData": request_data or {}
            }
        }

        try:
            self.ws.send_text(json.dumps(payload))
        except Exception as e:
            self._last_error = str(e)
            self.disconnect()
            return {"ok": False, "requestType": request_type, "requestId": rid, "responseData": None, "raw": {"error": str(e)}}

        if not slot["event"].wait(timeout=timeout):
            with self._req_lock:
                self._pending.pop(rid, None)
            return {"ok": False, "requestType": request_type, "requestId": rid, "responseData": None, "raw": {"error": "timeout"}}

        with self._req_lock:
            resp = self._pending.pop(rid, None)

        raw = (resp or {}).get("resp") or {"error": "missing_response"}
        d = raw.get("d", {}) or {}

        status = d.get("requestStatus", {}) or {}
        result = bool(status.get("result"))
        response_data = d.get("responseData") if isinstance(d.get("responseData"), dict) else None

        return {
            "ok": result,
            "requestType": request_type,
            "requestId": rid,
            "responseData": response_data,
            "raw": raw
        }

# Global OBS client
obs = OBSWSClient(OBS_HOST, OBS_PORT, OBS_PASSWORD, use_ssl=False)

# ---------------------------
# HTTP server
# ---------------------------

def _read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    raw = handler.rfile.read(length) if length else b"{}"
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}

def _send_json(handler: BaseHTTPRequestHandler, obj: dict, status: int = 200):
    data = json.dumps(obj).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)

def _send_html(handler: BaseHTTPRequestHandler, html: str, status: int = 200):
    data = html.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)

def _load_html() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, HTML_FILENAME)
    if not os.path.exists(path):
        return f"<h1>Missing {HTML_FILENAME}</h1><p>Put it next to obs_ws_bridge.py</p>"
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        p = urlparse(self.path).path

        if p == "/" or p == f"/{HTML_FILENAME}":
            return _send_html(self, _load_html())

        if p == "/health":
            return _send_json(self, {
                "ok": True,
                "bridge": f"http://{HTTP_HOST}:{HTTP_PORT}",
                "obs": {"host": OBS_HOST, "port": OBS_PORT, "connected": obs.is_connected(), "last_error": obs.last_error()}
            })

        if p == "/api/scenes":
            res = obs.request("GetSceneList", {})
            if not res["ok"]:
                return _send_json(self, res, 502)
            scenes = (res["responseData"] or {}).get("scenes", []) or []
            # Return simple list + raw
            return _send_json(self, {
                "ok": True,
                "scenes": [s.get("sceneName") for s in scenes if isinstance(s, dict)],
                "raw": res
            })

        if p == "/api/record/status":
            res = obs.request("GetRecordStatus", {})
            if not res["ok"]:
                return _send_json(self, res, 502)
            rd = res["responseData"] or {}
            return _send_json(self, {
                "ok": True,
                "outputActive": bool(rd.get("outputActive")),
                "outputPaused": bool(rd.get("outputPaused")),
                "outputTimecode": rd.get("outputTimecode"),
                "raw": res
            })

        return _send_json(self, {"ok": False, "error": "not_found", "path": p}, 404)

    def do_POST(self):
        p = urlparse(self.path).path
        body = _read_json(self)

        # Common helper to call OBS
        def call(req_type: str, req_data: dict | None = None):
            return obs.request(req_type, req_data or {})

        try:
            if p == "/api/scene":
                name = (body.get("name") or "").strip()
                if not name:
                    return _send_json(self, {"ok": False, "error": "missing_scene_name"}, 400)
                res = call("SetCurrentProgramScene", {"sceneName": name})
                return _send_json(self, res, 200 if res["ok"] else 502)

            if p == "/api/record/start":
                res = call("StartRecord", {})
                return _send_json(self, res, 200 if res["ok"] else 502)

            if p == "/api/record/stop":
                res = call("StopRecord", {})
                return _send_json(self, res, 200 if res["ok"] else 502)

            if p == "/api/mute":
                source = (body.get("source") or "").strip()
                mute = body.get("mute")
                if not source or mute is None:
                    return _send_json(self, {"ok": False, "error": "missing_source_or_mute"}, 400)
                res = call("SetInputMute", {"inputName": source, "inputMuted": bool(mute)})
                return _send_json(self, res, 200 if res["ok"] else 502)

            if p == "/api/text":
                # Set text for a text source (Text (GDI+) / Text (FreeType 2))
                # body: { "source": "LowerThird", "text": "Hello" }
                source = (body.get("source") or "").strip()
                text = body.get("text")
                if not source or text is None:
                    return _send_json(self, {"ok": False, "error": "missing_source_or_text"}, 400)
                # OBS expects inputSettings for the source type; most text sources use "text"
                res = call("SetInputSettings", {
                    "inputName": source,
                    "inputSettings": {"text": str(text)},
                    "overlay": True
                })
                return _send_json(self, res, 200 if res["ok"] else 502)

            return _send_json(self, {"ok": False, "error": "not_found", "path": p}, 404)

        except Exception as e:
            return _send_json(self, {"ok": False, "error": str(e)}, 500)

def main():
    print("=== OBS WS Bridge ===")
    print(f"HTTP:  http://127.0.0.1:{HTTP_PORT}/   (open on your iPhone)")
    print(f"OBS:   ws://{OBS_HOST}:{OBS_PORT}     (must be reachable on LAN)")
    print("")
    print("Endpoints:")
    print("  GET  /health")
    print("  GET  /api/scenes")
    print("  POST /api/scene         {name}")
    print("  POST /api/record/start  {}")
    print("  POST /api/record/stop   {}")
    print("  GET  /api/record/status")
    print("  POST /api/mute          {source, mute}")
    print("  POST /api/text          {source, text}")
    print("")

    server = HTTPServer((HTTP_HOST, HTTP_PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.server_close()
        except Exception:
            pass
        obs.disconnect()

if __name__ == "__main__":
    main()