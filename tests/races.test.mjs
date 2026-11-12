// The numbers the page shows come from these formulas and generators. If a formula changes,
// a caption or close-up note can quietly start lying, so pin the important ones here.
import test from "node:test";
import assert from "node:assert/strict";
import { RACES, raceById, defaultState, paramsFor, standings, sortCost, compact } from "../races.js";
import { closeupFor, J_CUST, J_TX, W_ROWS } from "../closeup.js";

const at = (id, overrides = {}) => {
  const race = raceById(id);
  const state = { ...defaultState(race), ...overrides };
  return { race, p: paramsFor(race, state) };
};
const steps = (lanes) => Object.fromEntries(lanes.map((l) => [l.id, Math.round(l.steps)]));

test("join methods at the default size match the plan", () => {
  const { race, p } = at("joins");
  assert.deepEqual(steps(race.lanes(p)), { nested: 5_000_000, hash: 6000, merge: 77_404 });
  assert.equal(standings(race.lanes(p))[0].id, "hash");
});

test("doubling both tables: nested 4×, hash exactly 2×, sort-merge a little over 2× (caption claim)", () => {
  const { race } = at("joins");
  const values = race.controls[0].values;
  const one = steps(race.lanes(paramsFor(race, { scale: values.indexOf(1) })));
  const two = steps(race.lanes(paramsFor(race, { scale: values.indexOf(2) })));
  assert.equal(two.nested / one.nested, 4);
  assert.equal(two.hash / one.hash, 2);
  assert.ok(two.merge / one.merge > 2 && two.merge / one.merge < 2.3);
});

test("broadcast vs shuffle defaults: 4 workers, skew on", () => {
  const { race, p } = at("broadcast");
  const [shuffle, bcast] = race.lanes(p);
  assert.equal(Math.round(shuffle.net), 750_750);
  assert.equal(Math.round(Math.max(...shuffle.loads)), 550_250);
  assert.equal(bcast.net, 3000);
  assert.deepEqual(bcast.loads, [251_000, 251_000, 251_000, 251_000]);
  assert.equal(standings(race.lanes(p))[0].id, "broadcast");
});

test("skew changes the shuffle's busiest worker but not the broadcast's", () => {
  const { race } = at("broadcast");
  const on = race.lanes(paramsFor(race, { cust: 0, skew: true }));
  const off = race.lanes(paramsFor(race, { cust: 0, skew: false }));
  assert.ok(Math.max(...on[0].loads) > Math.max(...off[0].loads) * 2);
  assert.deepEqual(on[1].loads, off[1].loads);
  // Every transaction is still on some worker.
  for (const lanes of [on, off]) {
    assert.equal(Math.round(lanes[0].loads.reduce((a, b) => a + b)), 1_001_000);
  }
});

test("the crossover in the broadcast caption: 250k customers without skew, 350k with it", () => {
  const { race } = at("broadcast");
  const x = (skew) => Math.round(race.crossover({ cust: 1000, skew }));
  assert.equal(x(false), 250_000);
  assert.equal(x(true), 350_000);
  // And the slider agrees on either side of it.
  const vals = race.controls[0].values;
  const winner = (n, skew) => standings(race.lanes(paramsFor(race, { cust: vals.indexOf(n), skew })))[0].id;
  assert.equal(winner(100_000, false), "broadcast");
  assert.equal(winner(500_000, false), "shuffle");
  assert.equal(winner(250_000, true), "broadcast");
  assert.equal(winner(500_000, true), "shuffle");
});

test("window vs self-join: window wins at the default, self-join wins with few rows per customer", () => {
  const { race, p } = at("window");
  assert.equal(p.k, 50);
  assert.deepEqual(steps(race.lanes(p)), { self: 250_000, win: Math.round(sortCost(5000) + 5000) });
  assert.equal(standings(race.lanes(p))[0].id, "win");
  const vals = race.controls[0].values;
  assert.equal(standings(race.lanes(paramsFor(race, { k: vals.indexOf(5) })))[0].id, "self");
});

test("every caption and question reads cleanly at every control setting", () => {
  for (const race of RACES) {
    const range = race.controls.find((c) => c.type === "range");
    const checks = race.controls.filter((c) => c.type === "check");
    const combos = checks.length ? [true, false] : [undefined];
    for (let i = 0; i < range.values.length; i++) {
      for (const flag of combos) {
        const state = { ...defaultState(race), [range.key]: i };
        if (checks.length) state[checks[0].key] = flag;
        const p = paramsFor(race, state);
        const text = [race.question(p), ...race.caption(p), range.show(range.values[i])].join(" ");
        assert.doesNotMatch(text, /NaN|undefined|Infinity/, `${race.id} @ ${i}`);
        for (const l of race.lanes(p)) assert.ok(Number.isFinite(l.steps) && l.steps > 0);
      }
    }
  }
});

test("compact labels", () => {
  assert.equal(compact(0), "0");
  assert.equal(compact(1250), "1.3k");
  assert.equal(compact(5_000_000), "5M");
  assert.equal(compact(50e9), "50B");
});

// ---------- close-ups

const last = (raceId, methodId) => closeupFor(raceId).methods.find((m) => m.id === methodId).steps.at(-1);
const counter = (snap, label) => snap.counters.find((c) => c.label === label).value;

test("join close-up: 60 / 16 / 64 steps, and all three find the same 9 matches", () => {
  const expectMatches = J_TX.filter((v) => J_CUST.includes(v)).length;
  assert.equal(expectMatches, 9);
  const want = { nested: 60, hash: 16, merge: 64 };
  for (const [id, w] of Object.entries(want)) {
    assert.equal(counter(last("joins", id), "steps of work"), w, id);
    assert.equal(counter(last("joins", id), "matches found"), expectMatches, id);
  }
});

test("broadcast close-up: shuffle 9 sent + 11 = 20, broadcast 4 sent + 10 = 14", () => {
  const s = last("broadcast", "shuffle"), b = last("broadcast", "broadcast");
  assert.deepEqual([counter(s, "rows sent"), counter(s, "busiest worker"), counter(s, "total steps")], [9, 11, 20]);
  assert.deepEqual([counter(b, "rows sent"), counter(b, "busiest worker"), counter(b, "total steps")], [4, 10, 14]);
  // No row is lost or duplicated by the shuffle: 16 rows before, 16 after.
  assert.equal(s.groups.reduce((n, g) => n + g.items.length, 0), 16);
});

test("window close-up: 36 pairs vs 22 steps, and both give the same running totals", () => {
  const cu = closeupFor("window");
  assert.equal(counter(last("window", "self"), "steps of work"), 36);
  assert.equal(counter(last("window", "self"), "pairs kept"), 21);
  assert.equal(counter(last("window", "win"), "steps of work"), 22);
  // Self-join totals are in stored order; window totals in date order. Line them up by date.
  const selfByDay = Object.fromEntries(W_ROWS.map((r, i) => [r.day, cu.totals.self[i]]));
  const winByDay = Object.fromEntries(cu.totals.sortedDays.map((d, i) => [d, cu.totals.window[i]]));
  assert.deepEqual(selfByDay, winByDay);
});

test("every close-up has a starting view and steps that all have a note", () => {
  for (const race of RACES) {
    for (const m of closeupFor(race.id).methods) {
      assert.ok(m.idle && m.idle.groups.length, `${race.id}/${m.id} idle`);
      for (const s of m.steps) assert.ok(s.note && !/undefined|NaN/.test(s.note), `${race.id}/${m.id}: ${s.note}`);
    }
  }
});
