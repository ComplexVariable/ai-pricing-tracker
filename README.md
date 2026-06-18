# Cheapest AI Models — Live Pricing

A single-page, zero-dependency web app for developers that shows **which AI model is cheapest to use right now**, in a table sorted from cheapest to most expensive. Pricing is fetched **live on page load** from the [OpenRouter models API](https://openrouter.ai/docs/api/api-reference/models/get-models).

## Features

- **Real-time data** — fetches current per-token pricing every time the page loads (and on demand via **Refresh**).
- **Sorted cheapest → most expensive** by default, using a blended cost estimate.
- **Sort by any column** — click any header (Model, Company, Input, Output, Blended, Context) to re-sort; click again to reverse.
- **Adjustable cost basis** — compare by a blended rate (default **3:1** input:output), **1:1**, **input only**, or **output only**.
- **Quality + value** — a **Quality** column (Design Arena ELO from OpenRouter, where available) and a **Cheapest ↔ Best** slider that ranks models by a blended price/quality **Balance** score (cheapest ≠ best).
- **Filters** — free-text search, filter by company, "coding models only" (uses the API's `programming` category), and "hide free models".
- **No API key, no build step** — it's just static HTML/CSS/JS.
- **Subscription agents page** (`agents.html`) — a separate, curated comparison of plan pricing for AI coding *agents* (Warp, Cursor, GitHub Copilot, Codex CLI, Claude), with per-plan **Allowance** and **Reset** columns, since those bill per seat/month rather than per token.
- **Auto-monitored** — a weekly GitHub Action re-checks each vendor's pricing page and opens a pull request when prices change.

## Running it

It's a static site. Any of these work:

```bash
# Option 1 — just open the file
open index.html            # macOS

# Option 2 — serve locally (recommended; avoids any file:// quirks)
cd ai-pricing-tracker
python3 -m http.server 8000
# then visit http://localhost:8000
```

No installation or dependencies are required. The browser fetches data directly from
`https://openrouter.ai/api/v1/models`, which sends `Access-Control-Allow-Origin: *`, so
cross-origin requests work from a plain static page.

> Note: the **`agents.html`** page reads a local `data/agents.json` file, which browsers block
> over `file://`. Open it via the local server (`http://localhost:8000/agents.html`), not by
> double-clicking the file. The main `index.html` works either way.

## How pricing is calculated

The API returns prices in **USD per token** as strings. The app converts these to the more
readable **USD per 1,000,000 tokens**:

```
input  $/1M = pricing.prompt      × 1,000,000
output $/1M = pricing.completion  × 1,000,000
```

The **Blended** column is an *estimated* effective rate assuming a mix of input and output
tokens. With the default **3:1** weighting:

```
blended $/1M = (3 × input + 1 × output) / 4
```

You can change the weighting with the **“Sort cost basis”** selector. The default table sort
is Blended, ascending (cheapest first). Free models (price `0`) are shown with a **Free** badge
and naturally sort to the top; use **“Hide free models”** to exclude them.

## Scope & caveats

- **Per-token model pricing only.** This compares models that bill per token (OpenAI, Anthropic/Claude, Google, xAI, Meta, Mistral, DeepSeek, Qwen, and many more surfaced by OpenRouter).
- **Subscription coding agents are on a separate page.** Products like **Warp**, **GitHub Copilot**, **Cursor**, and the **Codex CLI** are billed by subscription/plan rather than per token, so they aren't directly comparable on a $/token basis. They live on [`agents.html`](agents.html) instead (curated + auto-monitored).
- **Pricing is OpenRouter's view** of each model's lowest available price and can differ slightly from a provider's first-party pricing. Always confirm with the provider before relying on it.
- Meta/router pseudo-models that report a negative (`-1`, variable) price are filtered out.

## Subscription agents page

`agents.html` shows pricing for AI coding *agents*. It defaults to an **All plans** comparison
**grouped by company** (each company's plans listed cheapest-first; click the **Price** header for a
global cheapest-first sort) — every plan with its price, an **Allowance** column (each vendor's own
usage unit) and a **Reset** column (allowance window) — plus a **TL;DR banner**. Toggle to the **By
agent** summary for a one-row-per-tool view (Free badge + **“Starts at $X/mo”** entry price + price
bar, cheapest-first
with a **Cheapest** highlight). Because there is **no public real-time pricing API** for these
products, the data is **curated** in `data/agents.json` and treated as the source of truth. Each
row shows a **Verified** / **Unverified** price badge; **Allowance** figures are best-effort
estimates (tagged `est.`) in each vendor's own unit (requests / messages / credits / ×multipliers),
**not tokens**, and **not comparable across vendors**.

To add or edit an agent, edit `data/agents.json`:

```jsonc
{
  "id": "warp",
  "name": "Warp",
  "company": "Warp",
  "category": "Agentic terminal / dev environment",
  "sourceUrl": "https://www.warp.dev/pricing",
  "lastVerified": "2026-06-16",
  "verified": true,
  "limitsVerified": false,
  "plans": [
    { "name": "Pro", "monthlyUSD": 20, "billing": "user",
      "limit": "300 premium req/mo", "reset": "Monthly", "highlights": "…" }
    // monthlyUSD: number, 0 (Free), or null with "priceLabel": "Custom"/"Usage-based"
    // limit/reset: free-text native units; shown as "est." until limitsVerified: true
  ]
}
```

## Automated maintenance

Full hands-off, real-time scraping isn't reliable (vendor pages are JS-heavy and noisy), so
the automation is a **change monitor**, not a silent price overwriter:

- `npm run update-agents` (or `node scripts/update-agents.mjs`) fetches each `sourceUrl`
  server-side, extracts plausible `$N` price signals, and writes
  `data/agents.snapshot.json` (detected prices + a content hash + timestamp).
- `.github/workflows/update-agents.yml` runs that script **weekly** (and on demand). When the
  detected signals change, the snapshot changes, and the workflow opens a **pull request**
  (via `peter-evans/create-pull-request`) titled *“Agent pricing changed — please verify”*.
  You then confirm the real numbers and update `data/agents.json`.

This keeps detection automatic while a human stays in the loop for the actual prices. The
workflow needs Actions enabled with `contents: write` + `pull-requests: write` (already set in
the workflow file).

## Files

- `index.html` / `app.js` — live per-token model table (OpenRouter)
- `agents.html` / `agents.js` — curated subscription-agent table
- `styles.css` — shared dark, developer-oriented theme
- `data/agents.json` — authoritative agent pricing (edit this)
- `data/agents.snapshot.json` — auto-written price signals from the monitor
- `scripts/update-agents.mjs` — weekly pricing monitor
- `.github/workflows/update-agents.yml` — scheduled job that opens a PR on changes
- `package.json` — `update-agents` and `serve` scripts
- `README.md` — this file

## Data sources

- Models: OpenRouter — `GET https://openrouter.ai/api/v1/models` (optionally `?category=programming`). See the [API reference](https://openrouter.ai/docs/api/api-reference/models/get-models).
- Agents: each vendor's own pricing page (see `sourceUrl` in `data/agents.json`).
