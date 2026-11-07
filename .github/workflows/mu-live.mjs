// 由 GitHub Actions 執行：讀取 mu-live.json，依狀態把 MU 股價推到 PushWard（靈動島）
import { readFileSync } from "node:fs";

const SLUG = "mu-live";
const API = "https://api.pushward.app";
const UP_IS_RED = true; // 漲紅跌綠（台灣習慣）
const ACTION = process.env.ACTION || "tick";
const MAX_HOURS = +process.env.MAX_HOURS || 8;

async function pw(method, path, body, merge) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + process.env.PUSHWARD_TOKEN,
      "Content-Type": merge ? "application/merge-patch+json" : "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function quote() {
  try {
    const r = await fetch("https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=" + (process.env.BINANCE_SYMBOL || "MUUSDT"));
    if (r.ok) {
      const j = await r.json();
      if (j.lastPrice) return { price: +j.lastPrice, pct: +j.priceChangePercent, src: "Binance" };
    }
  } catch {}
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + (process.env.YAHOO_SYMBOL || "MU") + "?interval=1m&range=1d", {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const m = (await r.json()).chart.result[0].meta;
    const prev = m.chartPreviousClose || m.previousClose;
    return { price: m.regularMarketPrice, pct: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : 0, src: "Yahoo" };
  } catch {}
  return null;
}

function content(q) {
  const up = q.pct >= 0;
  return {
    template: "timeline",
    value: { MU: +q.price.toFixed(2) },
    unit: "$",
    state: (up ? "▲ " : "▼ ") + Math.abs(q.pct).toFixed(2) + "%",
    icon: up ? "chart.line.uptrend.xyaxis" : "chart.line.downtrend.xyaxis",
    accent_color: up === UP_IS_RED ? "red" : "green",
  };
}

let state = { active: false };
try { state = JSON.parse(readFileSync("mu-live.json", "utf8")); } catch {}

if (ACTION === "stop") {
  const q = await quote();
  const c = q ? content(q) : { template: "generic", progress: 1, state: "已停止", icon: "stop.circle.fill", accent_color: "blue" };
  await pw("PATCH", "/activities/" + SLUG, { state: "ended", content: c }, true);
  console.log("ended");
} else if (!state.active) {
  console.log("inactive, skip");
} else if (ACTION === "start") {
  await pw("POST", "/activities", { slug: SLUG, name: "MU 股價", priority: 5, stale_ttl: 3600, dismissal_ttl: 0 });
  const q = await quote();
  if (!q) throw new Error("抓不到報價");
  await pw("PATCH", "/activities/" + SLUG, { state: "ongoing", content: content(q) }, true);
  console.log("started", q);
} else {
  // tick：超過 MAX_HOURS 就不再更新，PushWard 會在 stale_ttl 後自動結束
  if (state.since && Date.now() - state.since > MAX_HOURS * 3600e3) { console.log("expired, skip"); process.exit(0); }
  const q = await quote();
  if (!q) { console.log("no quote"); process.exit(0); }
  await pw("PATCH", "/activities/" + SLUG, { state: "ongoing", content: content(q) }, true);
  console.log("updated", q);
}
