"use strict";

/* ------------------------------------------------------------------ *
 * Subscription agents pricing.
 * Authoritative data: ./data/agents.json (curated, human-verified).
 * Optional signals:   ./data/agents.snapshot.json (weekly monitor).
 *
 * Two views:
 *   - "agents" (default): one row per agent — Free badge + "starts at"
 *     entry price + price bar, sorted cheapest-first with a Cheapest
 *     highlight. Best for "which tool is cheapest to use this month".
 *   - "plans": the full per-plan breakdown.
 * A TL;DR banner summarises the cheapest paid option + free-tier count.
 * ------------------------------------------------------------------ */

const DATA_URL = "./data/agents.json";
const SNAP_URL = "./data/agents.snapshot.json";

const VIEWS = {
  agents: {
    defaultSort: { key: "entryPrice", dir: "asc" },
    columns: [
      { key: "rank", label: "#", cls: "rank-col" },
      { key: "agentName", label: "Agent", sortable: true },
      { key: "hasFree", label: "Free tier", sortable: true, numeric: true },
      { key: "entryPrice", label: "Starts at $/mo", sortable: true, numeric: true, cls: "num" },
      { key: "planCount", label: "Plans", sortable: true, numeric: true, cls: "num" },
      { key: "source", label: "Source" },
    ],
  },
  plans: {
    defaultSort: { key: "agentName", dir: "asc" },
    columns: [
      { key: "agentName", label: "Agent", sortable: true },
      { key: "planName", label: "Plan", sortable: true },
      { key: "monthlyUSD", label: "Price $/mo", sortable: true, numeric: true, cls: "num" },
      { key: "limit", label: "Allowance" },
      { key: "reset", label: "Reset" },
      { key: "highlights", label: "Highlights" },
      { key: "verified", label: "Verified" },
      { key: "source", label: "Source" },
    ],
  },
};

const state = {
  rows: [],        // flattened plan rows
  agents: [],      // aggregated per-agent rows
  agentCount: 0,
  dataUpdated: null,
  lastChecked: null,
  view: "plans",
  sortKey: "monthlyUSD",
  sortDir: "asc",
  search: "",
  onlyPaid: false,
};

const els = {};
function cacheEls() {
  els.search = document.getElementById("search");
  els.onlyPaid = document.getElementById("onlyPaid");
  els.onlyPaidWrap = document.getElementById("onlyPaidWrap");
  els.viewToggle = document.getElementById("viewToggle");
  els.tldr = document.getElementById("tldr");
  els.status = document.getElementById("status");
  els.message = document.getElementById("message");
  els.thead = document.getElementById("tableHead");
  els.tbody = document.getElementById("tableBody");
  els.table = document.getElementById("agentsTable");
}

/* ----------------------------- Helpers ---------------------------- */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtBilling(row) {
  switch (row.billing) {
    case "user": return "Per user / mo";
    case "usage": return "Usage-based";
    case "flat": return "Flat / mo";
    default: return row.billing ? escapeHtml(row.billing) : "—";
  }
}

