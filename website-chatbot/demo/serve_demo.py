#!/usr/bin/env python3
"""One-command demo for the RAGForge website chatbot widget.

Run:
    python3 demo/serve_demo.py
Then open:
    http://localhost:8000

Serves a sample clinic website with the widget embedded, the widget
script itself, and the sample knowledge-base document. The page's
"Load demo knowledge base" button uploads the sample document to the
live RAGForge backend through its existing /api/upload endpoint and
connects the chat - no backend changes involved.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
WIDGET = HERE.parent / "widget" / "ragforge-chat.js"
PORT = 8000

PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CityCare Clinic - Demo Website with RAGForge Chatbot</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
  body { color: #1c2430; background: #f6f7f9; }
  header { background: #0f766e; color: #fff; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  header h1 { font-size: 22px; }
  header p { font-size: 13px; opacity: .85; }
  main { max-width: 860px; margin: 0 auto; padding: 28px 20px 90px; }
  .card { background: #fff; border: 1px solid #e3e7ee; border-radius: 12px; padding: 20px 22px; margin-bottom: 16px; }
  .card h2 { font-size: 17px; margin-bottom: 10px; color: #0f766e; }
  .card p, .card li { font-size: 14.5px; line-height: 1.65; color: #3c4656; }
  .card ul { padding-left: 18px; }
  .setup { background: #fff8e6; border: 1px solid #ecd9a0; }
  .setup h2 { color: #7a5b00; }
  .setup button { background: #0f766e; color: #fff; border: none; border-radius: 8px; padding: 10px 16px; font-size: 14px; cursor: pointer; margin-top: 10px; }
  .setup button:disabled { opacity: .5; cursor: default; }
  .setup .status { margin-top: 10px; font-size: 13.5px; }
  code { background: rgba(0,0,0,.06); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
</style>
</head>
<body>

<header>
  <div>
    <h1>CityCare Clinic</h1>
    <p>Shamsi Road, Mardan - Mon-Sat 9 AM to 9 PM</p>
  </div>
  <p>Demo website - the chat bubble at the bottom right is the RAGForge widget</p>
</header>

<main>
  <div class="card setup">
    <h2>Demo setup (one click)</h2>
    <p>
      This page embeds the RAGForge chatbot widget. The widget needs the name of a
      knowledge-base collection on the RAGForge backend. Click the button to upload the
      sample clinic document to the live backend through its existing
      <code>/api/upload</code> endpoint - the returned collection name is saved in your
      browser and the page reloads with the chat connected.
    </p>
    <button id="setupBtn">Load demo knowledge base</button>
    <p class="status" id="setupStatus"></p>
  </div>

  <div class="card">
    <h2>Our services</h2>
    <ul>
      <li>General physician, gynecology, pediatrics and dermatology OPD</li>
      <li>Laboratory tests - CBC, blood sugar, lipid profile, LFT and more</li>
      <li>ECG, ultrasound and X-Ray</li>
      <li>Dental cleaning, nebulization and IV therapy</li>
    </ul>
  </div>

  <div class="card">
    <h2>Try the chat</h2>
    <p>Open the chat bubble and ask things like:</p>
    <ul>
      <li>"What is the fee for the gynecologist?"</li>
      <li>"When does the skin doctor sit?" - then follow up: "and what does she charge?"</li>
      <li>"How should I prepare for a lipid profile test?"</li>
      <li>"Can I get my report on WhatsApp?"</li>
    </ul>
    <p style="margin-top:8px">The follow-up pair shows the widget's conversation context:
    short follow-ups are expanded with your previous question before they reach the RAG
    backend, whose API stays stateless and unchanged.</p>
  </div>
</main>

<script>
  var API_BASE = "https://ragforge-live.onrender.com";
  var STORAGE_KEY = "ragforge-demo-collection";

  var setupBtn = document.getElementById("setupBtn");
  var setupStatus = document.getElementById("setupStatus");
  var savedCollection = null;
  try { savedCollection = localStorage.getItem(STORAGE_KEY); } catch (e) {}

  if (savedCollection) {
    setupStatus.textContent = "Knowledge base connected: " + savedCollection + " - the chat is ready.";
    setupBtn.textContent = "Reload demo knowledge base";
  }

  setupBtn.addEventListener("click", function () {
    setupBtn.disabled = true;
    setupStatus.textContent = "Uploading sample document to the RAGForge backend (a free-tier server may take up to a minute to wake up)...";
    fetch("/sample-clinic.txt")
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        var form = new FormData();
        form.append("file", blob, "sample-clinic.txt");
        return fetch(API_BASE + "/api/upload", { method: "POST", body: form });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.success) throw new Error(data.error || "Upload failed");
        try { localStorage.setItem(STORAGE_KEY, data.collection_name); } catch (e) {}
        setupStatus.textContent = "Indexed " + data.chunks_count + " chunks as " + data.collection_name + ". Reloading with the chat connected...";
        setTimeout(function () { location.reload(); }, 800);
      })
      .catch(function (err) {
        setupStatus.textContent = "Setup failed: " + err.message + " - is the backend awake? Try again in a few seconds.";
        setupBtn.disabled = false;
      });
  });

  // ---- The actual website integration: just this config + one script tag --
  window.RAGForgeChatConfig = {
    apiBase: API_BASE,
    collection: savedCollection || "",
    title: "CityCare Clinic",
    subtitle: "Ask about services, fees and timings",
    welcomeMessage: "Assalam-o-Alaikum! Ask me about our doctors, fees, test prices or timings.",
    placeholder: "e.g. What is the CBC test price?",
    primaryColor: "#0f766e"
  };
</script>
<script src="/ragforge-chat.js" defer></script>

</body>
</html>
"""


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 (stdlib naming)
        if self.path in ("/", "/index.html"):
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/ragforge-chat.js":
            body = WIDGET.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/sample-clinic.txt":
            body = (HERE / "sample-clinic.txt").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_error(404)

    def log_message(self, *args):  # keep the console clean
        pass


if __name__ == "__main__":
    print(f"Demo running at http://localhost:{PORT}  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
