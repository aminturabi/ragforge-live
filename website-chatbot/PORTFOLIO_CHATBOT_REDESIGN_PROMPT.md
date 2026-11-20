# Portfolio + RAGForge Chatbot Redesign - Improved Brief (v2, 2026-11-20)

Use this brief with any AI builder (or Muse) to redesign the portfolio's
chatbot and polish the portfolio page WITHOUT breaking what already works.
It is grounded in the real architecture - read the facts before designing.

## Ground truth (do not assume anything else)

- Portfolio: ONE static page - `index.html` + `style.css` + `script.js`,
  Bootstrap 5, dark theme (deep navy `#0a0e1a`). No framework, no router,
  no components, no build step. Repo: `aminturabi/Portfolio` (push to main
  auto-deploys on Vercel).
- Chatbot: a reusable product widget, NOT portfolio page code. One
  self-contained file, `frontend/ragforge-chat.js` in repo
  `aminturabi/ragforge-live`, served at
  https://ragforge-live.onrender.com/ragforge-chat.js. Zero dependencies,
  all styles scoped inside a Shadow DOM so it can never clash with a host
  site's CSS. The same widget is sold to customers for THEIR websites.
- Embedding contract (never change): the host page sets
  `window.RAGForgeChatConfig` ({ apiBase, collection, title, subtitle,
  welcomeMessage, placeholder, primaryColor, position }) and loads the
  script. All per-site text/branding must come from this config - never
  hard-code "Amin" inside the widget.
- API: `POST /api/query` { query, collection_name, top_k } returns
  { success, answer, context: [raw text chunks] }. There is NO streaming
  endpoint - answers arrive whole. Sources are raw chunks of ONE knowledge
  document: no titles, no URLs, no metadata exist - never fabricate them.
- The backend is a free-tier service that sleeps; the first request can
  take ~30-50s or fail. The widget already shows a typing indicator and a
  friendly error with Retry - preserve both.
- Existing widget features to preserve: open/close bubble, message history
  (localStorage), follow-up question expansion, Sources toggle, Clear
  (new conversation), Retry on error, mobile layout.
- The portfolio knowledge base answers ONLY: Amin's skills, his projects
  (ReceiptLens, JobShield AI, MediSense AI, RAGForge, AI Resume Screening,
  Clinic Booking Agent, TailorBook), education (UET Mardan, CGPA 3.31),
  experience (ITSimplera + CodeClub internships), services + Fiverr chatbot
  pricing ($85/$220/$450), availability (paid remote, ~20 hrs/week),
  contact (email, LinkedIn, GitHub, Fiverr). VoiceBridge is deliberately
  NOT in the portfolio or the knowledge base - do not add it anywhere.
- There is no user authentication on the portfolio or the widget. (An
  admin password gate exists on the separate dashboard; it is out of scope.)

## Task 1 - Redesign the chatbot widget (highest priority)

Keep every behavior above; change only presentation and these additions:

1. Header: config title + subtitle, a small avatar circle (initials or a
   simple SVG mark), a green "online" dot, and the existing Clear action
   as a clean icon button. Compact on mobile.
2. Welcome state (no messages yet): heading and text from config (new
   optional config keys `welcomeHeading`, keep `welcomeMessage`), plus
   suggestion chips.
3. Suggestion chips: NEW optional config array `suggestions`; clicking a
   chip sends it as a message. For the portfolio instance use exactly:
   - "What projects has Amin built?"
   - "What are Amin's AI/ML skills?"
   - "How can I hire Amin?"
   - "Can Amin build a chatbot for my business?"
   - "Tell me about Amin's education and experience."
   - "Is Amin available for remote work?"
   Every chip must be a question the knowledge base can actually answer.
4. Messages: user bubbles in the config primary color; AI messages clean
   and readable with paragraph spacing, bold and lists rendered properly,
   comfortable max-width, no oversized bubbles.
5. Sources: keep the expandable panel, restyle it; label chunks
   "Source 1", "Source 2"... with short excerpts. Nothing more exists.
6. Input: rounded field, placeholder from config, send icon button,
   disabled while a request is in flight, Enter to send, visible focus
   ring. On mobile the panel uses dynamic viewport height (dvh) so the
   input stays above the on-screen keyboard; no horizontal overflow at
   360px wide.
7. Add a copy button on AI messages (client-side only, with a brief
   "Copied" confirmation). Do NOT fake streaming - keep the typing dots.
8. Respect prefers-reduced-motion; keep all CSS inside the Shadow DOM;
   no new dependencies; the file must stay a single self-contained script.

## Task 2 - Portfolio page polish (secondary, conservative)

- KEEP the existing dark theme and layout structure. Polish spacing,
  typography and hierarchy only; do not flip to a light theme or rebuild
  sections without explicit approval.
- Skills: group the EXISTING skills into categories (Languages, Machine
  Learning, Deep Learning & CV, GenAI & RAG, Backend & Apps, Tools).
  Only skills already on the page - invent none.
- Projects: keep the existing projects and order (ReceiptLens first).
  Improve card hierarchy: name, one-line description, tech tags, GitHub
  and live-demo links where they already exist. Invent no metrics.
- Hero/contact: keep content; make GitHub, LinkedIn, email and the
  chatbot easy to find. Do not add a resume link unless the file exists.

## Verification (all must pass before calling it done)

- Send a message -> correct answer from the live API.
- Follow-up ("and what about his experience?") still works.
- All 6 suggestion chips return real answers.
- Sources expand/collapse; Clear starts a new conversation; copy works.
- Error + Retry still appear when the API base is temporarily wrong.
- 360px Android viewport: no overflow, input visible with keyboard open.
- The widget still embeds correctly on a blank test page (customer-site
  compatibility) and the portfolio page has no console errors.
- The embed snippet on the portfolio is unchanged except config values.

## Deliverable summary

List: files changed, what visually changed, what was preserved, test
results, and any remaining limitations.
