# RAGForge Website Chatbot

Turns the existing **RAGForge** backend into a chatbot you can embed in any
website - a floating chat bubble your visitors talk to, answered from your
own documents. **The RAGForge backend is not changed at all.** The widget
uses the API exactly as it exists today:

| Endpoint | Use |
|---|---|
| `GET  /api/config` | Check the server has its own Groq key |
| `POST /api/upload` | Owner-side: index a knowledge-base document |
| `POST /api/query`  | Widget-side: `{ query, collection_name, top_k }` → `{ answer, context[] }` |
| `POST /api/clear`  | Owner-side: remove a knowledge base |

CORS is already open on the backend (`CORS(app)` in `api/app_factory.py`),
so the widget can live on a different domain than the API.

## What's in this package

```
widget/ragforge-chat.js   The whole chatbot: one self-contained JS file
demo/serve_demo.py        One-command demo (sample clinic website)
demo/sample-clinic.txt    Sample knowledge base used by the demo
kb/merge_kb.py            Merge many .txt/.md files into one knowledge base
tests/smoke.test.js       Node smoke tests for the widget logic + API client
```

## Quick start (see it working in 2 minutes)

```bash
cd ragforge-website-chatbot
python3 demo/serve_demo.py
# open http://localhost:8000
```

Click **Load demo knowledge base** once - it uploads `sample-clinic.txt` to
the live RAGForge backend and connects the chat. Then use the bubble at the
bottom right. (The free-tier backend may take up to a minute to wake up on
the first request.)

Run the tests any time with:

```bash
node tests/smoke.test.js
```

## Add it to a real website

**Step 1 - Build the knowledge base (owner, one time).**
The current backend creates one collection per uploaded file, so prepare
ONE combined document per website. For text sources:

```bash
python3 kb/merge_kb.py ./my-docs ./knowledge-base.txt
```

Upload it (a PDF works too - upload the PDF directly instead):

```bash
curl -F "file=@knowledge-base.txt" https://ragforge-live.onrender.com/api/upload
# -> { "success": true, "collection_name": "col_xxxxxxxx_knowledge-base", "chunks_count": 42, ... }
```

Keep the returned `collection_name` - it is the chatbot's brain address.

**Step 2 - Embed the widget (two tags, that's all).**

```html
<script>
  window.RAGForgeChatConfig = {
    apiBase: "https://ragforge-live.onrender.com",
    collection: "col_xxxxxxxx_knowledge-base",
    title: "CityCare Clinic",
    subtitle: "Ask about services, fees and timings",
    welcomeMessage: "Hi! Ask me about our services, prices or timings.",
    primaryColor: "#0f766e"
  };
</script>
<script src="https://your-host/ragforge-chat.js" defer></script>
```

Host `ragforge-chat.js` anywhere static (the same website, a CDN, or the
RAGForge repo's `frontend/` folder so Render serves it). The widget renders
in a Shadow DOM, so the site's CSS cannot break it and it cannot break the
site. It works on plain HTML, WordPress (paste into a Custom HTML block /
theme footer), Webflow, Wix (embed element), and any framework - it is
framework-free vanilla JS with zero dependencies.

## Configuration reference

| Option | Default | Meaning |
|---|---|---|
| `apiBase` | `""` (same origin) | Base URL of the RAGForge backend, no trailing slash |
| `collection` | `""` | Knowledge-base `collection_name` from Step 1 (required) |
| `title` / `subtitle` | "Chat with us" | Header text |
| `welcomeMessage` | generic greeting | First assistant message |
| `placeholder` | "Type your question..." | Input hint |
| `primaryColor` | `#0f766e` | Header, launcher and user bubbles |
| `position` | `"right"` | `"left"` moves the bubble to the left |
| `topK` | `4` | Document chunks retrieved per question |
| `showSources` | `true` | Show the retrieved chunks under each answer |
| `persistHistory` | `true` | Keep the conversation in the visitor's `localStorage` |
| `maxHistory` | `50` | Messages kept before the oldest are dropped |
| `contextFollowUps` | `true` | Expand short follow-ups with the previous question (see below) |
| `requestTimeoutMs` | `90000` | How long to wait for a (possibly sleeping) backend |

Programmatic control, if a page wants it:

```js
RAGForgeChat.open();
RAGForgeChat.close();
```

## How conversation context works

RAGForge's `/api/query` is stateless - it answers one question at a time.
The widget keeps the full conversation on the client (visible history +
`localStorage` persistence) and, when a message reads like a follow-up
("and what does she charge?", "what about weekends?"), it prepends the
previous question before retrieval, so the right chunks still come back.
Standalone questions are sent untouched. The widget also sends the recent
history in the request body; the current backend safely ignores it, so if
server-side multi-turn context is ever added, the widget is already ready.

## Updating the knowledge base

Re-upload a fresh combined document (Step 1), then change `collection` in
the embed config to the new `collection_name`. Optionally remove the old
one: `POST /api/clear` with `{ "collection_name": "..." }`.

## Deploying

- **Widget file:** any static host. If you add it to the RAGForge repo's
  `frontend/` folder, the existing Render service serves it at
  `https://ragforge-live.onrender.com/ragforge-chat.js` with zero backend
  changes (Flask already serves that folder).
- **Backend:** unchanged - the existing Render deployment is the API.
  Point `apiBase` at it from any website.
- **Local backend instead:** run RAGForge as usual
  (`python app.py`, port 5000) and set `apiBase: "http://localhost:5000"`.

## Honest limitations (know these before selling it)

1. **One collection per chat.** A website's knowledge base is one combined
   document (see `kb/merge_kb.py`). Multi-collection search would need a
   small backend change - deliberately not made here.
2. **Free-tier backend sleeps.** On Render's free tier the first question
   after idle can take 30-60 seconds; the widget's typing indicator and
   90-second timeout cover this, and the error message tells the visitor
   to retry. A paid instance removes the wait.
3. **Uploads do not persist across backend restarts** on the current live
   deployment (in-memory vector store), so a knowledge base may need
   re-uploading after a restart. For a paying client, move the backend to
   a persistent vector store first.
4. **No visitor authentication.** Anyone who can see the page can query
   the collection - fine for public information (prices, services, FAQs).
   Never put private documents in a website chatbot's knowledge base.
5. **API cost is the owner's.** Answers are generated with the backend's
   Groq key, so the site owner pays for usage; add rate limiting before
   heavy public traffic.

## Files verified

- Widget logic + API client: `node tests/smoke.test.js` (7 tests).
- Live contract: `/api/config`, `/api/upload`, `/api/query`, `/api/clear`
  exercised against the production backend - see the project notes.
