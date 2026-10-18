#!/usr/bin/env node
/*  Audio First Dictionary — how the dictionary is being used
 *  ----------------------------------------------------------------------
 *  Reads the usage counts (afd_events, written by afd-core's track()) and the
 *  totals the watch function keeps (afd_stats). Counts only: no event holds a
 *  uid, a session or a word, so this says WHAT happened and how often, never who.
 *  The same numbers are on the steward page's Stats tab; this is for digging:
 *  every ev|v pair, by page or OS, over any span still kept (raw events: 90 days).
 *
 *  READ-ONLY unless --field.
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/stats.mjs                    # last 7 days
 *    node scripts/stats.mjs --days 1
 *    node scripts/stats.mjs --ev search        # one kind of event, split by page and OS
 *    node scripts/stats.mjs --daily            # the per-day totals the digest kept
 *    node scripts/stats.mjs --field 14         # WRITES: field week on for 14 days
 *    node scripts/stats.mjs --field off        # WRITES: field week off
 *
 *  Env:  AFD_PROJECT_ID (default afd-dev)
 */
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt  = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : d; };

const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const DAYS = Number(opt("--days", "7"));
const EV = opt("--ev", "");
const FIELD = opt("--field", "");

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const when = (t) => t?.toDate ? t.toDate().toISOString().replace("T", " ").slice(0, 16) + "Z" : "?";

if (FIELD) {
  const until = FIELD === "off" ? Date.now() : Date.now() + Number(FIELD) * 864e5;
  if (!(until > 0)) { console.error("--field takes a number of days, or off"); process.exit(1); }
  await db.collection("afd_ui_config").doc("watch").set({ openUntil: Timestamp.fromMillis(until) });
  console.log(FIELD === "off" ? "Field week off." : `Field week on until ${new Date(until).toISOString().slice(0, 10)}: an email if nothing is used for 24 hours.`);
  process.exit(0);
}

const pub = (await db.collection("afd_stats").doc("public").get()).data();
console.log(pub ? `Now: ${pub.words} words with a voice · ${pub.voices} voices · ${pub.speakers} speakers  (recounted ${when(pub.at)})`
                : "No totals yet — deploy the watch function (bash scripts/deploy-watch.sh).");

if (flag("--daily")) {
  const snap = await db.collection("afd_stats").get();
  const days = snap.docs.filter(d => d.id.startsWith("day_")).sort((a, b) => a.id < b.id ? -1 : 1);
  if (!days.length) { console.log("No daily totals yet (they start with the first morning digest)."); process.exit(0); }
  const sum = (c, pre, not) => Object.entries(c || {}).filter(([k]) => k.startsWith(pre) && k !== not).reduce((a, [, n]) => a + n, 0);
  console.log("\nday          visits searches  found plays  kept added errors  voices");
  for (const d of days) {
    const x = d.data(), c = x.counts || {};
    console.log(`${d.id.slice(4)}  ${String(sum(c, "view|")).padStart(6)} ${String(sum(c, "search|")).padStart(8)} ${String(c["search|here"] || 0).padStart(6)} ` +
      `${String(sum(c, "play|", "play|novoice")).padStart(5)} ${String(c["rec|keep"] || 0).padStart(5)} ${String(c["add|done"] || 0).padStart(5)} ` +
      `${String(x.errors || 0).padStart(6)} ${String(x.totals?.voices ?? "").padStart(7)}`);
  }
  process.exit(0);
}

let q = db.collection("afd_events");
if (DAYS > 0) q = q.where("at", ">=", Timestamp.fromMillis(Date.now() - DAYS * 864e5));
const rows = (await q.get()).docs.map(d => d.data()).filter(r => !EV || r.ev === EV);
const span = DAYS > 0 ? `last ${DAYS} day${DAYS === 1 ? "" : "s"}` : "all kept";
console.log(`\n${rows.length} event${rows.length === 1 ? "" : "s"}${EV ? " (" + EV + ")" : ""} · ${span} · ${PROJECT_ID}\n`);
if (!rows.length) process.exit(0);

const count = (key) => { const m = new Map(); rows.forEach(r => { const k = key(r); m.set(k, (m.get(k) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
for (const [k, n] of count(r => `${r.ev} ${r.v || ""}`.trim())) {
  const ms = rows.filter(r => `${r.ev} ${r.v || ""}`.trim() === k && Number.isInteger(r.n)).map(r => r.n).sort((a, b) => a - b);
  const med = ms.length ? ms[Math.floor(ms.length / 2)] : null;
  console.log(`${String(n).padStart(6)}  ${k}${med != null ? `   (n median ${med})` : ""}`);
}
if (EV) {
  console.log("\nby page:  " + count(r => r.page).map(([k, n]) => `${k} ${n}`).join(", "));
  console.log("by OS:    " + count(r => r.os || "?").map(([k, n]) => `${k} ${n}`).join(", "));
  console.log("by view:  " + count(r => r.mode || "unset").map(([k, n]) => `${k} ${n}`).join(", "));
  console.log("by x:     " + count(r => r.x || "-").map(([k, n]) => `${k} ${n}`).join(", "));
}
const off = rows.filter(r => r.online === false).length;
if (off) console.log(`\n${off} counted while offline (sent when signal came back).`);
