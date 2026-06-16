"use strict";

/* ------------------------------------------------------------------ *
 * Cheapest AI Models — live pricing table
 * Data source: OpenRouter public models API (no API key required).
 *   GET https://openrouter.ai/api/v1/models
 *   GET https://openrouter.ai/api/v1/models?category=programming
 * Pricing fields are USD *per token* (strings); we display USD per 1M.
 * ------------------------------------------------------------------ */

const API_BASE = "https://openrouter.ai/api/v1/models";
const PREFS_KEY = "ai-pricing-prefs-v1";

// Friendly company names keyed by the OpenRouter id prefix (before the "/").
const COMPANY_NAMES = {
  "openai": "OpenAI",
  "anthropic": "Anthropic",
  "google": "Google",
  "x-ai": "xAI",
  "meta-llama": "Meta",
  "mistralai": "Mistral AI",
  "deepseek": "DeepSeek",
  "moonshotai": "Moonshot AI",
  "qwen": "Qwen (Alibaba)",
  "cohere": "Cohere",
  "amazon": "Amazon",
  "microsoft": "Microsoft",
  "nvidia": "NVIDIA",
  "perplexity": "Perplexity",
  "nousresearch": "Nous Research",
  "01-ai": "01.AI",
  "z-ai": "Z.AI",
  "inflection": "Inflection",
  "liquid": "Liquid AI",
  "minimax": "MiniMax",
  "baidu": "Baidu",
  "ai21": "AI21 Labs",
  "openrouter": "OpenRouter",
  "thedrummer": "TheDrummer",
  "sao10k": "Sao10K",
  "gryphe": "Gryphe",
  "cognitivecomputations": "Cognitive Computations",
};

// Numeric columns (everything else sorts as text).
const NUMERIC_KEYS = new Set(["input", "output", "blended", "context"]);

/* ------------------------------ State ----------------------------- */
const state = {
  models: [],          // transformed + valid models from last successful load
  sortKey: "blended",
  sortDir: "asc",
  blend: "3:1",        // input:output weighting used for the blended column
  search: "",
  company: "all",
  codingOnly: false,
  hideFree: false,
  lastUpdated: null,
};

/* ----------------------------- Elements --------------------------- */
const els = {};
function cacheEls() {
  els.search = document.getElementById("search");
  els.company = document.getElementById("companyFilter");
  els.blend = document.getElementById("blendSelect");
  els.codingOnly = document.getElementById("codingOnly");
  els.hideFree = document.getElementById("hideFree");
  els.refresh = document.getElementById("refreshBtn");
  els.status = document.getElementById("status");
  els.message = document.getElementById("message");
  els.tbody = document.getElementById("tableBody");
  els.table = document.getElementById("pricingTable");
  els.headers = Array.from(document.querySelectorAll("th.sortable"));
}

/* ----------------------------- Helpers ---------------------------- */
function titleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function companyFromId(id) {
  const slug = String(id || "").replace(/^~/, "").split("/")[0].toLowerCase();
  return {
    key: slug,
    name: COMPANY_NAMES[slug] || titleCase(slug.replace(/[-_]/g, " ")),
  };
}

// Strip a leading "Provider: " prefix from the display name (OpenRouter
// names look like "OpenAI: GPT-4o"); keep the rest as the model name.
function cleanModelName(name) {
  const idx = String(name).indexOf(": ");
  if (idx > -1 && idx <= 24) return name.slice(idx + 2);
  return name;
}

function toPerMillion(perTokenStr) {
  if (perTokenStr == null) return null;
  const n = parseFloat(perTokenStr);
  if (!Number.isFinite(n)) return null;
  return n * 1_000_000;
}

function blendedCost(input, output, blend) {
  const [wi, wo] = blend.split(":").map(Number);
  const total = wi + wo;
  if (!total) return input; // guard
  return (wi * input + wo * output) / total;
}

function fmtUSD(v) {
  if (v === 0) return "Free";
  if (v == null || !Number.isFinite(v)) return "—";
  if (v < 0.1) return "$" + v.toFixed(4);
  if (v < 1) return "$" + v.toFixed(3);
  if (v < 100) return "$" + v.toFixed(2);
  return "$" + v.toFixed(0);
}

function fmtContext(n) {
  if (!n) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return (Number.isInteger(m) ? m : m.toFixed(1)) + "M";
  }
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}

