# AGENTS.md

Context and working instructions for AI agents (and humans) continuing this project in a fresh
session. Read this first, then skim `README.md` (user-facing) and the files in the map below.

## What this project is
A **zero-dependency static web app** that helps developers compare AI pricing. Two pages:

1. **Per-token model pricing** (`index.html` + `app.js`) — fetches **live** model prices from the
   public OpenRouter API on page load and shows a sortable table, cheapest → most expensive.
2. **Subscription agent pricing** (`agents.html` + `agents.js`) — a **curated** comparison of
   plan pricing for AI coding *agents* (Warp, Cursor, GitHub Copilot, Codex CLI, Claude), which
   bill per seat/month rather than per token.

There is **no backend** and **no build step**. Plain HTML/CSS/JS in the browser; Node is only used
by the offline pricing monitor and CI.

## Quick start (for a new session)
```bash
# Serve locally (agents.html reads local JSON, so it MUST be served over http, not file://)
npm run serve                 # python3 -m http.server 8000
# open http://localhost:8000  and  http://localhost:8000/agents.html

# Validate after edits
node --check app.js
node --check agents.js
node --check scripts/update-agents.mjs
node -e "JSON.parse(require('fs').readFileSync('data/agents.json','utf8')); console.log('agents.json OK')"

# Run the subscription-pricing monitor (writes data/agents.snapshot.json)
npm run update-agents
```
There is no test framework or linter configured. "Verification" = `node --check` on the JS, JSON
parse of the data file, and a manual smoke test in the browser.

## File map
- `index.html` / `app.js` — live per-token model table (data from OpenRouter).
- `agents.html` / `agents.js` — curated subscription-agent table.
- `styles.css` — shared dark theme (CSS variables at `:root`).
- `data/agents.json` — **authoritative** curated agent pricing (edit this for agent data).
- `data/agents.snapshot.json` — auto-written by the monitor (detected price signals; do not hand-edit).
- `scripts/update-agents.mjs` — weekly pricing monitor (ESM, Node ≥18).
- `.github/workflows/update-agents.yml` — weekly cron that runs the monitor and opens a PR on changes.
- `package.json` — `type: module`; scripts `update-agents`, `serve`.
- `README.md` — user-facing docs. `AGENTS.md` — this file.

## Data sources
- **Models:** `GET https://openrouter.ai/api/v1/models` (optionally `?category=programming`).
  No API key needed; the endpoint sends `Access-Control-Allow-Origin: *`, so the browser can call
  it directly. Prices are USD **per token** (strings); the UI shows USD per 1M (×1,000,000).
- **Agents:** each vendor's own pricing page (see `sourceUrl` in `data/agents.json`). There is **no**
  real-time pricing API for these, so the values are curated.

## Key design decisions (don't undo these without reason)
- **Two separate concepts.** Per-token models and per-seat subscriptions are NOT comparable on a
  single axis, so they live on separate pages. Keep them separate.
- **`index.html` default sort** = "Blended" `$/1M`, ascending. Blended is a weighted estimate:
  `(wIn*input + wOut*output)/(wIn+wOut)`, default ratio **3:1** input:output; user-selectable
  (3:1, 1:1, input-only, output-only). Models with negative price (`-1` routers) are filtered out.
- **`agents.html` default view** = **All plans** (one row per plan) with columns
  `Agent | Plan | Price $/mo | Allowance | Reset | Highlights | Verified | Source`. A toggle
  switches to a **By agent** summary (one row per tool: Free badge + "Starts at $X/mo" entry price
  + price bar + Cheapest highlight). A TL;DR banner shows the cheapest paid plan + free-tier count.
- **Allowance is each vendor's OWN unit** (premium requests / AI requests / messages / usage
  credits / ×multipliers) — **NOT tokens**, and **not comparable across vendors**. Never invent a
  "tokens per plan" number; the data does not exist in that form.
- **Honesty over completeness.** Do not fabricate prices. Unconfirmed values use `verified: false`
  (price badge shows "Unverified") and/or `limitsVerified: false` (allowance shows an `est.` tag).