function fmtDate(s) {
  if (!s) return "n/a";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return escapeHtml(s);
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

// Renders a price cell: bar (width ∝ value/max) + amount.
function priceCell(value, max, nullLabel) {
  if (value === 0) return `<span class="price-amt" style="color:var(--free)">Free</span>`;
  if (value == null) return `<span class="price-amt">${escapeHtml(nullLabel || "—")}</span>`;
  const pct = Math.max(4, Math.min(100, Math.round((value / max) * 100)));
  return (
    `<span class="pricebar-wrap">` +
    `<span class="pricebar"><span style="width:${pct}%"></span></span>` +
    `<span class="price-amt">$${value}</span>` +
    `</span>`
  );
}

/* ----------------------------- Load ------------------------------- */
async function loadData() {
  showMessage("Loading agent pricing…");
  let data, snapshot = null;

  try {
    const res = await fetch(DATA_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    showError(err);
    return;
  }

  try {
    const snapRes = await fetch(SNAP_URL, { headers: { Accept: "application/json" } });
    if (snapRes.ok) snapshot = await snapRes.json();
  } catch (_) { /* snapshot optional */ }

  buildRows(data, snapshot);
  aggregate();
  hideMessage();
  setView(state.view, false);
  renderTLDR();
  render();
}

function buildRows(data, snapshot) {
  const rows = [];
  const agents = Array.isArray(data.agents) ? data.agents : [];
  for (const a of agents) {
    const sig = snapshot && snapshot.agents ? snapshot.agents[a.id] : null;
    const detected = sig && Array.isArray(sig.detectedPrices) ? sig.detectedPrices : null;
    for (const p of a.plans || []) {
      rows.push({
        agentId: a.id,
        agentName: a.name,
        company: a.company || "",
        category: a.category || "",
        sourceUrl: a.sourceUrl || "",
        lastVerified: a.lastVerified || null,
        verified: !!a.verified,
        planName: p.name,
        monthlyUSD: p.monthlyUSD === undefined ? null : p.monthlyUSD,
        billing: p.billing || "",
        priceLabel: p.priceLabel || null,
        limit: p.limit || "",
        reset: p.reset || "",
        limitsVerified: !!a.limitsVerified,
        highlights: p.highlights || "",
        detected,
      });
    }
  }
  state.rows = rows;
  state.agentCount = agents.length;
  state.dataUpdated = data.lastUpdated || null;
  state.lastChecked = snapshot && snapshot.lastChecked ? snapshot.lastChecked : null;
}

function aggregate() {
  const map = new Map();
  for (const r of state.rows) {
    if (!map.has(r.agentId)) {
      map.set(r.agentId, {
        agentId: r.agentId,
        agentName: r.agentName,
        company: r.company,
        category: r.category,
        sourceUrl: r.sourceUrl,
        verified: r.verified,
        lastVerified: r.lastVerified,
        detected: r.detected,
        plans: [],
      });
    }
    map.get(r.agentId).plans.push(r);
  }
  const agents = [];
  for (const a of map.values()) {
    const paid = a.plans
      .filter((p) => typeof p.monthlyUSD === "number" && p.monthlyUSD > 0)
      .map((p) => p.monthlyUSD);
    const entryPrice = paid.length ? Math.min(...paid) : null;
    const entryPlan = a.plans.find((p) => p.monthlyUSD === entryPrice);
    agents.push({
      ...a,
      entryPrice,
      entryPlanName: entryPlan ? entryPlan.planName : null,
      hasFree: a.plans.some((p) => p.monthlyUSD === 0),
      planCount: a.plans.length,
    });
  }
  state.agents = agents;
}

/* --------------------------- UI messages -------------------------- */
function showMessage(text) {
  els.message.className = "message";
  els.message.textContent = text;
  els.message.hidden = false;
  els.table.parentElement.style.display = "none";
}

function showError(err) {
  const fileProto = location.protocol === "file:";
  els.message.className = "message error";
  els.message.innerHTML = `<div>${
    fileProto
      ? "This page reads <code>data/agents.json</code>, which browsers block over <code>file://</code>. Serve the folder over HTTP — e.g. <code>python3 -m http.server 8000</code> — then open <code>http://localhost:8000/agents.html</code>."
      : `Could not load <code>data/agents.json</code> (${escapeHtml(String((err && err.message) || err))}).`
  }</div>`;
  els.message.hidden = false;
  els.table.parentElement.style.display = "none";
  els.status.textContent = "";
  if (els.tldr) els.tldr.hidden = true;
}

function hideMessage() {
  els.message.hidden = true;
  els.table.parentElement.style.display = "";
}

/* ------------------------------ TL;DR ----------------------------- */
function renderTLDR() {
  let cheapest = null;
  for (const r of state.rows) {
    if (typeof r.monthlyUSD === "number" && r.monthlyUSD > 0) {
      if (!cheapest || r.monthlyUSD < cheapest.monthlyUSD) cheapest = r;
    }
  }
  const freeCount = state.agents.filter((a) => a.hasFree).length;
  const total = state.agents.length;
  const bits = [];
  if (cheapest) {
    bits.push(
      `<div><span class="tldr-key">Cheapest paid</span><strong>${escapeHtml(cheapest.agentName)} · ${escapeHtml(cheapest.planName)}</strong> — $${cheapest.monthlyUSD}/user·mo</div>`
    );
  }
  bits.push(
    `<div><span class="tldr-key">Free tier</span><strong>${freeCount}</strong> of ${total} tools offer one</div>`
  );
  els.tldr.innerHTML = bits.join("");
  els.tldr.hidden = false;
}

/* --------------------------- Filtering ---------------------------- */
function getVisibleAgents() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.agents;
  return state.agents.filter((a) => {
    const planText = a.plans.map((p) => `${p.planName} ${p.highlights}`).join(" ");
    const hay = `${a.agentName} ${a.company} ${a.category} ${planText}`.toLowerCase();
    return hay.includes(q);
  });
}

function getVisiblePlans() {
  const q = state.search.trim().toLowerCase();
  return state.rows.filter((r) => {
    if (state.onlyPaid && r.monthlyUSD === 0) return false;
    if (q) {
      const hay = `${r.agentName} ${r.company} ${r.planName} ${r.highlights}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ----------------------------- Sorting ---------------------------- */
function compareBy(a, b, key, dir, numeric) {
  if (numeric) {
    let an = key === "hasFree" ? (a.hasFree ? 1 : 0) : a[key];
    let bn = key === "hasFree" ? (b.hasFree ? 1 : 0) : b[key];
    const aNull = an == null;
    const bNull = bn == null;
    if (aNull || bNull) {
      if (aNull && bNull) return 0;
      return aNull ? 1 : -1; // nulls/Custom always last
    }
    if (an !== bn) return (an - bn) * dir;
    return 0;
  }
  return String(a[key] || "").localeCompare(String(b[key] || "")) * dir;
}

function sortList(list) {
  const col = VIEWS[state.view].columns.find((c) => c.key === state.sortKey) || {};
  const dir = state.sortDir === "asc" ? 1 : -1;
  return list.slice().sort((a, b) => {
    const primary = compareBy(a, b, state.sortKey, dir, !!col.numeric);
    if (primary !== 0) return primary;
    // Secondary: keep each company together, cheapest plan first within it.
    const byCompany = String(a.agentName || "").localeCompare(String(b.agentName || ""));
    if (byCompany !== 0) return byCompany;
    const ap = typeof a.monthlyUSD === "number" ? a.monthlyUSD : Infinity;
    const bp = typeof b.monthlyUSD === "number" ? b.monthlyUSD : Infinity;
    if (ap !== bp) return ap - bp;
    return String(a.planName || "").localeCompare(String(b.planName || ""));
  });
}

/* ----------------------------- Render ----------------------------- */
function renderHeader() {
  const cols = VIEWS[state.view].columns;
  const ths = cols
    .map((c) => {
      const classes = [];
      if (c.sortable) classes.push("sortable");
      if (c.cls) classes.push(c.cls);
      const cls = classes.length ? ` class="${classes.join(" ")}"` : "";
      const dataKey = c.sortable ? ` data-key="${c.key}"` : "";
      let ariaSort = "";
      if (c.sortable && c.key === state.sortKey) {
        ariaSort = ` aria-sort="${state.sortDir === "asc" ? "ascending" : "descending"}"`;
      }
      return `<th scope="col"${cls}${dataKey}${ariaSort}>${c.label}</th>`;
    })
    .join("");
  els.thead.innerHTML = `<tr>${ths}</tr>`;
}

function render() {
  renderHeader();
  els.tbody.innerHTML = "";
  const frag = document.createDocumentFragment();

  if (state.view === "agents") {
    const list = sortList(getVisibleAgents());
    const maxEntry = Math.max(1, ...list.map((a) => a.entryPrice || 0));
    const cheapest = Math.min(
      Infinity,
      ...list.filter((a) => a.entryPrice != null).map((a) => a.entryPrice)
    );
    list.forEach((a, i) => {
      const tr = document.createElement("tr");
      const isCheapest = a.entryPrice != null && a.entryPrice === cheapest;
      if (isCheapest) tr.className = "is-cheapest";
      const freeBadge = a.hasFree
        ? '<span class="badge badge-yes">Yes</span>'
        : '<span class="badge badge-no">No</span>';
      const cheapestBadge = isCheapest ? ' <span class="badge badge-cheapest">Cheapest</span>' : "";
      const source = a.sourceUrl
        ? `<a class="src-link" href="${escapeHtml(a.sourceUrl)}" target="_blank" rel="noopener">Source ↗</a>`
        : "—";
      tr.innerHTML = `
        <td class="rank-col">${i + 1}</td>
        <td>
          <span class="agent-name">${escapeHtml(a.agentName)}</span>
          <span class="agent-cat">${escapeHtml(a.company)}${a.category ? " · " + escapeHtml(a.category) : ""}</span>
        </td>
        <td>${freeBadge}</td>
        <td class="num">${priceCell(a.entryPrice, maxEntry, "Custom")}${cheapestBadge}</td>
        <td class="num">${a.planCount}</td>
        <td>${source}</td>
      `;
      frag.appendChild(tr);
    });
    els.tbody.appendChild(frag);
    updateStatus(list.length, "agents");
  } else {
    const list = sortList(getVisiblePlans());
    const maxMonthly = Math.max(
      1,
      ...list.map((r) => (typeof r.monthlyUSD === "number" ? r.monthlyUSD : 0))
    );
    const grouped = state.sortKey === "agentName";
    const colCount = VIEWS.plans.columns.length;
    let currentGroup = null;
    for (const r of list) {
      if (grouped && r.agentName !== currentGroup) {
        currentGroup = r.agentName;
        const gh = document.createElement("tr");
        gh.className = "group-row";
        gh.innerHTML = `<td colspan="${colCount}">${escapeHtml(r.agentName)}<span class="group-sub">${escapeHtml(r.company)}</span></td>`;
        frag.appendChild(gh);
      }
      const tr = document.createElement("tr");
      const verifiedBadge = r.verified
        ? `<span class="badge badge-verified" title="Verified ${escapeHtml(fmtDate(r.lastVerified))}">Verified</span>`
        : `<span class="badge badge-unverified" title="Needs manual confirmation (last touched ${escapeHtml(fmtDate(r.lastVerified))})">Unverified</span>`;
      const detectedTitle = r.detected && r.detected.length
        ? ` title="Auto-detected price signals: ${r.detected.map((p) => "$" + p).join(", ")}"`
        : "";
      const source = r.sourceUrl
        ? `<a class="src-link" href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener"${detectedTitle}>Source ↗</a>`
        : "—";
      tr.innerHTML = `
        <td>
          <span class="agent-name">${escapeHtml(r.agentName)}</span>
          <span class="agent-cat">${escapeHtml(r.company)}</span>
        </td>
        <td>${escapeHtml(r.planName)}</td>
        <td class="num">${priceCell(r.monthlyUSD, maxMonthly, r.priceLabel || "Custom")}</td>
        <td>${escapeHtml(r.limit || "—")}${r.limitsVerified ? "" : ' <span class="est" title="Best-effort estimate — confirm at source">est.</span>'}</td>
        <td>${escapeHtml(r.reset || "—")}</td>
        <td>${escapeHtml(r.highlights)}</td>
        <td>${verifiedBadge}</td>
        <td>${source}</td>
      `;
      frag.appendChild(tr);
    }
    els.tbody.appendChild(frag);
    updateStatus(list.length, "plans");
  }
}

function updateStatus(shown, view) {
  const noun = view === "agents" ? `agent${shown === 1 ? "" : "s"}` : `plan${shown === 1 ? "" : "s"}`;
  const parts = [
    view === "agents"
      ? `${shown} ${noun}`
      : `${shown} ${noun} across ${state.agentCount} agents`,
    `data verified ${fmtDate(state.dataUpdated)}`,
    `auto-checked ${state.lastChecked ? fmtDate(state.lastChecked) : "not yet run"}`,
  ];
  els.status.textContent = parts.join(" · ");
}

/* ----------------------------- View ------------------------------- */
function setView(view, keepSort) {
  state.view = view;
  if (!keepSort) {
    const d = VIEWS[view].defaultSort;
    state.sortKey = d.key;
    state.sortDir = d.dir;
  }
  els.onlyPaidWrap.hidden = view !== "plans";
  els.viewToggle.querySelectorAll(".seg").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
}

/* ----------------------------- Events ----------------------------- */
function wireEvents() {
  let t;
  els.search.addEventListener("input", (e) => {
    clearTimeout(t);
    const v = e.target.value;
    t = setTimeout(() => { state.search = v; render(); }, 120);
  });

  els.onlyPaid.addEventListener("change", (e) => {
    state.onlyPaid = e.target.checked;
    render();
  });

  els.viewToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn || btn.dataset.view === state.view) return;
    setView(btn.dataset.view, false);
    render();
  });

  // Delegated sort handler (headers are re-rendered each draw).
  els.thead.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-key]");
    if (!th) return;
    const key = th.dataset.key;
    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = "asc";
    }
    render();
  });
}

/* ------------------------------ Init ------------------------------ */
function init() {
  cacheEls();
  wireEvents();
  loadData();
}

document.addEventListener("DOMContentLoaded", init);