function fmtTime(date) {
  try {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (_) {
    return date.toISOString();
  }
}

/* ------------------------- Data transform ------------------------- */
function transform(raw) {
  const pricing = raw.pricing || {};
  const input = toPerMillion(pricing.prompt);
  const output = toPerMillion(pricing.completion);
  const { key, name: company } = companyFromId(raw.id);
  const context =
    raw.context_length ||
    (raw.top_provider && raw.top_provider.context_length) ||
    null;

  // Valid = both per-token prices known and non-negative. This drops
  // meta/router models that report "-1" (variable/un-priced).
  const valid =
    input != null && output != null && input >= 0 && output >= 0;

  return {
    id: raw.id,
    modelName: cleanModelName(raw.name || raw.id),
    company,
    companyKey: key,
    input,
    output,
    context,
    isFree: input === 0 && output === 0,
    valid,
  };
}

/* ----------------------------- Fetch ------------------------------ */
async function loadData() {
  const url = state.codingOnly ? `${API_BASE}?category=programming` : API_BASE;
  showMessage("Loading live pricing from OpenRouter…");
  els.refresh.disabled = true;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    const list = Array.isArray(json.data) ? json.data : [];

    state.models = list.map(transform).filter((m) => m.valid);
    state.lastUpdated = new Date();

    if (state.models.length === 0) {
      throw new Error("No priced models returned by the API.");
    }

    hideMessage();
    populateCompanyFilter();
    render();
  } catch (err) {
    const reason =
      err && err.name === "AbortError"
        ? "the request timed out"
        : (err && err.message) || "unknown error";
    showError(reason);
  } finally {
    clearTimeout(timeout);
    els.refresh.disabled = false;
  }
}

/* --------------------------- UI: messages ------------------------- */
function showMessage(text) {
  els.message.className = "message";
  els.message.textContent = text;
  els.message.hidden = false;
  els.table.parentElement.style.display = "none";
}

function showError(reason) {
  els.message.className = "message error";
  els.message.innerHTML =
    `<div>Could not load live pricing — ${escapeHtml(reason)}.</div>`;
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.textContent = "↻ Try again";
  btn.addEventListener("click", loadData);
  els.message.appendChild(btn);
  els.message.hidden = false;
  els.table.parentElement.style.display = "none";
  els.status.textContent = "";
}

function hideMessage() {
  els.message.hidden = true;
  els.table.parentElement.style.display = "";
}

