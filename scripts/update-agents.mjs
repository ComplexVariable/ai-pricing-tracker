#!/usr/bin/env node
/**
 * Agent pricing monitor.
 *
 * For each agent in data/agents.json this script fetches the vendor's pricing
 * page (server-side — no CORS limits), extracts plausible "$N" price signals,
 * hashes the sorted set, and compares it to the previous run stored in
 * data/agents.snapshot.json.
 *
 * It deliberately does NOT overwrite the authoritative prices in agents.json —
 * vendor pages are noisy and JS-heavy, so auto-scraped numbers can be wrong.
 * Instead it records what it saw and flags which vendors *changed* so a human
 * (or the weekly GitHub Action via a pull request) can confirm and update
 * agents.json. Exit code is 0 normally, and 0 with a report when changes are
 * found (CI decides what to do with the snapshot diff).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA_FILE = join(ROOT, "data", "agents.json");
const SNAP_FILE = join(ROOT, "data", "agents.snapshot.json");

const USER_AGENT =
  "Mozilla/5.0 (compatible; ai-pricing-tracker/1.0; pricing-monitor)";
const TIMEOUT_MS = 25_000;
// Matches "$20", "$19.99", "$ 200" — bounded to plausible subscription amounts.
const PRICE_RE = /\$\s?(\d{1,4}(?:\.\d{2})?)/g;

function shortHash(str) {
  return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

async function fetchSource(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json" },
      redirect: "follow",
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, text };
  } catch (err) {
    return { status: 0, text: "", error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

function extractPriceSignals(html) {
  const found = [];
  let m;
  while ((m = PRICE_RE.exec(html)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 1000) found.push(n);
  }
  return Array.from(new Set(found)).sort((a, b) => a - b);
}

async function main() {
  if (!existsSync(DATA_FILE)) {
    console.error(`Missing ${DATA_FILE}`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const prev = existsSync(SNAP_FILE)
    ? JSON.parse(readFileSync(SNAP_FILE, "utf8"))
    : { agents: {} };

  const now = new Date().toISOString();
  const out = { lastChecked: now, agents: {} };
  const changed = [];
  const failed = [];

  for (const agent of data.agents) {
    if (!agent.sourceUrl) continue;
    const { status, text, error } = await fetchSource(agent.sourceUrl);
    const prices = status === 200 ? extractPriceSignals(text) : [];
    const contentHash = status === 200 ? shortHash(prices.join(",")) : "";
    const before = prev.agents ? prev.agents[agent.id] : undefined;
    const didChange = before ? before.contentHash !== contentHash : true;

    if (status !== 200) {
      failed.push(agent.id);
      console.log(`!  ${agent.id.padEnd(12)} fetch failed (status=${status}${error ? ", " + error : ""})`);
    } else {
      const mark = didChange ? "~" : "=";
      console.log(
        `${mark}  ${agent.id.padEnd(12)} ${prices.length} signals ${didChange ? "(CHANGED)" : "(no change)"}  [${prices.map((p) => "$" + p).join(", ")}]`
      );
      if (didChange && before) changed.push(agent.id);
    }

    out.agents[agent.id] = {
      sourceUrl: agent.sourceUrl,
      status,
      detectedPrices: prices,
      contentHash,
      lastChecked: now,
      error: error || null,
    };
  }

  writeFileSync(SNAP_FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${SNAP_FILE}`);

  if (changed.length) {
    console.log(`\n⚠️  Pricing signals CHANGED for: ${changed.join(", ")}`);
    console.log("   → Review each source page and update data/agents.json (bump lastVerified).");
  } else {
    console.log("\nNo pricing-signal changes detected since last run.");
  }
  if (failed.length) {
    console.log(`\nCould not fetch: ${failed.join(", ")} (will retry next run).`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