- **The weekly monitor flags changes; it never overwrites prices.** It records detected `$` signals
  + a content hash and, via the Action, opens a PR for a human to confirm and update `agents.json`.

## Coding conventions
- Vanilla JS, no frameworks, no dependencies, no bundler. Keep it that way unless explicitly asked.
- **All dynamic text must go through `escapeHtml()`** before being injected via `innerHTML`.
- **Use relative asset paths** (`styles.css`, `app.js`, `./data/agents.json`, `agents.html`). No
  leading-slash absolute paths — the site is served under a subpath on GitHub Pages
  (`/ai-pricing-tracker/`) and absolute paths would break.
- Sortable tables follow one pattern: a per-view `columns` config, a delegated click handler on
  `<thead>`, `aria-sort` on the active header, numeric-vs-text comparison, and **null/Custom values
  always sort last**.
- UI prefs on the model page persist in `localStorage` (key `ai-pricing-prefs-v1`).
- Match the existing dark theme via the CSS variables in `:root` (don't hardcode new colors).

## `data/agents.json` shape
```jsonc
{
  "id": "warp", "name": "Warp", "company": "Warp",
  "category": "…", "sourceUrl": "https://…/pricing",
  "lastVerified": "YYYY-MM-DD",
  "verified": false,        // price confirmed by a human?
  "limitsVerified": false,  // allowance/reset confirmed? (false => shows "est.")
  "plans": [
    { "name": "Pro", "monthlyUSD": 20, "billing": "user",
      "limit": "300 premium req/mo", "reset": "Monthly", "highlights": "…" }
    // monthlyUSD: number | 0 (Free) | null with "priceLabel": "Custom"/"Usage-based"
    // billing: "user" | "usage" | "flat"
  ]
}
```

## Current status (as of 2026-06-16)
- 5 agents, 22 plans. **Price verified:** Cursor, GitHub Copilot. **Price unverified:** Warp,
  Codex CLI, Claude. **All allowances are `limitsVerified: false`** (shown as `est.`).
- The monitor fetches Warp / Cursor / Copilot / Claude fine; **`openai.com` (Codex CLI) returns 403**
  to a plain fetch — handled gracefully as "failed, retry next run". Leave curated-only or point it
  at a fetchable source.
- **Not yet deployed**, and **not yet a git repo** on this machine.

## Suggested next steps
1. Verify the unconfirmed prices (Warp, Codex CLI, Claude) and flip `verified: true`.
2. Verify allowances you can pin from docs (Copilot premium-request quotas; Warp AI-request counts)
   and flip `limitsVerified: true`.
3. Deploy (see below).
4. Optional: more agents (Windsurf, Replit, Gemini Code Assist…), CSV export, a price-history chart,
   or a monthly/annual price toggle.

## Deployment (GitHub Pages, $0)
Static site → free on GitHub Pages with a **public** repo (Pages on private repos needs a paid plan).
```bash
touch .nojekyll                       # already added
git init -b main
git add . && git commit -m "Initial commit: AI pricing tracker"
gh repo create ai-pricing-tracker --public --source=. --remote=origin --push
gh api -X POST repos/{owner}/{repo}/pages -f "source[branch]=main" -f "source[path]=/" \
  || echo "Else enable via Settings -> Pages -> Deploy from a branch -> main -> / (root)"
```
Then for the weekly updater: **Settings → Actions → General → Workflow permissions** → **Read and
write** + check **Allow GitHub Actions to create and approve pull requests**. Site URL:
`https://<user>.github.io/ai-pricing-tracker/`. Every push to `main` redeploys.

## Gotchas
- `agents.html` must be served over **HTTP** (it `fetch`es local JSON; `file://` is blocked). The
  page shows a helpful message if opened via `file://`.
- The Warp marketing page returns a noisy/rotating set of `$` figures, so the monitor may flag it as
  "changed" often — expected; the PR is the review gate.
- Keep paths relative (GitHub Pages subpath, see conventions).
