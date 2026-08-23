"""Serve this folder for the game.

`python -m http.server` handles one request at a time and logs every one to the
console. With ~1150 sprite files that turns a cold load into a crawl, and the
logging itself costs more than the file reads.

This is the same thing with three fixes:
  * HTTP/1.1, so connections are REUSED -- 1.0 tears down the socket after
    every file, which is most of the cost when there are 1150 of them
  * threaded, so the browser's six parallel connections are actually parallel
  * no per-request logging
  * long cache headers, so a reload is instant instead of 1150 revalidations
"""

import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(SimpleHTTPRequestHandler):
    # SimpleHTTPRequestHandler speaks HTTP/1.0 by default, which means NO
    # keep-alive: every one of the ~1150 sprite files opens and tears down its
    # own TCP connection. Announcing 1.1 lets the browser reuse six connections
    # for the whole load, which is the single biggest win here.
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass                                   # silence: 1150 lines is noise

    def end_headers(self):
        # The sprites never change without a rebuild, so let the browser keep
        # them. This is what makes the second load instant.
        if self.path.startswith("/sprites/"):
            self.send_header("Cache-Control", "public, max-age=604800")
        self.end_headers_orig()

    def __init__(self, *a, **kw):
        self.end_headers_orig = super().end_headers
        super().__init__(*a, **kw)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    handler = partial(Handler, directory=here)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    srv.daemon_threads = True
    print("Fleck is running -- open  http://localhost:%d/fleck.html" % PORT)
    print("Close this window to stop it.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
