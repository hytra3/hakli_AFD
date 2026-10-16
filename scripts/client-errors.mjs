#!/usr/bin/env node
/*  Audio First Dictionary — what went wrong on people's phones
 *  ----------------------------------------------------------------------
 *  Lists the field error log (afd_client_errors), written by afd-core's
 *  report() when a search, a share on Add, or an upload in the recorder fails,
 *  or a page hits an uncaught error. Each record is thin on purpose: page,
 *  build, where, the error code, a trimmed message, online or not, and the
 *  phone's OS family. No uid, no words — so it tells you WHAT is failing and
 *  how often, not who. Records delete themselves after 30 days (TTL, DEPLOY.md).
 *
 *  Grouped by where + code, most frequent first, then the latest few in full.
 *
 *  READ-ONLY unless --clear.
 *
 *  Run:
 *    gcloud auth application-default login
 *    node scripts/client-errors.mjs                 # last 7 days
 *    node scripts/client-errors.mjs --days 1
 *    node scripts/client-errors.mjs --days 0        # everything still kept
 *    node scripts/client-errors.mjs --where search  # only one place (prefix)
 *    node scripts/client-errors.mjs --latest 20     # show more in full
 *    node scripts/client-errors.mjs --clear         # WRITES: delete what's listed
 *
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt  = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; };

const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const DAYS   = Number(opt("--days", "7"));
const WHERE  = opt("--where", "");
const LATEST = Number(opt("--latest", "8"));
const CLEAR  = flag("--clear");

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

let q = db.collection("afd_client_errors");
if (DAYS > 0) q = q.where("at", ">=", Timestamp.fromMillis(Date.now() - DAYS * 864e5));
const snap = await q.get();

const rows = snap.docs
  .map(d => ({ id: d.id, ref: d.ref, ...d.data() }))
  .filter(r => !WHERE || String(r.where || "").startsWith(WHERE))
  .sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));

const span = DAYS > 0 ? `last ${DAYS} day${DAYS === 1 ? "" : "s"}` : "all kept";
if (!rows.length) { console.log(`No errors logged (${span}${WHERE ? ", where " + WHERE + "*" : ""}).`); process.exit(0); }

const when = (t) => t?.toDate ? t.toDate().toISOString().replace("T", " ").slice(0, 16) + "Z" : "?";
const groups = new Map();
for (const r of rows) {
  const k = `${r.where} · ${r.code}`;
  const g = groups.get(k) || { n: 0, offline: 0, pages: new Set(), builds: new Set(), os: new Map(), last: r.at };
  g.n++; if (r.online === false) g.offline++;
  g.pages.add(r.page); if (r.build) g.builds.add(r.build);
  g.os.set(r.os || "?", (g.os.get(r.os || "?") || 0) + 1);
  groups.set(k, g);
}

console.log(`${rows.length} error${rows.length === 1 ? "" : "s"} · ${span} · ${PROJECT_ID}\n`);
for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
  const os = [...g.os].map(([o, n]) => `${o} ${n}`).join(", ");
  console.log(`${String(g.n).padStart(4)}  ${k}`);
  console.log(`        ${[...g.pages].join(", ")} · ${os}${g.offline ? ` · ${g.offline} offline` : ""} · builds ${[...g.builds].join(", ") || "?"} · last ${when(g.last)}`);
}

console.log(`\nLatest ${Math.min(LATEST, rows.length)}:`);
for (const r of rows.slice(0, LATEST)) {
  console.log(`  ${when(r.at)}  ${r.page}  ${r.where}  [${r.code}]  ${r.os || "?"}${r.online === false ? " offline" : ""}  ${r.build || ""}`);
  if (r.msg && r.msg !== r.code) console.log(`      ${r.msg}`);
}

if (CLEAR) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const b = db.batch();
    rows.slice(i, i + 400).forEach(r => { b.delete(r.ref); n++; });
    await b.commit();
  }
  console.log(`\nCleared ${n}.`);
}
