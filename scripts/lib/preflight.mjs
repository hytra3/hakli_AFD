/*  Before an admin script touches Firestore: can this computer reach Google,
 *  and is it signed in? Answers in seconds with what to do, instead of a long
 *  wait that ends in DEADLINE_EXCEEDED or ETIMEDOUT halfway through a run.
 *
 *    import { preflightOrExit } from "./lib/preflight.mjs";
 *    initializeApp({ ... });
 *    await preflightOrExit();
 */
import https from "node:https";

const HOST = "firestore.googleapis.com";

// Any HTTP answer at all (a 404 is normal) means the network path works.
function probeHttps(timeoutMs){
  return new Promise((resolve, reject) => {
    const req = https.get({ host: HOST, path: "/", timeout: timeoutMs }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("timeout", () => { req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })); });
    req.on("error", reject);
  });
}

async function adcToken(){
  const { applicationDefault } = await import("firebase-admin/app");
  const t = await applicationDefault().getAccessToken();
  if(!t || !t.access_token) throw new Error("no access token");
  return t;
}

const within = (p, ms, code) => Promise.race([p,
  new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timed out"), { code })), ms))]);

/** Resolves when Google answers and the sign-in gives a token; otherwise
 *  rejects with an Error whose message says what's wrong and what to run. */
export async function checkGoogle({ probe = probeHttps, token = adcToken, timeoutMs = 10000 } = {}){
  if(process.env.FIRESTORE_EMULATOR_HOST) return;          // talking to the local emulator, not Google
  try{ await within(probe(timeoutMs), timeoutMs + 500, "ETIMEDOUT"); }
  catch(e){
    const ipv4 = (process.env.NODE_OPTIONS || "").includes("ipv4first");
    throw new Error([
      `Can't reach Google (${HOST}): ${e.code || e.message}.`,
      "  Check the internet connection, then try again.",
      ipv4 ? "" : "  If the connection is fine, this network's IPv6 may be broken. Run:\n" +
                  "    export NODE_OPTIONS=--dns-result-order=ipv4first\n" +
                  "  (add that line to ~/.bashrc so it sticks), then try again.",
    ].filter(Boolean).join("\n"));
  }
  try{ await within(token(), timeoutMs, "ETIMEDOUT"); }
  catch(e){
    throw new Error([
      `Google is reachable, but this computer isn't signed in for the scripts (${e.code || e.message}).`,
      "  Run:  gcloud auth application-default login",
      "  then try again.",
    ].join("\n"));
  }
}

export async function preflightOrExit(opts){
  try{ await checkGoogle(opts); }
  catch(e){ console.error("\n" + e.message + "\n"); process.exit(1); }
}