/* --------------------------- Filtering ---------------------------- */
function getVisibleModels() {
  const q = state.search.trim().toLowerCase();
  return state.models.filter((m) => {
    if (state.hideFree && m.isFree) return false;
    if (state.company !== "all" && m.companyKey !== state.company) return false;
    if (q) {
      const hay = `${m.modelName} ${m.company} ${m.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sortModels(list) {
  const { sortKey, sortDir, blend } = state;
  const dir = sortDir === "asc" ? 1 : -1;
  const numeric = NUMERIC_KEYS.has(sortKey);

  return list.slice().sort((a, b) => {
    let av, bv;
    if (sortKey === "blended") {
      av = blendedCost(a.input, a.output, blend);
      bv = blendedCost(b.input, b.output, blend);
    } else {
      av = a[sortKey];
      bv = b[sortKey];
    }

    if (numeric) {
      av = av == null ? Infinity : av;
      bv = bv == null ? Infinity : bv;
      if (av !== bv) return (av - bv) * dir;
      // tie-breaker: cheaper blended, then name
      const ab = blendedCost(a.input, a.output, blend);
      const bb = blendedCost(b.input, b.output, blend);
      if (ab !== bb) return ab - bb;
      return a.modelName.localeCompare(b.modelName);
    }

    return String(av).localeCompare(String(bv)) * dir;
  });
}

/* ----------------------------- Render ----------------------------- */
function render() {
  const visible = sortModels(getVisibleModels());
  const blend = state.blend;

  els.tbody.innerHTML = "";
  const frag = document.createDocumentFragment();

  visible.forEach((m, i) => {
    const tr = document.createElement("tr");
    if (i === 0 && state.sortKey === "blended" && state.sortDir === "asc") {
      tr.className = "is-cheapest";
    }

    const blended = blendedCost(m.input, m.output, blend);
    const freeBadge = m.isFree ? '<span class="badge badge-free">Free</span>' : "";
    const cheapestBadge =
      i === 0 && state.sortKey === "blended" && state.sortDir === "asc" && !m.isFree
        ? '<span class="badge badge-cheapest">Cheapest</span>'
        : "";

    tr.innerHTML = `
      <td class="rank-col">${i + 1}</td>
      <td>
        <span class="model-name">${escapeHtml(m.modelName)}</span>${freeBadge}${cheapestBadge}
        <span class="model-id">${escapeHtml(m.id)}</span>
      </td>
      <td class="company-cell">${escapeHtml(m.company)}</td>
      <td class="num">${fmtUSD(m.input)}</td>
      <td class="num">${fmtUSD(m.output)}</td>
      <td class="num blended-cell">${fmtUSD(blended)}</td>
      <td class="num">${fmtContext(m.context)}</td>
    `;
    frag.appendChild(tr);
  });

  els.tbody.appendChild(frag);
  updateStatus(visible.length);
  updateSortIndicators();
}

function updateStatus(shownCount) {
  const total = state.models.length;
  const when = state.lastUpdated ? `Updated ${fmtTime(state.lastUpdated)}` : "";
  const scope = state.codingOnly ? "coding models" : "models";
  els.status.textContent =
    `Showing ${shownCount} of ${total} ${scope} · ${when} · Live data from OpenRouter`;
}

function updateSortIndicators() {
  els.headers.forEach((th) => {
    if (th.dataset.key === state.sortKey) {
      th.setAttribute("aria-sort", state.sortDir === "asc" ? "ascending" : "descending");
    } else {
      th.removeAttribute("aria-sort");
    }
  });
}

/* ----------------------- Company filter list ---------------------- */
function populateCompanyFilter() {
  const counts = new Map();
  state.models.forEach((m) => {
    counts.set(m.companyKey, {
      name: m.company,
      n: (counts.get(m.companyKey)?.n || 0) + 1,
    });
  });
  const entries = Array.from(counts.entries()).sort((a, b) =>
    a[1].name.localeCompare(b[1].name)
  );

  const prev = state.company;
  els.company.innerHTML = '<option value="all">All companies</option>';
  for (const [key, { name, n }] of entries) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${name} (${n})`;
    els.company.appendChild(opt);
  }
  // Preserve previous selection if still present.
  els.company.value = entries.some(([k]) => k === prev) ? prev : "all";
  state.company = els.company.value;
}

/* ------------------------------ Prefs ----------------------------- */
function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        sortKey: state.sortKey,
        sortDir: state.sortDir,
        blend: state.blend,
        codingOnly: state.codingOnly,
        hideFree: state.hideFree,
      })
    );
  } catch (_) {
    /* ignore storage errors (private mode, etc.) */
  }
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.sortKey) state.sortKey = p.sortKey;
    if (p.sortDir) state.sortDir = p.sortDir;
    if (p.blend) state.blend = p.blend;
    state.codingOnly = !!p.codingOnly;
    state.hideFree = !!p.hideFree;
  } catch (_) {
    /* ignore */
  }
}

function syncControlsFromState() {
  els.blend.value = state.blend;
  els.codingOnly.checked = state.codingOnly;
  els.hideFree.checked = state.hideFree;
}

/* ------------------------- Escaping (XSS) ------------------------- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ----------------------------- Events ----------------------------- */
function wireEvents() {
  let searchTimer;
  els.search.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => {
      state.search = v;
      render();
    }, 120);
  });

  els.company.addEventListener("change", (e) => {
    state.company = e.target.value;
    render();
  });

  els.blend.addEventListener("change", (e) => {
    state.blend = e.target.value;
    savePrefs();
    render();
  });

  els.hideFree.addEventListener("change", (e) => {
    state.hideFree = e.target.checked;
    savePrefs();
    render();
  });

  // Coding-only changes the dataset, so it triggers a re-fetch.
  els.codingOnly.addEventListener("change", (e) => {
    state.codingOnly = e.target.checked;
    savePrefs();
    loadData();
  });

  els.refresh.addEventListener("click", loadData);

  els.headers.forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        // Numeric columns default ascending (cheapest/smallest first);
        // text columns also ascending (A→Z).
        state.sortDir = "asc";
      }
      savePrefs();
      render();
    });
  });
}

/* ------------------------------ Init ------------------------------ */
function init() {
  cacheEls();
  loadPrefs();
  syncControlsFromState();
  wireEvents();
  loadData();
}

document.addEventListener("DOMContentLoaded", init);
