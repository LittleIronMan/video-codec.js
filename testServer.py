#!/usr/bin/env python3
# encoding: utf-8
"""Use instead of `python3 -m http.server` when you need CORS"""

from http.server import HTTPServer, SimpleHTTPRequestHandler


class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")

        if self.path.endswith(".wasm"):
            # Header to serve .wasm file
            self.send_header("Content-Type", "application/wasm")
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')

        return super(CORSRequestHandler, self).end_headers()

with HTTPServer(('localhost', 8003), CORSRequestHandler) as httpd:
    httpd.serve_forever()