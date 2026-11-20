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
    welcomeMessage: "Hi! Ask me anything about our services, prices or timings.",
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
      query: cfg.contextFollowUps ? expandFollowUp(question, history) : String(question || ""),
      collection_name: cfg.collection,
      top_k: cfg.topK,
      // Sent for future server-side context support; the current backend
      // safely ignores unknown fields.
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

  /** Minimal, safe formatting: line breaks, **bold**, and `code`. */
  function renderText(text) {
    var safe = escapeHtml(text);
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
    return safe.replace(/\n/g, "<br>");
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
      ".rf-launcher { position: fixed; bottom: 20px; " + side + ": 20px; width: 58px; height: 58px; border-radius: 50%;",
      "  background: " + cfg.primaryColor + "; color: #fff; border: none; cursor: pointer; z-index: 2147483000;",
      "  box-shadow: 0 6px 24px rgba(0,0,0,.28); display: flex; align-items: center; justify-content: center; transition: transform .15s ease; }",
      ".rf-launcher:hover { transform: scale(1.06); }",
      ".rf-launcher svg { width: 28px; height: 28px; }",
      ".rf-launcher .rf-close-icon { display: none; }",
      ".rf-launcher.open .rf-open-icon { display: none; }",
      ".rf-launcher.open .rf-close-icon { display: block; }",
      ".rf-panel { position: fixed; bottom: 90px; " + side + ": 20px; width: 384px; max-width: calc(100vw - 24px);",
      "  height: min(600px, calc(100dvh - 110px)); background: #fff; border-radius: 16px; overflow: hidden;",
      "  box-shadow: 0 16px 48px rgba(0,0,0,.30); display: none; flex-direction: column; z-index: 2147483000;",
      "  border: 1px solid rgba(0,0,0,.08); }",
      ".rf-panel.open { display: flex; }",
      ".rf-header { background: " + cfg.primaryColor + "; color: #fff; padding: 14px 16px; display: flex; align-items: center; gap: 10px; }",
      ".rf-header-text { flex: 1; min-width: 0; }",
      ".rf-title { font-size: 15px; font-weight: 700; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      ".rf-subtitle { font-size: 12px; opacity: .85; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      ".rf-header-btn { background: rgba(255,255,255,.16); color: #fff; border: none; border-radius: 8px; padding: 6px 9px;",
      "  font-size: 11px; cursor: pointer; flex: none; }",
      ".rf-header-btn:hover { background: rgba(255,255,255,.28); }",
      ".rf-messages { flex: 1; overflow-y: auto; padding: 14px; background: #f6f7f9; display: flex; flex-direction: column; gap: 10px; }",
      ".rf-row { display: flex; }",
      ".rf-row.user { justify-content: flex-end; }",
      ".rf-row.assistant, .rf-row.error { justify-content: flex-start; }",
      ".rf-bubble { max-width: 82%; padding: 10px 13px; border-radius: 14px; font-size: 14px; line-height: 1.5; word-wrap: break-word; overflow-wrap: anywhere; }",
      ".rf-row.user .rf-bubble { background: " + cfg.primaryColor + "; color: #fff; border-bottom-" + side + "-radius: 4px; }",
      ".rf-row.assistant .rf-bubble { background: #fff; color: #1c2430; border: 1px solid #e3e7ee; border-bottom-" + otherSide + "-radius: 4px; }",
      ".rf-row.error .rf-bubble { background: #fdf0f0; color: #7a1f1f; border: 1px solid #f2c9c9; }",
      ".rf-bubble code { background: rgba(0,0,0,.07); padding: 1px 4px; border-radius: 4px; font-size: 12.5px; }",
      ".rf-sources { margin-top: 8px; border-top: 1px dashed #d8dee8; padding-top: 6px; }",
      ".rf-sources-toggle { background: none; border: none; color: " + cfg.primaryColor + "; font-size: 12px; font-weight: 600; cursor: pointer; padding: 0; }",
      ".rf-sources-list { display: none; margin-top: 6px; }",
      ".rf-sources-list.open { display: block; }",
      ".rf-source { background: #f0f3f7; border-radius: 8px; padding: 7px 9px; font-size: 12px; color: #3c4656; margin-bottom: 6px; line-height: 1.45; }",
      ".rf-retry { margin-top: 8px; background: #7a1f1f; color: #fff; border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }",
      ".rf-typing { display: inline-flex; gap: 5px; align-items: center; padding: 4px 2px; }",
      ".rf-typing span { width: 7px; height: 7px; border-radius: 50%; background: #9aa7b8; animation: rf-blink 1.2s infinite; }",
      ".rf-typing span:nth-child(2) { animation-delay: .18s; }",
      ".rf-typing span:nth-child(3) { animation-delay: .36s; }",
      "@keyframes rf-blink { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }",
      ".rf-inputbar { display: flex; gap: 8px; padding: 10px; background: #fff; border-top: 1px solid #e3e7ee; align-items: flex-end; }",
      ".rf-input { flex: 1; border: 1px solid #cfd6e1; border-radius: 10px; padding: 10px 12px; font-size: 14px; line-height: 1.4;",
      "  resize: none; max-height: 110px; outline: none; color: #1c2430; background: #fff; }",
      ".rf-input:focus { border-color: " + cfg.primaryColor + "; }",
      ".rf-send { background: " + cfg.primaryColor + "; color: #fff; border: none; border-radius: 10px; width: 42px; height: 42px;",
      "  cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none; }",
      ".rf-send:disabled { opacity: .45; cursor: default; }",
      ".rf-send svg { width: 19px; height: 19px; }",
      ".rf-footer { font-size: 10.5px; color: #8a94a6; text-align: center; padding: 0 10px 8px; background: #fff; }",
      "@media (max-width: 480px) {",
      "  .rf-panel { bottom: 0; " + side + ": 0; width: 100vw; max-width: 100vw; height: 100dvh; border-radius: 0; }",
      "  .rf-launcher { bottom: 16px; " + side + ": 16px; }",
      "}"
    ].join("\n");
  }

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" class="rf-open-icon"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" fill="currentColor"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" class="rf-close-icon"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
      if (cfg.welcomeMessage) addMessage("assistant", cfg.welcomeMessage, [], false);
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
        '<div class="rf-header-text">' +
          '<div class="rf-title"></div>' +
          '<div class="rf-subtitle"></div>' +
        "</div>" +
        '<button class="rf-header-btn" data-action="clear" title="Clear conversation">Clear</button>' +
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

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
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
        msg.context.forEach(function (chunk) {
          var item = document.createElement("div");
          item.className = "rf-source";
          item.textContent = String(chunk).slice(0, 400);
          list.appendChild(item);
        });
        toggle.addEventListener("click", function () { list.classList.toggle("open"); });
        wrap.appendChild(toggle);
        wrap.appendChild(list);
        bubble.appendChild(wrap);
      }
      row.appendChild(bubble);
      messagesEl.appendChild(row);
      return row;
    }

    function renderMessages() {
      messagesEl.innerHTML = "";
      messages.forEach(renderMessage);
      scrollToBottom();
    }

    function addMessage(role, text, context, persist) {
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
    } else if (cfg.welcomeMessage) {
      addMessage("assistant", cfg.welcomeMessage, [], false);
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
