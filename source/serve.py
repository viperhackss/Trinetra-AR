import http.server, socketserver, os, sys
os.chdir(sys.argv[1])
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
S(('127.0.0.1', int(sys.argv[2]) if len(sys.argv) > 2 else 8765), H).serve_forever()
