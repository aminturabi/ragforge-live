# RAGForge Website Chatbot - Complete Setup Guide

Everything needed to put an AI chatbot (trained on a business's own documents,
prices and FAQs) onto any website, with an admin dashboard to manage it.

Backend (already live): https://ragforge-live.onrender.com
Admin dashboard (live): https://ragforge-live.onrender.com/admin.html
Widget file (live): https://ragforge-live.onrender.com/ragforge-chat.js

---

## 1. What is in this package

| Folder / file | What it is |
|---|---|
| `widget/ragforge-chat.js` | The embeddable chat widget (single file, no dependencies) |
| `admin/` | The admin dashboard (manage content, publish, test, analytics) |
| `admin/dist/` | The exact admin files that are live on the server |
| `demo/` | A demo clinic website page + sample clinic data |
| `kb/merge_kb.py` | Helper: merge several text files into one knowledge-base document |
| `kb/amin-portfolio-kb.txt` | The knowledge base behind the portfolio chatbot |
| `kb/sample-documents-here.txt` | Where to drop documents for merging |
| `tests/` | Smoke tests for the widget and dashboard |
| `README.md` | Full technical reference |

## 2. Connect the chatbot to a CUSTOMER website

### Step 1 - Train their bot
Open the admin dashboard, enter the customer's business info, services,
prices and FAQs (tap Save for each item), then open **Publish** and click
**Build & publish now**. This creates the customer's own knowledge base
(a "collection"). Every customer gets a separate collection.

### Step 2 - Generate their embed code
In the dashboard open **Embed & Deploy**, set their name, color and welcome
message, copy the generated code. It looks like this:

```html
<script>
  window.RAGForgeChatConfig = {
    apiBase: "https://ragforge-live.onrender.com",
    collection: "THEIR_COLLECTION_NAME",
    title: "Their Business Name",
    subtitle: "Ask about services, fees and timings",
    welcomeMessage: "Hello! Ask me about our services and prices.",
    primaryColor: "#0f766e"
  };
</script>
<script src="https://ragforge-live.onrender.com/ragforge-chat.js" defer></script>
```

### Step 3 - Paste it into their website
Just before the closing `</body>` tag, on every page (or in the site template):

- Plain HTML site: paste into the page/template file
- WordPress: a header/footer plugin (e.g. WPCode) or theme footer
- Wix: Settings -> Custom Code -> Body, apply to all pages
- Squarespace: Settings -> Advanced -> Code Injection (footer)
- Shopify: theme.liquid, before `</body>`

### Step 4 - Done
The chat bubble appears. Visitors ask questions; the bot answers only from
the customer's published content. To update prices or FAQs later, edit the
dashboard and Publish again - the website code never changes.

## 3. Run it locally (for development)

```bash
# Demo clinic website with the widget
python3 demo/serve_demo.py          # http://localhost:8000

# Admin dashboard
python3 admin/serve_admin.py        # http://localhost:8100

# Tests
node tests/smoke.test.js
node tests/admin_smoke.test.js
```

The dashboard can also fetch a customer's website pages into the knowledge
base: `python3 admin/fetch_urls.py https://example.com/pricing`

## 4. How "training" works (honest version)

There is no model training. Publish composes ONE document from everything
entered (business info + services + prices + FAQs + website content +
instructions + support info) and uploads it to the backend, which indexes it
(embeddings + vector store). The chatbot retrieves the most relevant chunks
of that document and answers from them, with the owner's fallback message
when the answer is not covered.

## 5. Known limitations (read before selling)

1. **Uploads do not persist.** The free Render backend keeps collections in
   memory; a server restart wipes them and content must be re-published.
   Fix before charging customers: persistent vector storage.
2. **Password gate (added 2026-11-20).** When the server has an `ADMIN_KEY`
   environment variable set, the admin page opens with a lock screen and the
   server itself refuses collection deletions without the key
   (`X-Admin-Key` header on `/api/clear`; status via `/api/admin-status`,
   check via `/api/admin-verify`). Dashboard data still lives in each
   visitor's own browser. Uploads and visitor queries stay public by design.
   On the live server ADMIN_KEY is set, so the gate is ON.
3. **Real visitor analytics need a backend logging endpoint** - currently
   the Conversations / Unanswered / Analytics pages run on the dashboard's
   built-in test chat log.
4. One collection answers at a time - that is why Publish merges everything
   into a single document (see `kb/merge_kb.py`).

## 6. Live examples

- Portfolio chatbot: https://aminkhanofficial.vercel.app (bottom-right bubble,
  "Ask about Amin")
- Main app: https://ragforge-live.onrender.com
- Code: https://github.com/aminturabi/ragforge-live
