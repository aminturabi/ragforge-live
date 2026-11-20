"use strict";
/**
 * Smoke tests for the RAGForge widget's pure logic + API client.
 * Run:  node tests/smoke.test.js
 * No browser needed - the widget exports its internals under Node.
 */
const assert = require("node:assert");
const path = require("node:path");

const internals = require(path.join(__dirname, "..", "widget", "ragforge-chat.js"));
const { mergeConfig, expandFollowUp, buildQueryPayload, friendlyError, createApiClient } = internals;

let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log("  PASS", name); })
    .catch((err) => { console.error("  FAIL", name, "-", err.message); process.exitCode = 1; });
}

(async () => {
  await ok("mergeConfig applies defaults and trims apiBase slash", () => {
    const cfg = mergeConfig({ apiBase: "https://x.example/", collection: "col_1" });
    assert.strictEqual(cfg.apiBase, "https://x.example");
    assert.strictEqual(cfg.topK, 4);
    assert.strictEqual(cfg.collection, "col_1");
  });

  await ok("mergeConfig carries v2 welcome + suggestions defaults", () => {
    const cfg = mergeConfig({ collection: "col_1", suggestions: ["What are your hours?"], welcomeHeading: "Hey!" });
    assert.deepStrictEqual(cfg.suggestions, ["What are your hours?"]);
    assert.strictEqual(cfg.welcomeHeading, "Hey!");
    const plain = mergeConfig({ collection: "col_1" });
    assert.deepStrictEqual(plain.suggestions, []);
    assert.strictEqual(plain.welcomeHeading, "");
    assert.strictEqual(plain.avatarText, "");
  });

  await ok("expandFollowUp leaves standalone questions untouched", () => {
    const history = [{ role: "user", text: "What is the CBC price?" }];
    assert.strictEqual(expandFollowUp("When does the clinic open?", history), "When does the clinic open?");
    assert.strictEqual(expandFollowUp("What is the fee?", []), "What is the fee?");
  });

  await ok("expandFollowUp expands short referential follow-ups", () => {
    const history = [
      { role: "user", text: "When does the dermatologist sit?" },
      { role: "assistant", text: "Mon-Fri, 3 to 6 PM." }
    ];
    const out = expandFollowUp("and what does she charge?", history);
    assert.ok(out.includes("When does the dermatologist sit?"), out);
    assert.ok(out.includes("and what does she charge?"), out);
  });

  await ok("buildQueryPayload matches the RAGForge /api/query contract", () => {
    const cfg = mergeConfig({ collection: "col_abc", topK: 4 });
    const payload = buildQueryPayload(cfg, "What is the ECG price?", []);
    assert.strictEqual(payload.collection_name, "col_abc");
    assert.strictEqual(payload.query, "What is the ECG price?");
    assert.strictEqual(payload.top_k, 4);
    assert.ok(Array.isArray(payload.history));
  });

  await ok("friendlyError maps known failures to visitor language", () => {
    assert.ok(/waking up/i.test(friendlyError({ name: "AbortError" }, "")));
    assert.ok(/can't reach/i.test(friendlyError(new Error("Failed to fetch"), "")));
    assert.ok(/API key/i.test(friendlyError(null, "Groq API Key is missing. Please configure it")));
    assert.ok(/knowledge base/i.test(friendlyError(null, "Collection name is required (upload a document first)")));
  });

  await ok("api client posts to /api/query and returns answer + context", async () => {
    const cfg = mergeConfig({ apiBase: "https://api.example", collection: "col_abc" });
    const calls = [];
    const stubFetch = (url, options) => {
      calls.push({ url, options });
      return Promise.resolve({
        text: () => Promise.resolve(JSON.stringify({ success: true, answer: "Rs 500.", context: ["ECG: Rs 500."] }))
      });
    };
    const api = createApiClient(cfg, stubFetch);
    const result = await api.query("ECG price?", []);
    assert.strictEqual(calls[0].url, "https://api.example/api/query");
    const body = JSON.parse(calls[0].options.body);
    assert.strictEqual(body.collection_name, "col_abc");
    assert.strictEqual(result.answer, "Rs 500.");
    assert.deepStrictEqual(result.context, ["ECG: Rs 500."]);
  });

  await ok("api client surfaces server errors instead of swallowing them", async () => {
    const cfg = mergeConfig({ apiBase: "https://api.example", collection: "" });
    const stubFetch = () => Promise.resolve({
      text: () => Promise.resolve(JSON.stringify({ success: false, error: "Collection name is required (upload a document first)" }))
    });
    const api = createApiClient(cfg, stubFetch);
    await assert.rejects(() => api.query("hi", []), (err) => /Collection name is required/.test(err.serverError));
  });

  console.log(process.exitCode ? "\nSMOKE TESTS FAILED" : `\nAll ${passed} smoke tests passed.`);
})();
