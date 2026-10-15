#!/usr/bin/env node
/*  Audio First Dictionary — qualified dialect readers
 *  --------------------------------------------------------------------
 *  Speaker origin visibility, tier 2 (ROADMAP): an account with the
 *  `dialectReader` custom claim may READ every speaker's private details —
 *  town, tribe, age band, gender — for variety analysis. It can never write
 *  them, and the claim means nothing on an anonymous sign-in. Stewards keep
 *  their own speakers' details either way; this is for people doing dialect
 *  work across speakers.
 *
 *  The claim lives on the account's sign-in token, so the rules check it with
 *  no extra read. It takes effect at the reader's next sign-in (or within the
 *  hour, when the token refreshes). Revoking works the same way.
 *
 *  Run (from ~/afd):
 *    gcloud auth application-default login          # once, if not already
 *    node scripts/grant-reader.mjs --list
 *    node scripts/grant-reader.mjs reader@example.org
 *    node scripts/grant-reader.mjs --revoke reader@example.org
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
  console.error("usage: node scripts/grant-reader.mjs [--revoke] <email>   |   --list");
  process.exit(2);
}

const { initializeApp, applicationDefault } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
await (await import("./lib/preflight.mjs")).preflightOrExit();   // fail fast, with what to do, if Google is unreachable or not signed in
const auth = getAuth();
console.log(`grant-reader · project=${PROJECT_ID}`);

if(list){
  let n = 0, page;
  do{
    const res = await auth.listUsers(1000, page);
    for(const u of res.users){
      if(u.customClaims && u.customClaims.dialectReader){ n++; console.log("  •", u.email || u.phoneNumber || "(no email)", u.uid); }
    }
    page = res.pageToken;
  }while(page);
  if(!n) console.log("  (no dialect readers)");
  process.exit(0);
}

let user;
try{ user = await auth.getUserByEmail(email); }
catch(e){ console.error(`No account signs in as ${email} in ${PROJECT_ID}.`); process.exit(1); }
if((user.providerData || []).length === 0 && !user.email){ console.error("That's an anonymous account — refusing."); process.exit(1); }

// keep any other claims the account has
const claims = { ...(user.customClaims || {}) };
if(revoke) delete claims.dialectReader; else claims.dialectReader = true;
await auth.setCustomUserClaims(user.uid, Object.keys(claims).length ? claims : null);
console.log(revoke ? `  ${email} (${user.uid}) is no longer a dialect reader`
                   : `  ${email} (${user.uid}) is now a dialect reader — from their next sign-in`);
