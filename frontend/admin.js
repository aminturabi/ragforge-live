/*!
 * RAGForge Chatbot Admin Dashboard
 * ================================
 * Owner-side console for the RAGForge website chatbot.
 *
 * What is REAL here (connected to the live RAGForge backend):
 *  - File uploads (PDF/DOCX/TXT/CSV/MD/JSON) via POST /api/upload
 *  - Collection list / delete via GET /api/collections + POST /api/clear
 *  - "Publish knowledge base": FAQs + business info + services/pricing +
 *    website content + instructions + support info are composed into ONE
 *    document and uploaded - the chatbot then answers from it.
 *  - Test chat via POST /api/query against the active collection.
 *
 * What is LOCAL to this dashboard (stored in the browser):
 *  - The FAQ/business/appearance/support data itself (until published),
 *    test conversations, unanswered-question tracking and analytics.
 *    Visitor conversations on real websites are NOT visible here, because
 *    the current backend keeps no query log - see the Analytics page note.
 */
(function (global) {
  "use strict";

  /* ================================================================
   * 1. State + persistence
   * ================================================================ */

  var STORAGE_KEY = "ragforge-admin-v1";

  function defaultState() {
    return {
      settings: { apiBase: "https://ragforge-live.onrender.com" },
      business: {
        name: "", about: "", address: "", phone: "", email: "",
        hours: "", website: ""
      },
      services: [],        // { id, name, description }
      prices: [],          // { id, item, price, note }
      faqs: [],            // { id, question, answer }
      urls: [],            // { id, url, content, status }
      instructions: {
        tone: "friendly",
        custom: "",
        fallbackMessage: "I couldn't find that in our information. Please contact us and we will be happy to help.",
        disclaimer: ""
      },
      support: {
        enabled: true,
        whatsapp: "",
        email: "",
        hours: "",
        message: "For personal help, message us on WhatsApp or email us and our team will reply during working hours."
      },
      appearance: {
        title: "Chat with us",
        subtitle: "Answers from our documents",
        welcomeMessage: "Hi! Ask me anything about our services, prices or timings.",
        placeholder: "Type your question...",
        primaryColor: "#0f766e",
        position: "right"
      },
      collections: [],     // { id, name, collection, chunks, date, kind }
      activeCollection: "",
      conversations: [],   // { id, date, question, answer, contextCount, unanswered, rating }
      unanswered: []       // { id, date, question, resolved }
    };
  }

  function loadState() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      var base = defaultState();
      for (var k in base) if (parsed[k] !== undefined) base[k] = parsed[k];
      return base;
    } catch (e) {
      return defaultState();
    }
  }

  var state = typeof document !== "undefined" ? loadState() : defaultState();

  function save() {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function uid() {
    return "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function apiBase() {
    return String(state.settings.apiBase || "").replace(/\/+$/, "");
  }

  /* ================================================================
   * 2. Knowledge-base composer - the heart of "training"
   * ================================================================ */

  /**
   * Compose ONE text document from everything the owner entered.
   * The backend indexes one collection per document, so this single
   * document IS the chatbot's knowledge base after publishing.
   */
  function composeKnowledgeBase(s) {
    var out = [];
    var b = s.business || {};
    var bizName = b.name || "Our Business";
    out.push(bizName + " - Information and Knowledge Base");

    if (b.about) out.push("\nABOUT US\n" + b.about);
    var facts = [];
    if (b.address) facts.push("Address: " + b.address);
    if (b.phone) facts.push("Phone: " + b.phone);
    if (b.email) facts.push("Email: " + b.email);
    if (b.hours) facts.push("Opening hours: " + b.hours);
    if (b.website) facts.push("Website: " + b.website);
    if (facts.length) out.push("\nBUSINESS DETAILS\n" + facts.join("\n"));

    if (s.services && s.services.length) {
      out.push("\nSERVICES");
      s.services.forEach(function (sv) {
        out.push("- " + sv.name + (sv.description ? ": " + sv.description : ""));
      });
    }

    if (s.prices && s.prices.length) {
      out.push("\nPRICES");
      s.prices.forEach(function (p) {
        out.push("- " + p.item + ": " + p.price + (p.note ? " (" + p.note + ")" : ""));
      });
    }

    if (s.faqs && s.faqs.length) {
      out.push("\nFREQUENTLY ASKED QUESTIONS");
      s.faqs.forEach(function (f) {
        out.push("Q: " + f.question + "\nA: " + f.answer);
      });
    }

    var urlContent = (s.urls || []).filter(function (u) { return u.content && u.content.trim(); });
    if (urlContent.length) {
      out.push("\nFROM OUR WEBSITE");
      urlContent.forEach(function (u) {
        out.push("Source: " + u.url + "\n" + u.content.trim());
      });
    }

    var ins = s.instructions || {};
    var behaviour = [];
    if (ins.tone) behaviour.push("Tone of voice: " + ins.tone + ".");
    if (ins.custom) behaviour.push(ins.custom);
    if (ins.fallbackMessage) behaviour.push("If the answer is not in this information, say: \"" + ins.fallbackMessage + "\"");
    if (ins.disclaimer) behaviour.push("Important note: " + ins.disclaimer);
    if (behaviour.length) out.push("\nHOW TO ANSWER\n" + behaviour.join("\n"));

    var sup = s.support || {};
    if (sup.enabled && (sup.whatsapp || sup.email)) {
      var line = sup.message || "For personal help, contact us directly.";
      if (sup.whatsapp) line += " WhatsApp: " + sup.whatsapp + ".";
      if (sup.email) line += " Email: " + sup.email + ".";
      if (sup.hours) line += " Support hours: " + sup.hours + ".";
      out.push("\nHUMAN SUPPORT\n" + line);
    }

    return out.join("\n") + "\n";
  }

  /** The embed snippet for the owner's website, from current settings. */
  function buildEmbedSnippet(s) {
    var a = s.appearance || {};
    var cfg = {
      apiBase: String(s.settings.apiBase || "").replace(/\/+$/, ""),
      collection: s.activeCollection || "PASTE_COLLECTION_NAME",
      title: a.title || "Chat with us",
      subtitle: a.subtitle || "",
      welcomeMessage: a.welcomeMessage || "",
      placeholder: a.placeholder || "Type your question...",
      primaryColor: a.primaryColor || "#0f766e",
      position: a.position || "right"
    };
    return "<script>\n  window.RAGForgeChatConfig = " + JSON.stringify(cfg, null, 2).replace(/\n/g, "\n  ") +
      ";\n</script>\n<script src=\"" + (cfg.apiBase || "") + "/ragforge-chat.js\" defer></script>";
  }

  /** Analytics computed from the local test-conversation log. */
  function computeAnalytics(s) {
    var convs = s.conversations || [];
    var questions = convs.length;
    var unanswered = convs.filter(function (c) { return c.unanswered; }).length;
    var rated = convs.filter(function (c) { return c.rating; });
    var positive = rated.filter(function (c) { return c.rating === "up"; }).length;
    var freq = {};
    convs.forEach(function (c) {
      var key = String(c.question || "").trim().toLowerCase();
      if (key) freq[key] = (freq[key] || 0) + 1;
    });
    var popular = Object.keys(freq).map(function (q) {
      return { question: q, count: freq[q] };
    }).sort(function (x, y) { return y.count - x.count; }).slice(0, 8);
    return {
      totalChats: questions,
      unanswered: unanswered,
      answeredRate: questions ? Math.round(((questions - unanswered) / questions) * 100) : 0,
      satisfaction: rated.length ? Math.round((positive / rated.length) * 100) : null,
      ratingsCount: rated.length,
      popular: popular
    };
  }

  var FALLBACK_MARKERS = [
    "couldn't retrieve any relevant information",
    "could not retrieve any relevant information",
    "i don't have information",
    "i do not have information",
    "not mentioned in the document",
    "no relevant information"
  ];

  function looksUnanswered(answer, contextCount) {
    if (!answer) return true;
    if (!contextCount) return true;
    var lower = String(answer).toLowerCase();
    return FALLBACK_MARKERS.some(function (m) { return lower.indexOf(m) !== -1; });
  }

  /* ================================================================
   * 3. API client - the existing RAGForge backend, unchanged
   * ================================================================ */

  function apiFetch(path, options) {
    return fetch(apiBase() + path, options).then(function (res) {
      return res.text().then(function (body) {
        try { return JSON.parse(body); }
        catch (e) { throw new Error("The backend returned an unreadable response (HTTP " + res.status + ")."); }
      });
    });
  }

  var api = {
    config: function () { return apiFetch("/api/config", { method: "GET" }); },
    uploadBlob: function (blob, filename) {
      var form = new FormData();
      form.append("file", blob, filename);
      return apiFetch("/api/upload", { method: "POST", body: form });
    },
    uploadFile: function (file) { return api.uploadBlob(file, file.name); },
    query: function (question, collection) {
      return apiFetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, collection_name: collection, top_k: 4 })
      });
    },
    clear: function (collection) {
      return apiFetch("/api/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection_name: collection })
      });
    }
  };

  /* ================================================================
   * 4. UI helpers
   * ================================================================ */

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtDate(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return ""; }
  }

  var root = null;
  var currentPage = "overview";
  var backendOk = null;

  function notice(kind, text) {
    return '<div class="notice ' + kind + '">' + esc(text) + "</div>";
  }

  function setBackendStatus() {
    var dot = document.getElementById("backendStatus");
    if (!dot) return;
    if (backendOk === true) { dot.textContent = "● Backend connected"; dot.className = "status-dot ok"; }
    else if (backendOk === false) { dot.textContent = "● Backend unreachable"; dot.className = "status-dot bad"; }
    else { dot.textContent = "● Checking backend..."; dot.className = "status-dot"; }
  }

  function checkBackend() {
    api.config().then(function (data) {
      backendOk = !!(data && data.success);
      if (backendOk && !data.default_key) {
        backendOk = true; // reachable, but answers need a key
      }
      setBackendStatus();
    }).catch(function () { backendOk = false; setBackendStatus(); });
  }

  /* ================================================================
   * 5. Pages
   * ================================================================ */

  function pageOverview() {
    var a = computeAnalytics(state);
    var html = "";
    html += '<div class="grid">' +
      stat(state.collections.length, "Knowledge collections") +
      stat(state.faqs.length, "FAQs") +
      stat(a.totalChats, "Test chats") +
      stat(a.unanswered, "Unanswered (test)") +
      stat(a.satisfaction === null ? "-" : a.satisfaction + "%", "Satisfaction (rated answers)") +
      "</div>";
    if (!state.activeCollection) {
      html += notice("warn", "No active knowledge base yet. Add your business info and FAQs, then press Publish on the Knowledge Base page - or upload a document below. The chatbot answers from the active collection.");
    } else {
      html += notice("ok", "Active knowledge base: " + state.activeCollection + " - the embed snippet and test chat use it.");
    }
    html += '<div class="card"><h3>Quick actions</h3><div class="btn-row">' +
      '<button class="btn" data-nav="kb">Upload documents</button>' +
      '<button class="btn ghost" data-nav="faqs">Add an FAQ</button>' +
      '<button class="btn ghost" data-nav="publish">Publish knowledge base</button>' +
      '<button class="btn ghost" data-nav="chat">Test the chatbot</button>' +
      '<button class="btn ghost" data-nav="embed">Get embed code</button>' +
      "</div></div>";
    html += '<div class="card"><h3>How training works</h3><p class="hint">' +
      "Everything you enter here - business info, services, prices, FAQs, website text and instructions - is composed into one document and uploaded to your RAGForge backend when you publish. " +
      "The chatbot then answers from that document. Uploaded files (PDF, DOCX, TXT, CSV) become their own collections and can be set active instead. " +
      "Edit anything and publish again to update the chatbot.</p></div>";
    return html;
  }

  function stat(num, lbl) {
    return '<div class="stat"><div class="num">' + esc(num) + '</div><div class="lbl">' + esc(lbl) + "</div></div>";
  }

  function pageKb() {
    var rows = state.collections.map(function (c) {
      var active = c.collection === state.activeCollection;
      return "<tr><td>" + esc(c.name) + "<br><span class='hint'>" + esc(c.collection) + "</span></td>" +
        "<td>" + esc(c.kind) + "</td><td>" + esc(c.chunks) + "</td><td>" + esc(fmtDate(c.date)) + "</td>" +
        "<td>" + (active ? '<span class="pill">ACTIVE</span>' : '<span class="pill grey">stored</span>') + "</td>" +
        '<td class="actions">' +
        (active ? "" : '<button class="btn small ghost" data-act="activate" data-id="' + c.id + '">Set active</button> ') +
        '<button class="btn small danger" data-act="delcol" data-id="' + c.id + '">Delete</button></td></tr>';
    }).join("");
    return '<div class="card"><h3>Upload knowledge files</h3>' +
      '<p class="hint">PDF, DOCX, TXT, CSV, Markdown or JSON. Each file is indexed by the backend as its own collection. Large files can take a while on a free-tier server.</p>' +
      '<input type="file" id="kbFiles" multiple accept=".pdf,.docx,.txt,.csv,.md,.json">' +
      '<div class="btn-row"><button class="btn" id="kbUploadBtn">Upload &amp; index</button><span class="hint" id="kbUploadStatus"></span></div></div>' +
      '<div class="card"><h3>Collections</h3>' +
      '<input type="text" class="search" id="kbSearch" placeholder="Search collections...">' +
      '<table><thead><tr><th>Document</th><th>Type</th><th>Chunks</th><th>Added</th><th>Status</th><th></th></tr></thead><tbody id="kbRows">' +
      (rows || '<tr><td colspan="6" class="empty">No documents uploaded yet.</td></tr>') +
      "</tbody></table></div>";
  }

  function pagePublish() {
    var doc = composeKnowledgeBase(state);
    var words = doc.split(/\s+/).filter(Boolean).length;
    return '<div class="card"><h3>Publish knowledge base</h3>' +
      '<p class="hint">This composes everything from Business Info, Services &amp; Pricing, FAQs, Website Content and Instructions into one document (' +
      words + ' words) and uploads it to the backend. The new collection becomes the active one, so the chatbot starts answering from it immediately. The previous published collection stays stored until you delete it.</p>' +
      '<div class="btn-row"><button class="btn" id="publishBtn">Build &amp; publish now</button><span class="hint" id="publishStatus"></span></div></div>' +
      '<div class="card"><h3>Document preview</h3><pre class="snippet" style="max-height:420px;overflow-y:auto">' + esc(doc) + "</pre></div>";
  }

  function pageFaqs() {
    var rows = state.faqs.map(function (f) {
      return "<tr><td>" + esc(f.question) + "</td><td>" + esc(f.answer) + '</td><td class="actions">' +
        '<button class="btn small ghost" data-act="editfaq" data-id="' + f.id + '">Edit</button> ' +
        '<button class="btn small danger" data-act="delfaq" data-id="' + f.id + '">Delete</button></td></tr>';
    }).join("");
    return '<div class="card"><h3 id="faqFormTitle">Add an FAQ</h3>' +
      '<input type="hidden" id="faqId">' +
      '<label>Question</label><input type="text" id="faqQ" placeholder="e.g. What are your opening hours?">' +
      '<label>Answer</label><textarea id="faqA" placeholder="The exact answer the chatbot should give"></textarea>' +
      '<div class="btn-row"><button class="btn" id="faqSave">Save FAQ</button>' +
      '<button class="btn ghost" id="faqCancel" style="display:none">Cancel edit</button></div>' +
      '<p class="hint">FAQs go live when you publish the knowledge base.</p></div>' +
      '<div class="card"><h3>Saved FAQs</h3><input type="text" class="search" id="faqSearch" placeholder="Search FAQs...">' +
      '<table><thead><tr><th>Question</th><th>Answer</th><th></th></tr></thead><tbody id="faqRows">' +
      (rows || '<tr><td colspan="3" class="empty">No FAQs yet.</td></tr>') + "</tbody></table></div>";
  }

  function pageUrls() {
    var rows = state.urls.map(function (u) {
      return "<tr><td>" + esc(u.url) + "</td><td>" + (u.content ? '<span class="pill">' + u.content.split(/\s+/).filter(Boolean).length + " words</span>" : '<span class="pill grey">no content</span>') +
        '</td><td class="actions"><button class="btn small ghost" data-act="editurl" data-id="' + u.id + '">Edit</button> ' +
        '<button class="btn small danger" data-act="delurl" data-id="' + u.id + '">Delete</button></td></tr>';
    }).join("");
    return '<div class="card"><h3 id="urlFormTitle">Add a website page</h3>' +
      '<input type="hidden" id="urlId">' +
      '<label>Page URL</label><input type="url" id="urlInput" placeholder="https://your-site.com/services">' +
      '<div class="btn-row"><button class="btn ghost" id="urlFetch">Try to fetch page text</button><span class="hint" id="urlFetchStatus">Many sites block browser fetching - if it fails, paste the page text below instead.</span></div>' +
      '<label>Page content (text the chatbot learns from)</label><textarea id="urlContent" style="min-height:130px" placeholder="Paste the page\'s text here, or use the fetch button"></textarea>' +
      '<div class="btn-row"><button class="btn" id="urlSave">Save page</button>' +
      '<button class="btn ghost" id="urlCancel" style="display:none">Cancel edit</button></div>' +
      '<p class="hint">Saved page content is included when you publish the knowledge base. For bulk fetching, the package also includes admin/fetch_urls.py, which downloads pages on your computer without browser restrictions.</p></div>' +
      '<div class="card"><h3>Saved pages</h3><table><thead><tr><th>URL</th><th>Content</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3" class="empty">No pages added yet.</td></tr>') + "</tbody></table></div>";
  }

  function pageBusiness() {
    var b = state.business;
    var svcRows = state.services.map(function (sv) {
      return "<tr><td>" + esc(sv.name) + "</td><td>" + esc(sv.description) + '</td><td class="actions">' +
        '<button class="btn small ghost" data-act="editsvc" data-id="' + sv.id + '">Edit</button> ' +
        '<button class="btn small danger" data-act="delsvc" data-id="' + sv.id + '">Delete</button></td></tr>';
    }).join("");
    var priceRows = state.prices.map(function (p) {
      return "<tr><td>" + esc(p.item) + "</td><td>" + esc(p.price) + "</td><td>" + esc(p.note) + '</td><td class="actions">' +
        '<button class="btn small ghost" data-act="editprice" data-id="' + p.id + '">Edit</button> ' +
        '<button class="btn small danger" data-act="delprice" data-id="' + p.id + '">Delete</button></td></tr>';
    }).join("");
    return '<div class="card"><h3>Business information</h3>' +
      '<div class="row2"><div><label>Business name</label><input type="text" id="bizName" value="' + esc(b.name) + '"></div>' +
      '<div><label>Website</label><input type="url" id="bizWebsite" value="' + esc(b.website) + '"></div></div>' +
      '<label>About the business</label><textarea id="bizAbout">' + esc(b.about) + "</textarea>" +
      '<div class="row2"><div><label>Address</label><input type="text" id="bizAddress" value="' + esc(b.address) + '"></div>' +
      '<div><label>Opening hours</label><input type="text" id="bizHours" value="' + esc(b.hours) + '"></div></div>' +
      '<div class="row2"><div><label>Phone</label><input type="tel" id="bizPhone" value="' + esc(b.phone) + '"></div>' +
      '<div><label>Email</label><input type="email" id="bizEmail" value="' + esc(b.email) + '"></div></div>' +
      '<div class="btn-row"><button class="btn" id="bizSave">Save business info</button></div></div>' +

      '<div class="card"><h3 id="svcFormTitle">Services</h3><input type="hidden" id="svcId">' +
      '<div class="row2"><div><label>Service name</label><input type="text" id="svcName"></div>' +
      '<div><label>Description</label><input type="text" id="svcDesc"></div></div>' +
      '<div class="btn-row"><button class="btn" id="svcSave">Save service</button>' +
      '<button class="btn ghost" id="svcCancel" style="display:none">Cancel edit</button></div>' +
      '<table style="margin-top:10px"><thead><tr><th>Service</th><th>Description</th><th></th></tr></thead><tbody>' +
      (svcRows || '<tr><td colspan="3" class="empty">No services yet.</td></tr>') + "</tbody></table></div>" +

      '<div class="card"><h3 id="priceFormTitle">Products &amp; pricing</h3><input type="hidden" id="priceId">' +
      '<div class="row3"><div><label>Item</label><input type="text" id="priceItem"></div>' +
      '<div><label>Price</label><input type="text" id="priceValue" placeholder="e.g. Rs 1,500"></div>' +
      '<div><label>Note (optional)</label><input type="text" id="priceNote"></div></div>' +
      '<div class="btn-row"><button class="btn" id="priceSave">Save price</button>' +
      '<button class="btn ghost" id="priceCancel" style="display:none">Cancel edit</button></div>' +
      '<table style="margin-top:10px"><thead><tr><th>Item</th><th>Price</th><th>Note</th><th></th></tr></thead><tbody>' +
      (priceRows || '<tr><td colspan="4" class="empty">No prices yet.</td></tr>') + "</tbody></table></div>";
  }

  function pageInstructions() {
    var ins = state.instructions;
    var tones = ["friendly", "professional", "formal", "casual", "helpful and brief"];
    var opts = tones.map(function (t) {
      return '<option value="' + t + '"' + (ins.tone === t ? " selected" : "") + ">" + t + "</option>";
    }).join("");
    return '<div class="card"><h3>Instructions &amp; personality</h3>' +
      '<p class="hint">These are published inside the knowledge base document, so the chatbot follows them from its retrieved context. They steer tone and fallback behaviour; they are not a system-level prompt - hard guarantees (like never giving medical advice) also belong in the disclaimer text below and in what you choose to publish.</p>' +
      '<label>Tone of voice</label><select id="insTone">' + opts + "</select>" +
      '<label>Custom instructions</label><textarea id="insCustom" placeholder="e.g. Always answer in the visitor\'s language. Keep answers under 3 sentences. Never invent prices.">' + esc(ins.custom) + "</textarea>" +
      '<label>Fallback message (when the answer is not in the knowledge base)</label><textarea id="insFallback">' + esc(ins.fallbackMessage) + "</textarea>" +
      '<label>Disclaimer / safety note (optional)</label><textarea id="insDisclaimer" placeholder="e.g. This chatbot gives clinic information only and does not provide medical advice.">' + esc(ins.disclaimer) + "</textarea>" +
      '<div class="btn-row"><button class="btn" id="insSave">Save instructions</button></div></div>';
  }

  function pageAppearance() {
    var a = state.appearance;
    return '<div class="row2" style="display:grid"><div class="card"><h3>Appearance</h3>' +
      '<label>Chat title</label><input type="text" id="appTitle" value="' + esc(a.title) + '">' +
      '<label>Subtitle</label><input type="text" id="appSubtitle" value="' + esc(a.subtitle) + '">' +
      '<label>Welcome message</label><textarea id="appWelcome">' + esc(a.welcomeMessage) + "</textarea>" +
      '<label>Input placeholder</label><input type="text" id="appPlaceholder" value="' + esc(a.placeholder) + '">' +
      '<div class="row2"><div><label>Theme colour</label><input type="color" id="appColor" value="' + esc(a.primaryColor) + '"></div>' +
      '<div><label>Position</label><select id="appPosition"><option value="right"' + (a.position === "right" ? " selected" : "") + '>Bottom right</option><option value="left"' + (a.position === "left" ? " selected" : "") + ">Bottom left</option></select></div></div>" +
      '<div class="btn-row"><button class="btn" id="appSave">Save appearance</button></div>' +
      '<p class="hint">Appearance applies through the embed snippet - after saving, copy the fresh snippet from the Embed page onto the website.</p></div>' +
      '<div class="card"><h3>Live preview</h3><div class="preview-wrap"><div class="preview-panel">' +
      '<div class="preview-head" id="pvHead"><div class="t" id="pvTitle"></div><div class="s" id="pvSubtitle"></div></div>' +
      '<div class="preview-body"><div class="preview-msg" id="pvWelcome"></div></div>' +
      '<div class="preview-input"><div class="fake" id="pvPlaceholder"></div><div class="preview-send" id="pvSend">➤</div></div>' +
      "</div></div></div></div>";
  }

  function pageSupport() {
    var s = state.support;
    return '<div class="card"><h3>Human support &amp; live handover</h3>' +
      '<p class="hint">When the chatbot cannot answer, visitors should reach a human. These details are published inside the knowledge base, so the chatbot shares them whenever a visitor asks for help, a person, or contact details. A true live-chat takeover (a human typing inside the same chat window) needs a staffed inbox service - the WhatsApp route below is the practical version for most small businesses: the chat hands the visitor to your WhatsApp, where your team replies.</p>' +
      '<label class="switch"><input type="checkbox" id="supEnabled"' + (s.enabled ? " checked" : "") + "> Enable human handover</label>" +
      '<div class="row2"><div><label>WhatsApp number</label><input type="tel" id="supWhatsapp" value="' + esc(s.whatsapp) + '" placeholder="+92 3xx xxxxxxx"></div>' +
      '<div><label>Support email</label><input type="email" id="supEmail" value="' + esc(s.email) + '"></div></div>' +
      '<label>Support hours</label><input type="text" id="supHours" value="' + esc(s.hours) + '" placeholder="e.g. Mon-Sat, 9 AM to 9 PM">' +
      '<label>Handover message</label><textarea id="supMessage">' + esc(s.message) + "</textarea>" +
      '<div class="btn-row"><button class="btn" id="supSave">Save support settings</button></div>' +
      (s.whatsapp ? '<p class="hint">Visitors can also be sent straight to <a target="_blank" rel="noopener" href="https://wa.me/' + esc(s.whatsapp.replace(/[^0-9]/g, "")) + '">your WhatsApp chat</a>.</p>' : "") +
      "</div>";
  }

  function pageChat() {
    var log = state.conversations.slice(-30).map(function (c) {
      return chatRow(c);
    }).join("");
    return '<div class="card"><h3>Test your chatbot</h3>' +
      '<p class="hint">This talks to the real backend using the active collection (' + esc(state.activeCollection || "none set") + '). Every test is logged below and feeds the Unanswered and Analytics pages. Note: this shows your test conversations - real visitor chats happen on the website and are not stored by the current backend.</p>' +
      '<div class="chatbox"><div class="chatlog" id="chatLog">' + (log || '<div class="empty">No test messages yet - ask something below.</div>') + "</div>" +
      '<div class="chatbar"><input type="text" id="chatInput" placeholder="Ask as a visitor would..."><button class="btn" id="chatSend">Send</button></div></div></div>' +
      '<div class="card"><h3>Conversation log</h3><input type="text" class="search" id="convSearch" placeholder="Search conversations...">' +
      '<div class="btn-row" style="margin:0 0 10px"><button class="btn ghost small" id="convClear">Clear log</button></div>' +
      '<table><thead><tr><th>When</th><th>Question</th><th>Answer</th><th>Status</th><th>Rating</th></tr></thead><tbody id="convRows">' +
      convRows(state.conversations) + "</tbody></table></div>";
  }

  function chatRow(c) {
    return '<div class="row user"><div class="bubble">' + esc(c.question) + "</div></div>" +
      '<div class="row assistant"><div class="bubble' + (c.unanswered ? " unanswered" : "") + '">' + esc(c.answer) +
      '<div class="rate"><button data-rate="up" data-id="' + c.id + '"' + (c.rating === "up" ? ' class="picked"' : "") + ">Helpful</button>" +
      '<button data-rate="down" data-id="' + c.id + '"' + (c.rating === "down" ? ' class="picked"' : "") + ">Not helpful</button></div>" +
      "</div></div>";
  }

  function convRows(list) {
    if (!list.length) return '<tr><td colspan="5" class="empty">No conversations logged yet.</td></tr>';
    return list.slice().reverse().map(function (c) {
      return "<tr><td>" + esc(fmtDate(c.date)) + "</td><td>" + esc(c.question) + "</td><td>" + esc(String(c.answer).slice(0, 140)) + "</td><td>" +
        (c.unanswered ? '<span class="pill red">unanswered</span>' : '<span class="pill">answered</span>') + "</td><td>" +
        (c.rating === "up" ? "Helpful" : c.rating === "down" ? "Not helpful" : "-") + "</td></tr>";
    }).join("");
  }

  function pageUnanswered() {
    var open = state.unanswered.filter(function (u) { return !u.resolved; });
    var rows = open.map(function (u) {
      return "<tr><td>" + esc(fmtDate(u.date)) + "</td><td>" + esc(u.question) + '</td><td class="actions">' +
        '<button class="btn small" data-act="answerfaq" data-id="' + u.id + '">Add FAQ answer</button> ' +
        '<button class="btn small ghost" data-act="resolveun" data-id="' + u.id + '">Mark resolved</button> ' +
        '<button class="btn small danger" data-act="delun" data-id="' + u.id + '">Delete</button></td></tr>';
    }).join("");
    return '<div class="card"><h3>Unanswered questions</h3>' +
      '<p class="hint">Questions from your test chats where the chatbot found nothing in the knowledge base. The fix loop: add an FAQ answer, publish the knowledge base again, then test the same question - it should now answer.</p>' +
      '<table><thead><tr><th>When</th><th>Question</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3" class="empty">Nothing unanswered - good coverage.</td></tr>') + "</tbody></table></div>";
  }

  function pageAnalytics() {
    var a = computeAnalytics(state);
    var max = a.popular.length ? a.popular[0].count : 1;
    var bars = a.popular.map(function (p) {
      return '<div class="bar-row"><div class="q">' + esc(p.question) + '</div><div class="bar-track"><div class="bar-fill" style="width:' +
        Math.round((p.count / max) * 100) + '%"></div></div><div>' + p.count + "</div></div>";
    }).join("");
    return '<div class="grid">' + stat(a.totalChats, "Total chats (test)") + stat(a.answeredRate + "%", "Answered rate") +
      stat(a.unanswered, "Unanswered") + stat(a.satisfaction === null ? "-" : a.satisfaction + "%", "Customer satisfaction") +
      stat(a.ratingsCount, "Answers rated") + "</div>" +
      '<div class="card"><h3>Popular questions</h3>' + (bars || '<p class="empty">No questions logged yet - run some test chats.</p>') + "</div>" +
      notice("warn", "Scope: these analytics count your TEST conversations from this dashboard. The current RAGForge backend does not log real website visitors' questions, so live traffic analytics need a small logging endpoint added to the backend - that is the planned next step, and this page is already shaped to receive it.");
  }

  function pageEmbed() {
    return '<div class="card"><h3>Embed on your website</h3>' +
      '<p class="hint">Paste this before the closing &lt;/body&gt; tag of any page. It loads the widget from your backend and connects it to the active knowledge base (' + esc(state.activeCollection || "none - publish or set one active first") + '). Appearance comes from the Appearance page.</p>' +
      '<pre class="snippet">' + esc(buildEmbedSnippet(state)) + "</pre>" +
      '<div class="btn-row"><button class="btn" id="copySnippet">Copy snippet</button><span class="hint" id="copyStatus"></span></div></div>';
  }

  function pageSettings() {
    return '<div class="card"><h3>Backend connection</h3>' +
      '<label>RAGForge backend URL</label><input type="url" id="setApiBase" value="' + esc(state.settings.apiBase) + '">' +
      '<div class="btn-row"><button class="btn" id="setSave">Save &amp; reconnect</button><span class="hint" id="setStatus"></span></div></div>' +
      '<div class="card"><h3>Backup &amp; restore</h3>' +
      '<p class="hint">All dashboard data (FAQs, business info, appearance, logs) lives in this browser. Export a backup before switching browsers or clearing site data.</p>' +
      '<div class="btn-row"><button class="btn ghost" id="exportBtn">Export JSON backup</button>' +
      '<label class="btn ghost" style="margin:0;cursor:pointer">Import backup<input type="file" id="importFile" accept=".json" style="display:none"></label></div></div>' +
      '<div class="card"><h3>Danger zone</h3>' +
      '<div class="btn-row"><button class="btn danger" id="wipeBtn">Erase all dashboard data</button></div></div>';
  }

  var PAGES = {
    overview: { title: "Overview", render: pageOverview },
    kb: { title: "Knowledge Base - Files", render: pageKb },
    publish: { title: "Publish Knowledge Base", render: pagePublish },
    faqs: { title: "FAQs", render: pageFaqs },
    urls: { title: "Website Content", render: pageUrls },
    business: { title: "Business Info, Services & Pricing", render: pageBusiness },
    instructions: { title: "Instructions & Personality", render: pageInstructions },
    appearance: { title: "Appearance", render: pageAppearance },
    support: { title: "Human Support & Handover", render: pageSupport },
    chat: { title: "Conversations & Test Chat", render: pageChat },
    unanswered: { title: "Unanswered Questions", render: pageUnanswered },
    analytics: { title: "Analytics", render: pageAnalytics },
    embed: { title: "Embed & Deploy", render: pageEmbed },
    settings: { title: "Settings & Backup", render: pageSettings }
  };

  function navigate(page) {
    currentPage = page;
    document.querySelectorAll(".nav button").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-nav") === page);
    });
    var title = document.getElementById("pageTitle");
    if (title) title.textContent = PAGES[page].title;
    root.innerHTML = PAGES[page].render();
    bindPage(page);
    var badge = document.getElementById("unansweredBadge");
    var openCount = state.unanswered.filter(function (u) { return !u.resolved; }).length;
    if (badge) { badge.textContent = openCount; badge.style.display = openCount ? "" : "none"; }
  }

  /* ================================================================
   * 6. Actions + per-page binding
   * ================================================================ */

  function publishKnowledgeBase(statusEl) {
    var doc = composeKnowledgeBase(state);
    var blob = new Blob([doc], { type: "text/plain" });
    statusEl.textContent = "Uploading to the backend...";
    return api.uploadBlob(blob, "knowledge-base.txt").then(function (data) {
      if (!data.success) throw new Error(data.error || "Upload failed");
      state.collections.push({
        id: uid(), name: "Published knowledge base", collection: data.collection_name,
        chunks: data.chunks_count, date: Date.now(), kind: "published"
      });
      state.activeCollection = data.collection_name;
      save();
      statusEl.textContent = "Published: " + data.chunks_count + " chunks indexed as " + data.collection_name + " (now active).";
      return data;
    }).catch(function (err) {
      statusEl.textContent = "Publish failed: " + err.message;
      throw err;
    });
  }

  function bindPage(page) {
    if (page === "overview") {
      root.querySelectorAll("[data-nav]").forEach(function (b) {
        b.addEventListener("click", function () { navigate(b.getAttribute("data-nav")); });
      });
    }

    if (page === "kb") {
      document.getElementById("kbUploadBtn").addEventListener("click", function () {
        var input = document.getElementById("kbFiles");
        var status = document.getElementById("kbUploadStatus");
        if (!input.files.length) { status.textContent = "Choose at least one file first."; return; }
        var files = Array.prototype.slice.call(input.files);
        status.textContent = "Uploading " + files.length + " file(s)...";
        var chain = Promise.resolve();
        files.forEach(function (file) {
          chain = chain.then(function () {
            return api.uploadFile(file).then(function (data) {
              if (!data.success) throw new Error(data.error || ("Upload failed for " + file.name));
              state.collections.push({
                id: uid(), name: file.name, collection: data.collection_name,
                chunks: data.chunks_count, date: Date.now(), kind: "file"
              });
              if (!state.activeCollection) state.activeCollection = data.collection_name;
              save();
            });
          });
        });
        chain.then(function () { status.textContent = "Done."; navigate("kb"); })
          .catch(function (err) { status.textContent = "Failed: " + err.message; });
      });
      document.getElementById("kbSearch").addEventListener("input", function (e) {
        var q = e.target.value.toLowerCase();
        root.querySelectorAll("#kbRows tr").forEach(function (tr) {
          tr.style.display = tr.textContent.toLowerCase().indexOf(q) !== -1 ? "" : "none";
        });
      });
    }

    if (page === "publish") {
      document.getElementById("publishBtn").addEventListener("click", function () {
        var status = document.getElementById("publishStatus");
        publishKnowledgeBase(status).then(function () { navigate("publish"); }).catch(function () {});
      });
    }

    if (page === "faqs") bindCrud({
      saveBtn: "faqSave", cancelBtn: "faqCancel", idField: "faqId", title: "faqFormTitle",
      get: function () {
        return { question: val("faqQ"), answer: val("faqA") };
      },
      set: function (item) { setVal("faqQ", item.question); setVal("faqA", item.answer); },
      clear: function () { setVal("faqQ", ""); setVal("faqA", ""); },
      list: function () { return state.faqs; },
      validate: function (item) { return item.question && item.answer ? "" : "Both question and answer are required."; }
    });
    var faqSearch = document.getElementById("faqSearch");
    if (faqSearch) faqSearch.addEventListener("input", function (e) {
      var q = e.target.value.toLowerCase();
      root.querySelectorAll("#faqRows tr").forEach(function (tr) {
        tr.style.display = tr.textContent.toLowerCase().indexOf(q) !== -1 ? "" : "none";
      });
    });

    if (page === "urls") {
      bindCrud({
        saveBtn: "urlSave", cancelBtn: "urlCancel", idField: "urlId", title: "urlFormTitle",
        get: function () { return { url: val("urlInput"), content: val("urlContent") }; },
        set: function (item) { setVal("urlInput", item.url); setVal("urlContent", item.content); },
        clear: function () { setVal("urlInput", ""); setVal("urlContent", ""); },
        list: function () { return state.urls; },
        validate: function (item) { return item.url ? "" : "A URL is required."; }
      });
      document.getElementById("urlFetch").addEventListener("click", function () {
        var url = val("urlInput");
        var status = document.getElementById("urlFetchStatus");
        if (!url) { status.textContent = "Enter a URL first."; return; }
        status.textContent = "Fetching...";
        fetch(url).then(function (r) { return r.text(); }).then(function (html) {
          var tmp = document.createElement("div");
          tmp.innerHTML = html;
          tmp.querySelectorAll("script,style,nav,footer,header").forEach(function (n) { n.remove(); });
          var text = (tmp.textContent || "").replace(/\s+/g, " ").trim().slice(0, 20000);
          setVal("urlContent", text);
          status.textContent = "Fetched " + text.split(/\s+/).filter(Boolean).length + " words. Review, then Save page.";
        }).catch(function () {
          status.textContent = "Fetch blocked (the site does not allow browser fetching). Paste the page text manually, or use admin/fetch_urls.py.";
        });
      });
    }

    if (page === "business") {
      document.getElementById("bizSave").addEventListener("click", function () {
        state.business = {
          name: val("bizName"), website: val("bizWebsite"), about: val("bizAbout"),
          address: val("bizAddress"), hours: val("bizHours"), phone: val("bizPhone"), email: val("bizEmail")
        };
        save(); navigate("business");
      });
      bindCrud({
        saveBtn: "svcSave", cancelBtn: "svcCancel", idField: "svcId", title: "svcFormTitle", rerender: "business",
        get: function () { return { name: val("svcName"), description: val("svcDesc") }; },
        set: function (item) { setVal("svcName", item.name); setVal("svcDesc", item.description); },
        clear: function () { setVal("svcName", ""); setVal("svcDesc", ""); },
        list: function () { return state.services; },
        validate: function (item) { return item.name ? "" : "A service name is required."; }
      });
      bindCrud({
        saveBtn: "priceSave", cancelBtn: "priceCancel", idField: "priceId", title: "priceFormTitle", rerender: "business",
        get: function () { return { item: val("priceItem"), price: val("priceValue"), note: val("priceNote") }; },
        set: function (item) { setVal("priceItem", item.item); setVal("priceValue", item.price); setVal("priceNote", item.note); },
        clear: function () { setVal("priceItem", ""); setVal("priceValue", ""); setVal("priceNote", ""); },
        list: function () { return state.prices; },
        validate: function (item) { return item.item && item.price ? "" : "Item and price are required."; }
      });
    }

    if (page === "instructions") {
      document.getElementById("insSave").addEventListener("click", function () {
        state.instructions = {
          tone: val("insTone"), custom: val("insCustom"),
          fallbackMessage: val("insFallback"), disclaimer: val("insDisclaimer")
        };
        save(); navigate("instructions");
      });
    }

    if (page === "appearance") {
      var syncPreview = function () {
        var color = val("appColor");
        document.getElementById("pvHead").style.background = color;
        document.getElementById("pvSend").style.background = color;
        document.getElementById("pvTitle").textContent = val("appTitle");
        document.getElementById("pvSubtitle").textContent = val("appSubtitle");
        document.getElementById("pvWelcome").textContent = val("appWelcome");
        document.getElementById("pvPlaceholder").textContent = val("appPlaceholder");
      };
      ["appTitle", "appSubtitle", "appWelcome", "appPlaceholder", "appColor"].forEach(function (id) {
        document.getElementById(id).addEventListener("input", syncPreview);
      });
      syncPreview();
      document.getElementById("appSave").addEventListener("click", function () {
        state.appearance = {
          title: val("appTitle"), subtitle: val("appSubtitle"), welcomeMessage: val("appWelcome"),
          placeholder: val("appPlaceholder"), primaryColor: val("appColor"), position: val("appPosition")
        };
        save(); navigate("appearance");
      });
    }

    if (page === "support") {
      document.getElementById("supSave").addEventListener("click", function () {
        state.support = {
          enabled: document.getElementById("supEnabled").checked,
          whatsapp: val("supWhatsapp"), email: val("supEmail"),
          hours: val("supHours"), message: val("supMessage")
        };
        save(); navigate("support");
      });
    }

    if (page === "chat") bindChat();
    if (page === "embed") {
      document.getElementById("copySnippet").addEventListener("click", function () {
        var status = document.getElementById("copyStatus");
        var text = buildEmbedSnippet(state);
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(function () { status.textContent = "Copied."; })
            .catch(function () { status.textContent = "Copy failed - select the text manually."; });
        }
      });
    }
    if (page === "settings") bindSettings();
  }

  function val(id) { var n = document.getElementById(id); return n ? n.value.trim() : ""; }
  function setVal(id, v) { var n = document.getElementById(id); if (n) n.value = v || ""; }

  /** Generic CRUD binding for the simple list forms (FAQs, URLs, services, prices). */
  function bindCrud(cfg) {
    var saveBtn = document.getElementById(cfg.saveBtn);
    if (!saveBtn) return;
    saveBtn.addEventListener("click", function () {
      var item = cfg.get();
      var err = cfg.validate(item);
      if (err) { alert(err); return; }
      var list = cfg.list();
      var editId = val(cfg.idField);
      if (editId) {
        list.forEach(function (x) { if (x.id === editId) for (var k in item) x[k] = item[k]; });
      } else {
        item.id = uid();
        list.push(item);
      }
      save();
      navigate(cfg.rerender || currentPage);
    });
    var cancelBtn = document.getElementById(cfg.cancelBtn);
    if (cancelBtn) cancelBtn.addEventListener("click", function () { navigate(cfg.rerender || currentPage); });
  }

  function bindChat() {
    var input = document.getElementById("chatInput");
    var log = document.getElementById("chatLog");
    log.scrollTop = log.scrollHeight;

    function send() {
      var q = input.value.trim();
      if (!q) return;
      if (!state.activeCollection) { alert("No active knowledge base yet. Publish one or set a collection active first."); return; }
      input.value = "";
      log.insertAdjacentHTML("beforeend",
        '<div class="row user"><div class="bubble">' + esc(q) + '</div></div><div class="typing" id="chatTyping">Thinking...</div>');
      log.scrollTop = log.scrollHeight;
      api.query(q, state.activeCollection).then(function (data) {
        var typing = document.getElementById("chatTyping");
        if (typing) typing.remove();
        if (!data.success) throw new Error(data.error || "Query failed");
        var un = looksUnanswered(data.answer, (data.context || []).length);
        var entry = {
          id: uid(), date: Date.now(), question: q, answer: data.answer,
          contextCount: (data.context || []).length, unanswered: un, rating: ""
        };
        state.conversations.push(entry);
        if (un) state.unanswered.push({ id: uid(), date: Date.now(), question: q, resolved: false });
        save();
        log.insertAdjacentHTML("beforeend", chatRow(entry));
        log.scrollTop = log.scrollHeight;
        refreshConvTable();
      }).catch(function (err) {
        var typing = document.getElementById("chatTyping");
        if (typing) typing.remove();
        log.insertAdjacentHTML("beforeend",
          '<div class="row assistant"><div class="bubble unanswered">Error: ' + esc(err.message) + "</div></div>");
        log.scrollTop = log.scrollHeight;
      });
    }

    document.getElementById("chatSend").addEventListener("click", send);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });

    var search = document.getElementById("convSearch");
    if (search) search.addEventListener("input", function (e) {
      var q = e.target.value.toLowerCase();
      var filtered = state.conversations.filter(function (c) {
        return (c.question + " " + c.answer).toLowerCase().indexOf(q) !== -1;
      });
      document.getElementById("convRows").innerHTML = convRows(filtered);
    });
    var clearBtn = document.getElementById("convClear");
    if (clearBtn) clearBtn.addEventListener("click", function () {
      if (!confirm("Clear the whole test conversation log?")) return;
      state.conversations = []; save(); navigate("chat");
    });
  }

  function refreshConvTable() {
    var tbody = document.getElementById("convRows");
    if (tbody) tbody.innerHTML = convRows(state.conversations);
  }

  function bindSettings() {
    document.getElementById("setSave").addEventListener("click", function () {
      state.settings.apiBase = val("setApiBase");
      save(); backendOk = null; setBackendStatus(); checkBackend();
      document.getElementById("setStatus").textContent = "Saved.";
    });
    document.getElementById("exportBtn").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ragforge-admin-backup.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    document.getElementById("importFile").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      file.text().then(function (text) {
        try {
          var parsed = JSON.parse(text);
          var base = defaultState();
          for (var k in base) if (parsed[k] !== undefined) base[k] = parsed[k];
          state = base; save(); navigate("overview");
          alert("Backup imported.");
        } catch (err) { alert("That file is not a valid backup."); }
      });
    });
    document.getElementById("wipeBtn").addEventListener("click", function () {
      if (!confirm("Erase ALL dashboard data in this browser? Backend collections are not deleted.")) return;
      try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      state = defaultState(); save(); navigate("overview");
    });
  }

  /* ---------- global click actions (table buttons) ---------- */

  function bindGlobalActions() {
    document.addEventListener("click", function (e) {
      var navBtn = e.target.closest("[data-nav]");
      if (navBtn && navBtn.classList.contains("nav-btn")) { navigate(navBtn.getAttribute("data-nav")); return; }

      var rateBtn = e.target.closest("[data-rate]");
      if (rateBtn) {
        var cid = rateBtn.getAttribute("data-id");
        state.conversations.forEach(function (c) { if (c.id === cid) c.rating = rateBtn.getAttribute("data-rate"); });
        save();
        rateBtn.parentElement.querySelectorAll("button").forEach(function (b) {
          b.classList.toggle("picked", b === rateBtn);
        });
        return;
      }

      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      var id = btn.getAttribute("data-id");

      if (act === "activate") {
        state.collections.forEach(function (c) { if (c.id === id) state.activeCollection = c.collection; });
        save(); navigate("kb");
      }
      if (act === "delcol") {
        var col = state.collections.filter(function (c) { return c.id === id; })[0];
        if (!col || !confirm("Delete collection " + col.collection + " from the backend?")) return;
        api.clear(col.collection).then(function () {
          state.collections = state.collections.filter(function (c) { return c.id !== id; });
          if (state.activeCollection === col.collection) state.activeCollection = "";
          save(); navigate("kb");
        }).catch(function (err) { alert("Delete failed: " + err.message); });
      }
      if (act === "delfaq") { state.faqs = state.faqs.filter(function (f) { return f.id !== id; }); save(); navigate("faqs"); }
      if (act === "editfaq") {
        navigate("faqs");
        var f = state.faqs.filter(function (x) { return x.id === id; })[0];
        if (f) {
          setVal("faqId", f.id); setVal("faqQ", f.question); setVal("faqA", f.answer);
          document.getElementById("faqFormTitle").textContent = "Edit FAQ";
          document.getElementById("faqCancel").style.display = "";
        }
      }
      if (act === "delurl") { state.urls = state.urls.filter(function (u) { return u.id !== id; }); save(); navigate("urls"); }
      if (act === "editurl") {
        navigate("urls");
        var u = state.urls.filter(function (x) { return x.id === id; })[0];
        if (u) {
          setVal("urlId", u.id); setVal("urlInput", u.url); setVal("urlContent", u.content);
          document.getElementById("urlFormTitle").textContent = "Edit page";
          document.getElementById("urlCancel").style.display = "";
        }
      }
      if (act === "delsvc") { state.services = state.services.filter(function (x) { return x.id !== id; }); save(); navigate("business"); }
      if (act === "editsvc") {
        navigate("business");
        var sv = state.services.filter(function (x) { return x.id === id; })[0];
        if (sv) {
          setVal("svcId", sv.id); setVal("svcName", sv.name); setVal("svcDesc", sv.description);
          document.getElementById("svcCancel").style.display = "";
        }
      }
      if (act === "delprice") { state.prices = state.prices.filter(function (x) { return x.id !== id; }); save(); navigate("business"); }
      if (act === "editprice") {
        navigate("business");
        var p = state.prices.filter(function (x) { return x.id === id; })[0];
        if (p) {
          setVal("priceId", p.id); setVal("priceItem", p.item); setVal("priceValue", p.price); setVal("priceNote", p.note);
          document.getElementById("priceCancel").style.display = "";
        }
      }
      if (act === "answerfaq") {
        var un = state.unanswered.filter(function (x) { return x.id === id; })[0];
        if (un) {
          navigate("faqs");
          setVal("faqQ", un.question);
          document.getElementById("faqA").focus();
          un.resolved = true; save();
        }
      }
      if (act === "resolveun") {
        state.unanswered.forEach(function (x) { if (x.id === id) x.resolved = true; });
        save(); navigate("unanswered");
      }
      if (act === "delun") {
        state.unanswered = state.unanswered.filter(function (x) { return x.id !== id; });
        save(); navigate("unanswered");
      }
    });
  }

  /* ================================================================
   * 7. Boot
   * ================================================================ */

  function boot() {
    root = document.getElementById("pageRoot");
    bindGlobalActions();
    document.querySelectorAll(".nav button").forEach(function (b) {
      b.addEventListener("click", function () { navigate(b.getAttribute("data-nav")); });
    });
    checkBackend();
    navigate("overview");
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }

  var internals = {
    defaultState: defaultState,
    composeKnowledgeBase: composeKnowledgeBase,
    buildEmbedSnippet: buildEmbedSnippet,
    computeAnalytics: computeAnalytics,
    looksUnanswered: looksUnanswered
  };

  if (typeof module !== "undefined" && module.exports) module.exports = internals;
  global.RAGForgeAdmin = internals;
})(typeof window !== "undefined" ? window : globalThis);
