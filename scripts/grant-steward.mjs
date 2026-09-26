#!/usr/bin/env node
/*  Audio First Dictionary — who is THE steward
 *  --------------------------------------------------------------------
 *  The rules' isSteward() is true only for accounts listed in
 *  afd_admins/{uid}. That list is closed to every client (read AND write),
 *  so this Admin SDK script is the one way to change it. It controls:
 *    · opening/closing the recording + Arabic-suggestion windows (admin page)
 *    · publishing a spoken prompt while the recording window is closed
 *    · reading the Arabic-suggestion queue (admin page)
 *
 *  Look the account up by the email it signs in with — for the admin page
 *  that's the steward email + password account, NOT your Google account.
 *
 *  Run (from ~/afd):
 *    gcloud auth application-default login          # once, if not already
 *    node scripts/grant-steward.mjs --list
 *    node scripts/grant-steward.mjs steward@example.org
 *    node scripts/grant-steward.mjs --revoke steward@example.org
 *
 *  ORDER MATTERS on first deploy: grant BEFORE `firebase deploy --only
 *  firestore:rules`, or the admin page is locked out until you do.
 *
 *  Env:
 *    AFD_PROJECT_ID   (default afd-dev)
 */

const PROJECT_ID = process.env.AFD_PROJECT_ID || "afd-dev";
const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const list   = args.includes("--list");
const email  = args.find(a => !a.startsWith("--"));

if(!list && !email){
  console.error("usage: node scripts/grant-steward.mjs [--revoke] <email>   |   --list");
  process.exit(2);
}

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
const { getAuth } = await import("firebase-admin/auth");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();
const col = db.collection("afd_admins");

console.log(`grant-steward · project=${PROJECT_ID}`);

if(list){
  const snap = await col.get();
  if(snap.empty){ console.log("  (no stewards listed — the admin page is locked)"); }
  for(const d of snap.docs){
    let who = d.id;
    try{ const u = await auth.getUser(d.id); who = `${u.email || "(no email)"}  ${d.id}`; }
    catch(_){ who = `${d.id}  (no such account any more)`; }
    console.log("  •", who);
  }
  process.exit(0);
}

let user;
try{ user = await auth.getUserByEmail(email); }
catch(e){ console.error(`No account signs in as ${email} in ${PROJECT_ID}.`); process.exit(1); }

const isAnon = (user.providerData || []).length === 0 && !user.email;
if(isAnon){ console.error("That's an anonymous account — refusing."); process.exit(1); }

if(revoke){
  await col.doc(user.uid).delete();
  console.log(`  removed ${email} (${user.uid})`);
}else{
  await col.doc(user.uid).set({ email, grantedAt: FieldValue.serverTimestamp() });
  console.log(`  ${email} (${user.uid}) is now a steward`);
}
