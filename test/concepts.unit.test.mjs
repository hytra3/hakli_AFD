/**
 * Concept links — the data files and the review logic (no emulator needed)
 * RUN:  node --test test/concepts.unit.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isConceptId, parseAnswer, planWrites, describe as say } from "../scripts/lib/concepts.mjs";

const read = (f) => JSON.parse(readFileSync(new URL("../" + f, import.meta.url), "utf8"));
const { concepts: index, lists, source } = read("data/concepticon.json");
const data = read("data/concepts.json");
const words = readFileSync(new URL("../afd-words.js", import.meta.url), "utf8");

describe("data files", () => {
  it("the Concepticon copy names its source, version and licence", () => {
    assert.ok(source.commit && source.license === "CC-BY-4.0" && source.url);
    assert.ok(Object.keys(index).length > 4000);
  });
  it("every seeded word has a link entry", () => {
    const ids = [...words.matchAll(/\{id:"([^"]+)"/g)].map(m => "ent_" + m[1].toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    assert.deepEqual(ids.filter(id => !(id in data.links)), []);
  });
  it("every proposed or confirmed id is well formed and known", () => {
    for(const [eid, l] of Object.entries(data.links)){
      for(const id of [...(l.propose || []), ...(l.concepts || [])]){
        assert.ok(isConceptId(id), `${eid}: ${id}`);
        const m = /^concepticon:(\d+)$/.exec(id);
        if(m) assert.ok(index[m[1]], `${eid}: ${id} not in Concepticon`);
        else assert.ok(data.local[id], `${eid}: local ${id} not described`);
      }
    }
  });
  it("the core word lists are there for the coverage view", () => {
    for(const k of ["Swadesh-1955-100", "Swadesh-1952-200", "Tadmor-2009-100"])
      assert.ok(lists[k] && lists[k].concepts.length >= 99, k);
  });
});

describe("review answers", () => {
  const prop = ["concepticon:1262"];
  it("y confirms, n means no concept, Enter or s skips", () => {
    assert.deepEqual(parseAnswer("y", prop, index), { action: "confirm", concepts: prop });
    assert.deepEqual(parseAnswer("n", prop, index), { action: "none", concepts: [] });
    assert.equal(parseAnswer("", prop, index).action, "skip");
    assert.equal(parseAnswer("s", prop, index).action, "skip");
  });
  it("numbers replace the proposal, several at once, local ids mixed in", () => {
    assert.deepEqual(parseAnswer("559 560", prop, index).concepts, ["concepticon:559", "concepticon:560"]);
    assert.deepEqual(parseAnswer("1252, local:hakli/barber", prop, index).concepts, ["concepticon:1252", "local:hakli/barber"]);
  });
  it("a number Concepticon doesn't have, or a malformed id, is refused", () => {
    assert.ok(parseAnswer("99999999", prop, index).error);
    assert.ok(parseAnswer("barber", prop, index).error);
  });
  it("describe reads well", () => {
    assert.equal(say("concepticon:1343", index, {}), "1343 SUN — The physical world");
  });
});

describe("what gets written", () => {
  const links = {
    ent_a: { status: "confirmed", concepts: ["concepticon:1343"] },
    ent_b: { status: "confirmed", concepts: ["concepticon:1313"] },
    ent_c: { status: "proposed", propose: ["concepticon:639"] },
    ent_d: { status: "none" },
    ent_e: { status: "confirmed", concepts: ["concepticon:671"] },
  };
  it("only decided links, only where the card differs, only cards that exist", () => {
    const w = planWrites(links, { ent_a: [], ent_b: ["concepticon:1313"], ent_c: [], ent_d: ["concepticon:1"] });
    assert.deepEqual(w, [{ entryId: "ent_a", concepts: ["concepticon:1343"] }, { entryId: "ent_d", concepts: [] }]);
  });
});
