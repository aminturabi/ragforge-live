/*!
 * RAGForge Website Chatbot Widget
 * ===============================
 * A drop-in chat widget that turns the existing RAGForge backend into a
 * website chatbot. The backend is NOT modified - the widget talks to the
 * RAGForge Flask API exactly as it exists today:
 *
 *   GET  {apiBase}/api/config   -> { success, default_key }
 *   POST {apiBase}/api/query    -> { success, answer, context: [chunks] }
 *        body: { query, collection_name, top_k }
 *
 * Integration (two lines on any website):
 *
 *   <script>
 *     window.RAGForgeChatConfig = {
 *       apiBase: "https://ragforge-live.onrender.com",
 *       collection: "col_xxxxxxxx_your-knowledge-base",
 *       title: "Ask us anything"
 *     };
 *   </script>
 *   <script src="https://your-host/ragforge-chat.js" defer></script>
 *
 * The widget renders inside a Shadow DOM, so the host page's CSS can
 * never break it and its styles never leak into the host page.
 */
(function (global) {
  "use strict";

  /* ================================================================
   * 1. Configuration
   * ================================================================ */

  var DEFAULTS = {
    apiBase: "",              // "" = same origin as the page. No trailing slash.
    collection: "",           // RAGForge collection_name of the knowledge base (required)
    title: "Chat with us",
    subtitle: "Answers from our documents",
    welcomeHeading: "",       // optional big heading on the welcome screen ("" = use title)
    welcomeMessage: "Hi! Ask me anything about our services, prices or timings.",
    suggestions: [],          // optional starter questions, shown as chips on the welcome screen
    avatarText: "",           // optional initials for the header avatar ("" = spark icon)
    placeholder: "Type your question...",
    primaryColor: "#0f766e",  // header + launcher + user bubbles
    position: "right",        // "right" | "left"
    topK: 4,                  // chunks retrieved per question (backend default is 4)
    showSources: true,        // show the retrieved chunks under each answer
    persistHistory: true,     // keep the conversation in localStorage
    maxHistory: 50,           // messages kept (oldest dropped first)
    contextFollowUps: true,   // expand short follow-ups ("and the price?") with the previous question
    requestTimeoutMs: 90000,  // free-tier backends can be slow to wake up
    poweredBy: true
  };

  function mergeConfig(userCfg) {
    var cfg = {};
    var key;
    for (key in DEFAULTS) cfg[key] = DEFAULTS[key];
    if (userCfg) for (key in userCfg) if (userCfg[key] !== undefined) cfg[key] = userCfg[key];
    cfg.apiBase = String(cfg.apiBase || "").replace(/\/+$/, "");
    return cfg;
  }

  /* ================================================================
   * 2. Pure helpers (also exported for the Node smoke tests)
   * ================================================================ */

  var FOLLOW_UP_STARTERS = /^(and|but|so|then|also|what about|how about|ok and|okay and)\b/i;
  var REFERENCE_WORDS = /\b(it|that|this|them|they|he|she|his|her|their|its|those|these|one)\b/i;

  /**
   * RAGForge's /api/query is stateless, so conversation context is handled
   * on the client: when a message reads like a follow-up to the previous
   * question, the previous question is prepended so retrieval still finds
   * the right chunks. Standalone questions are sent untouched.
   */
  function expandFollowUp(text, history) {
    var clean = String(text || "").trim();
    if (!clean || !history || !history.length) return clean;
    var prevUser = null;
    for (var i = history.length - 1; i >= 0; i--) {
      if (history[i].role === "user") { prevUser = history[i].text; break; }
    }
    if (!prevUser || prevUser === clean) return clean;
    var words = clean.split(/\s+/).length;
    var looksLikeFollowUp =
      FOLLOW_UP_STARTERS.test(clean) ||
      (words <= 8 && REFERENCE_WORDS.test(clean)) ||
      words <= 3;
    if (!looksLikeFollowUp) return clean;
    return "Earlier question: " + prevUser + "\nFollow-up question: " + clean;
  }

  function buildQueryPayload(cfg, question, history) {
    return {
      query: String(question || "").trim(),
      collection_name: cfg.collection,
      top_k: cfg.topK,
      history: (history || []).slice(-10).map(function (m) {
        return { role: m.role, text: m.text };
      })
    };
  }

  /** Turn raw fetch/API failures into a short message a visitor can act on. */
  function friendlyError(err, serverError) {
    if (serverError) {
      if (/api key is missing/i.test(serverError)) {
        return "The chat service is not fully configured yet (missing API key). Please try again later.";
      }
      if (/collection name is required/i.test(serverError)) {
        return "No knowledge base is connected to this chat yet.";
      }
      return "Sorry, something went wrong while answering. Please try again.";
    }
    if (err && err.name === "AbortError") {
      return "The service took too long to respond - it may be waking up. Please try again in a few seconds.";
    }
    if (err && /failed to fetch|networkerror|load failed/i.test(String(err.message || err))) {
      return "I can't reach the chat service right now. Check your connection and try again.";
    }
    return "Sorry, something went wrong. Please try again.";
  }

  function escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /** Minimal, safe formatting: line breaks, **bold**, `code`, and simple lists. */
  function renderText(text) {
    function inline(s) {
      return s
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");
    }
    var lines = escapeHtml(text).split("\n");
    var segments = [];
    var textBuf = [];
    var listType = null;
    var listItems = [];
    function flushText() {
      if (textBuf.length) { segments.push(textBuf.join("<br>")); textBuf = []; }
    }
    function flushList() {
      if (listType) {
        segments.push("<" + listType + ' class="rf-list">' + listItems.join("") + "</" + listType + ">");
        listType = null; listItems = [];
      }
    }
    lines.forEach(function (raw) {
      var line = raw.trim();
      var bullet = /^[-•]\s+(.*)$/.exec(line);
      var numbered = /^\d+[.)]\s+(.*)$/.exec(line);
      if (bullet || numbered) {
        flushText();
        var type = bullet ? "ul" : "ol";
        if (listType !== type) { flushList(); listType = type; }
        listItems.push("<li>" + inline((bullet || numbered)[1]) + "</li>");
        return;
      }
      flushList();
      textBuf.push(inline(line));
    });
    flushList();
    flushText();
    return segments.join("");
  }

  /* ================================================================
   * 3. API client - the only part that talks to RAGForge
   * ================================================================ */

  function createApiClient(cfg, fetchImpl) {
    var doFetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);

    function fetchWithTimeout(url, options) {
      if (!doFetch) return Promise.reject(new Error("fetch is not available"));
      var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = null;
      if (controller) {
        options = options || {};
        options.signal = controller.signal;
        timer = setTimeout(function () { controller.abort(); }, cfg.requestTimeoutMs);
      }
      return doFetch(url, options).then(
        function (res) { if (timer) clearTimeout(timer); return res; },
        function (err) { if (timer) clearTimeout(timer); throw err; }
      );
    }

    function readJson(res) {
      return res.text().then(function (body) {
        try { return JSON.parse(body); }
        catch (e) { throw new Error("The server returned an unreadable response."); }
      });
    }

    return {
      /** GET /api/config - does the server have its own Groq key? */
      getConfig: function () {
        return fetchWithTimeout(cfg.apiBase + "/api/config", { method: "GET" })
          .then(readJson)
          .then(function (data) { return data || {}; });
      },

      /** POST /api/query - one question against the knowledge base. */
      query: function (question, history) {
        return fetchWithTimeout(cfg.apiBase + "/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildQueryPayload(cfg, question, history))
        })
          .then(readJson)
          .then(function (data) {
            if (!data || data.success !== true) {
              var err = new Error("RAGForge query failed");
              err.serverError = data && data.error ? String(data.error) : "";
              throw err;
            }
            return {
              answer: String(data.answer || ""),
              context: Array.isArray(data.context) ? data.context : []
            };
          });
      }
    };
  }

  /* ================================================================
   * 4. Widget styles (scoped inside the Shadow DOM)
   * ================================================================ */

  function buildCss(cfg) {
    var side = cfg.position === "left" ? "left" : "right";
    var otherSide = side === "right" ? "left" : "right";
    return [
      ":host { all: initial; }",
      "* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }",
      "button:focus-visible, textarea:focus-visible { outline: 2px solid " + cfg.primaryColor + "; outline-offset: 2px; }",
      ".rf-launcher { position: fixed; bottom: 20px; " + side + ": 20px; width: 58px; height: 58px; border-radius: 50%;",
      "  background: " + cfg.primaryColor + "; color: #fff; border: none; cursor: pointer; z-index: 2147483000;",
      "  box-shadow: 0 8px 28px rgba(10,18,32,.32); display: flex; align-items: center; justify-content: center; transition: transform .15s ease, box-shadow .15s ease; }",
      ".rf-launcher:hover { transform: scale(1.06); box-shadow: 0 10px 32px rgba(10,18,32,.38); }",
      ".rf-launcher svg { width: 28px; height: 28px; }",
      ".rf-launcher .rf-close-icon { display: none; }",
      ".rf-launcher.open .rf-open-icon { display: none; }",
      ".rf-launcher.open .rf-close-icon { display: block; }",
      ".rf-panel { position: fixed; bottom: 90px; " + side + ": 20px; width: 392px; max-width: calc(100vw - 24px);",
      "  height: min(640px, calc(100dvh - 110px)); background: #fff; border-radius: 20px; overflow: hidden;",
      "  box-shadow: 0 24px 64px rgba(10,18,32,.32); display: none; flex-direction: column; z-index: 2147483000;",
      "  border: 1px solid rgba(10,18,32,.10); }",
      ".rf-panel.open { display: flex; animation: rf-in .18s ease; }",
      "@keyframes rf-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }",
      ".rf-header { background: " + cfg.primaryColor + "; color: #fff; padding: 13px 14px; display: flex; align-items: center; gap: 11px; }",
      ".rf-avatar { position: relative; width: 40px; height: 40px; border-radius: 50%; background: rgba(255,255,255,.18);",
      "  display: flex; align-items: center; justify-content: center; flex: none; font-size: 15px; font-weight: 700; }",
      ".rf-avatar svg { width: 21px; height: 21px; }",
      ".rf-status-dot { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%;",
      "  background: #2fbf71; border: 2px solid " + cfg.primaryColor + "; }",
      ".rf-header-text { flex: 1; min-width: 0; }",
      ".rf-title { font-size: 15px; font-weight: 700; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      ".rf-subtitle { font-size: 12px; opacity: .88; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      ".rf-header-btn { background: rgba(255,255,255,.14); color: #fff; border: none; border-radius: 50%; width: 32px; height: 32px;",
      "  cursor: pointer; flex: none; display: flex; align-items: center; justify-content: center; }",
      ".rf-header-btn:hover { background: rgba(255,255,255,.28); }",
      ".rf-header-btn svg { width: 16px; height: 16px; }",
      ".rf-messages { flex: 1; overflow-y: auto; padding: 16px 14px; background: #f4f6f9; display: flex; flex-direction: column; gap: 12px; }",
      ".rf-welcome { text-align: center; padding: 14px 8px 4px; }",
      ".rf-welcome-avatar { width: 56px; height: 56px; border-radius: 50%; background: " + cfg.primaryColor + "; color: #fff;",
      "  display: inline-flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; margin-bottom: 10px;",
      "  box-shadow: 0 8px 20px rgba(10,18,32,.20); }",
      ".rf-welcome-avatar svg { width: 28px; height: 28px; }",
      ".rf-welcome-heading { font-size: 19px; font-weight: 700; color: #16202e; line-height: 1.3; margin-bottom: 5px; }",
      ".rf-welcome-text { font-size: 13.5px; color: #5a6a7e; line-height: 1.5; max-width: 300px; margin: 0 auto; }",
      ".rf-chips { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }",
      ".rf-chip { background: #fff; border: 1px solid #dde4ee; color: #22304a; border-radius: 12px; padding: 10px 13px;",
      "  font-size: 13.5px; text-align: left; cursor: pointer; transition: border-color .12s ease, transform .12s ease; line-height: 1.35; }",
      ".rf-chip:hover { border-color: " + cfg.primaryColor + "; transform: translateY(-1px); }",
      ".rf-row { display: flex; }",
      ".rf-row.user { justify-content: flex-end; }",
      ".rf-row.assistant, .rf-row.error { justify-content: flex-start; }",
      ".rf-bubble { max-width: 84%; padding: 11px 14px; border-radius: 16px; font-size: 14px; line-height: 1.55; word-wrap: break-word; overflow-wrap: anywhere; }",
      ".rf-row.user .rf-bubble { background: " + cfg.primaryColor + "; color: #fff; border-bottom-" + side + "-radius: 5px; }",
      ".rf-row.assistant .rf-bubble { background: #fff; color: #1c2430; border: 1px solid #e4e9f0; border-bottom-" + otherSide + "-radius: 5px;",
      "  box-shadow: 0 1px 3px rgba(16,24,40,.06); }",
      ".rf-row.error .rf-bubble { background: #fdf0f0; color: #7a1f1f; border: 1px solid #f2c9c9; }",
      ".rf-bubble code { background: rgba(0,0,0,.07); padding: 1px 4px; border-radius: 4px; font-size: 12.5px; }",
      ".rf-list { margin: 6px 0 2px; padding-left: 19px; }",
      ".rf-list li { margin: 3px 0; }",
      ".rf-actions { margin-top: 9px; display: flex; gap: 6px; }",
      ".rf-action-btn { background: none; border: 1px solid #dde4ee; color: #5a6a7e; border-radius: 999px; padding: 3px 10px;",
      "  font-size: 11px; cursor: pointer; display: inline-flex; gap: 5px; align-items: center; line-height: 1.5; }",
      ".rf-action-btn:hover { color: " + cfg.primaryColor + "; border-color: " + cfg.primaryColor + "; }",
      ".rf-action-btn svg { width: 12px; height: 12px; }",
      ".rf-sources { margin-top: 9px; border-top: 1px dashed #d8dee8; padding-top: 7px; }",
      ".rf-sources-toggle { background: none; border: none; color: " + cfg.primaryColor + "; font-size: 12px; font-weight: 600; cursor: pointer; padding: 0; }",
      ".rf-sources-list { display: none; margin-top: 7px; }",
      ".rf-sources-list.open { display: block; }",
      ".rf-source { background: #eef2f6; border-left: 3px solid " + cfg.primaryColor + "; border-radius: 8px; padding: 8px 10px;",
      "  font-size: 12px; color: #3c4656; margin-bottom: 6px; line-height: 1.45; }",
      ".rf-source-label { display: block; font-size: 10.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;",
      "  color: " + cfg.primaryColor + "; margin-bottom: 3px; }",
      ".rf-retry { margin-top: 8px; background: #7a1f1f; color: #fff; border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }",
      ".rf-typing { display: inline-flex; gap: 5px; align-items: center; padding: 4px 2px; }",
      ".rf-typing span { width: 7px; height: 7px; border-radius: 50%; background: #8fa0b5; animation: rf-blink 1.2s infinite; }",
      ".rf-typing span:nth-child(2) { animation-delay: .18s; }",
      ".rf-typing span:nth-child(3) { animation-delay: .36s; }",
      "@keyframes rf-blink { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }",
      ".rf-inputbar { display: flex; gap: 8px; padding: 10px; background: #fff; border-top: 1px solid #e4e9f0; align-items: flex-end; }",
      ".rf-input { flex: 1; border: 1px solid #dbe2ec; border-radius: 14px; padding: 10px 13px; font-size: 14px; line-height: 1.4;",
      "  resize: none; max-height: 110px; outline: none; color: #1c2430; background: #f7f9fb; }",
      ".rf-input:focus { border-color: " + cfg.primaryColor + "; background: #fff; box-shadow: 0 0 0 3px rgba(10,18,32,.07); }",
      ".rf-send { background: " + cfg.primaryColor + "; color: #fff; border: none; border-radius: 50%; width: 42px; height: 42px;",
      "  cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }",
      ".rf-send:disabled { opacity: .45; cursor: default; }",
      ".rf-send svg { width: 19px; height: 19px; }",
      ".rf-footer { font-size: 10.5px; color: #8a94a6; text-align: center; padding: 0 10px 8px; background: #fff; }",
      "@media (max-width: 480px) {",
      "  .rf-panel { bottom: 0; " + side + ": 0; width: 100vw; max-width: 100vw; height: 100dvh; border-radius: 0; border: none; }",
      "  .rf-launcher { bottom: 16px; " + side + ": 16px; }",
      "  .rf-bubble { max-width: 88%; }",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  * { animation: none !important; transition: none !important; }",
      "}"
    ].join("\n");
  }

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" class="rf-open-icon"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" fill="currentColor"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" class="rf-close-icon"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_SPARK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c.6 3.9 1.7 5.9 3 7.2C16.3 10.5 18.3 11.6 22 12.2c-3.7.6-5.7 1.7-7 3-1.3 1.3-2.4 3.3-3 7.2-.6-3.9-1.7-5.9-3-7.2-1.3-1.3-3.3-2.4-7-3 3.7-.6 5.7-1.7 7-3C10.3 7.9 11.4 5.9 12 2Z"/></svg>';
  var ICON_COPY = '<svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var ICON_RESET = '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 0 2.6-6.3L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ================================================================
   * 5. Widget
   * ================================================================ */

  function createWidget(userCfg) {
    var cfg = mergeConfig(userCfg);
    var api = createApiClient(cfg);
    var storageKey = "ragforge-chat:" + (cfg.collection || "default");
    var messages = [];       // { role: "user" | "assistant", text, context?: [] }
    var sending = false;
    var lastQuestion = null;

    /* ---------- state: history + persistence ---------- */

    function loadHistory() {
      if (!cfg.persistHistory) return;
      try {
        var raw = global.localStorage.getItem(storageKey);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) messages = parsed.slice(-cfg.maxHistory);
        }
      } catch (e) { /* private mode etc. - history just won't persist */ }
    }

    function saveHistory() {
      if (!cfg.persistHistory) return;
      try {
        global.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-cfg.maxHistory)));
      } catch (e) { /* ignore */ }
    }

    function clearHistory() {
      messages = [];
      try { global.localStorage.removeItem(storageKey); } catch (e) { /* ignore */ }
      renderMessages();
      renderWelcome();
    }

    /* ---------- DOM ---------- */

    var host = document.createElement("div");
    host.setAttribute("data-ragforge-chat", "");
    var shadow = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = buildCss(cfg);
    shadow.appendChild(style);

    var launcher = document.createElement("button");
    launcher.className = "rf-launcher";
    launcher.setAttribute("aria-label", "Open chat");
    launcher.innerHTML = ICON_CHAT + ICON_CLOSE;
    shadow.appendChild(launcher);

    var panel = document.createElement("div");
    panel.className = "rf-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", cfg.title);
    panel.innerHTML =
      '<div class="rf-header">' +
        '<div class="rf-avatar"></div>' +
        '<div class="rf-header-text">' +
          '<div class="rf-title"></div>' +
          '<div class="rf-subtitle"></div>' +
        "</div>" +
        '<button class="rf-header-btn" data-action="clear" title="New conversation" aria-label="Start a new conversation">' + ICON_RESET + "</button>" +
      "</div>" +
      '<div class="rf-messages"></div>' +
      '<div class="rf-inputbar">' +
        '<textarea class="rf-input" rows="1"></textarea>' +
        '<button class="rf-send" aria-label="Send message">' + ICON_SEND + "</button>" +
      "</div>" +
      (cfg.poweredBy ? '<div class="rf-footer">Powered by RAGForge</div>' : "");
    shadow.appendChild(panel);
    document.body.appendChild(host);

    var titleEl = panel.querySelector(".rf-title");
    var subtitleEl = panel.querySelector(".rf-subtitle");
    var messagesEl = panel.querySelector(".rf-messages");
    var inputEl = panel.querySelector(".rf-input");
    var sendBtn = panel.querySelector(".rf-send");
    titleEl.textContent = cfg.title;
    subtitleEl.textContent = cfg.subtitle;
    inputEl.placeholder = cfg.placeholder;
    var avatarEl = panel.querySelector(".rf-avatar");
    avatarEl.innerHTML = (cfg.avatarText ? escapeHtml(cfg.avatarText) : ICON_SPARK) + '<span class="rf-status-dot"></span>';

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    /* ---------- welcome screen (heading + suggestion chips) ---------- */

    var welcomeEl = null;

    function removeWelcome() {
      if (welcomeEl) { welcomeEl.remove(); welcomeEl = null; }
    }

    function renderWelcome() {
      removeWelcome();
      var hasChips = cfg.suggestions && cfg.suggestions.length;
      if (!cfg.welcomeMessage && !cfg.welcomeHeading && !hasChips) return;
      welcomeEl = document.createElement("div");
      welcomeEl.className = "rf-welcome";
      var html = '<div class="rf-welcome-avatar">' + (cfg.avatarText ? escapeHtml(cfg.avatarText) : ICON_SPARK) + "</div>";
      html += '<div class="rf-welcome-heading">' + escapeHtml(cfg.welcomeHeading || cfg.title) + "</div>";
      if (cfg.welcomeMessage) html += '<div class="rf-welcome-text">' + escapeHtml(cfg.welcomeMessage) + "</div>";
      welcomeEl.innerHTML = html;
      if (hasChips) {
        var chips = document.createElement("div");
        chips.className = "rf-chips";
        cfg.suggestions.forEach(function (q) {
          var chip = document.createElement("button");
          chip.className = "rf-chip";
          chip.textContent = q;
          chip.addEventListener("click", function () { sendQuestion(q); });
          chips.appendChild(chip);
        });
        welcomeEl.appendChild(chips);
      }
      messagesEl.appendChild(welcomeEl);
    }

    function renderMessage(msg) {
      var row = document.createElement("div");
      row.className = "rf-row " + msg.role;
      var bubble = document.createElement("div");
      bubble.className = "rf-bubble";
      bubble.innerHTML = renderText(msg.text);

      if (msg.role === "assistant" && cfg.showSources && msg.context && msg.context.length) {
        var wrap = document.createElement("div");
        wrap.className = "rf-sources";
        var toggle = document.createElement("button");
        toggle.className = "rf-sources-toggle";
        toggle.textContent = "Sources (" + msg.context.length + ")";
        var list = document.createElement("div");
        list.className = "rf-sources-list";
        msg.context.forEach(function (chunk, idx) {
          var item = document.createElement("div");
          item.className = "rf-source";
          var label = document.createElement("span");
          label.className = "rf-source-label";
          label.textContent = "Source " + (idx + 1);
          item.appendChild(label);
          item.appendChild(document.createTextNode(String(chunk).slice(0, 400)));
          list.appendChild(item);
        });
        toggle.addEventListener("click", function () { list.classList.toggle("open"); });
        wrap.appendChild(toggle);
        wrap.appendChild(list);
        bubble.appendChild(wrap);
      }

      if (msg.role === "assistant" && msg.text) {
        var actions = document.createElement("div");
        actions.className = "rf-actions";
        var copyBtn = document.createElement("button");
        copyBtn.className = "rf-action-btn";
        copyBtn.innerHTML = ICON_COPY + "<span>Copy</span>";
        copyBtn.setAttribute("aria-label", "Copy this answer");
        copyBtn.addEventListener("click", function () { copyText(msg.text, copyBtn); });
        actions.appendChild(copyBtn);
        bubble.appendChild(actions);
      }
      row.appendChild(bubble);
      messagesEl.appendChild(row);
      return row;
    }

    function copyText(text, btn) {
      var label = btn.querySelector("span");
      function setLabel(value) {
        if (!label) return;
        label.textContent = value;
        setTimeout(function () { label.textContent = "Copy"; }, 1400);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { setLabel("Copied"); },
          function () { setLabel("Couldn't copy"); }
        );
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var okCopy = false;
        try { okCopy = document.execCommand("copy"); } catch (e) { /* ignore */ }
        ta.remove();
        setLabel(okCopy ? "Copied" : "Couldn't copy");
      }
    }

    function renderMessages() {
      messagesEl.innerHTML = "";
      welcomeEl = null;
      messages.forEach(renderMessage);
      scrollToBottom();
    }

    function addMessage(role, text, context, persist) {
      removeWelcome();
      var msg = { role: role, text: text, context: context || [] };
      messages.push(msg);
      if (messages.length > cfg.maxHistory) messages = messages.slice(-cfg.maxHistory);
      renderMessage(msg);
      scrollToBottom();
      if (persist !== false) saveHistory();
      return msg;
    }

    function addErrorMessage(text, question) {
      var row = document.createElement("div");
      row.className = "rf-row error";
      var bubble = document.createElement("div");
      bubble.className = "rf-bubble";
      bubble.textContent = text;
      if (question) {
        var retry = document.createElement("button");
        retry.className = "rf-retry";
        retry.textContent = "Retry";
        retry.addEventListener("click", function () {
          row.remove();
          sendQuestion(question);
        });
        bubble.appendChild(document.createElement("br"));
        bubble.appendChild(retry);
      }
      row.appendChild(bubble);
      messagesEl.appendChild(row);
      scrollToBottom();
    }

    function showTyping() {
      var row = document.createElement("div");
      row.className = "rf-row assistant";
      row.setAttribute("data-typing", "1");
      row.innerHTML = '<div class="rf-bubble"><div class="rf-typing"><span></span><span></span><span></span></div></div>';
      messagesEl.appendChild(row);
      scrollToBottom();
      return row;
    }

    /* ---------- sending ---------- */

    function sendQuestion(rawText) {
      var text = String(rawText || "").trim();
      if (!text || sending) return;

      if (!cfg.collection) {
        addMessage("user", text);
        addErrorMessage(
          "This chat is not connected to a knowledge base yet. The site owner needs to set the RAGForge collection in the widget configuration.",
          null
        );
        return;
      }

      var historyBefore = messages.slice();
      addMessage("user", text);
      lastQuestion = text;
      sending = true;
      sendBtn.disabled = true;
      var typing = showTyping();

      api.query(text, historyBefore).then(
        function (result) {
          typing.remove();
          addMessage("assistant", result.answer || "I couldn't find an answer in the documents.", result.context);
        },
        function (err) {
          typing.remove();
          addErrorMessage(friendlyError(err, err && err.serverError), text);
        }
      ).then(function () {
        sending = false;
        sendBtn.disabled = false;
        inputEl.focus();
      });
    }

    function submitInput() {
      var value = inputEl.value;
      if (!value.trim()) return;
      inputEl.value = "";
      inputEl.style.height = "auto";
      sendQuestion(value);
    }

    /* ---------- events ---------- */

    function setOpen(open) {
      panel.classList.toggle("open", open);
      launcher.classList.toggle("open", open);
      launcher.setAttribute("aria-label", open ? "Close chat" : "Open chat");
      if (open) setTimeout(function () { inputEl.focus(); }, 50);
    }

    launcher.addEventListener("click", function () {
      setOpen(!panel.classList.contains("open"));
    });

    panel.querySelector('[data-action="clear"]').addEventListener("click", clearHistory);
    sendBtn.addEventListener("click", submitInput);
    inputEl.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitInput();
      }
    });
    inputEl.addEventListener("input", function () {
      inputEl.style.height = "auto";
      inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + "px";
    });

    /* ---------- boot ---------- */

    loadHistory();
    if (messages.length) {
      renderMessages();
    } else {
      renderWelcome();
    }

    return {
      open: function () { setOpen(true); },
      close: function () { setOpen(false); },
      send: function (text) { setOpen(true); sendQuestion(text); },
      clear: clearHistory,
      destroy: function () { host.remove(); },
      config: cfg
    };
  }

  /* ================================================================
   * 6. Boot + public API
   * ================================================================ */

  var instance = null;

  function init(userCfg) {
    if (instance) return instance;
    var cfg = userCfg || global.RAGForgeChatConfig || {};
    // Script-tag data attributes can override: data-collection, data-api-base, data-title
    try {
      var script = document.currentScript;
      if (script && script.dataset) {
        if (script.dataset.collection) cfg.collection = script.dataset.collection;
        if (script.dataset.apiBase) cfg.apiBase = script.dataset.apiBase;
        if (script.dataset.title) cfg.title = script.dataset.title;
      }
    } catch (e) { /* ignore */ }
    instance = createWidget(cfg);
    return instance;
  }

  global.RAGForgeChat = {
    init: init,
    open: function () { (instance || init()).open(); },
    close: function () { if (instance) instance.close(); },
    _internals: {
      DEFAULTS: DEFAULTS,
      mergeConfig: mergeConfig,
      expandFollowUp: expandFollowUp,
      buildQueryPayload: buildQueryPayload,
      friendlyError: friendlyError,
      createApiClient: createApiClient
    }
  };

  // Auto-init when a config object is present (the normal embed case).
  if (typeof document !== "undefined" && global.RAGForgeChatConfig) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { init(); });
    } else {
      init();
    }
  }

  // Node export for the smoke tests (ignored in the browser).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.RAGForgeChat._internals;
  }
})(typeof window !== "undefined" ? window : globalThis);
