// "Watch it up close": each method run on a tiny example, one step at a time.
// No DOM here. Each method is a list of snapshots the page draws as-is:
//   { groups: [{ title, items: [{ label, tone }], rows?: [{ title, active, items }] }],
//     counters: [{ label, value, tone }], note }
// tone: "cur" (being looked at), "match" (a hit), "moved" (arrived over the network), "" (plain).

import { sortCost } from "./races.js";

const chip = (label, tone = "") => ({ label, tone });
const START = "Press Play or Step to start.";

// ---------- join methods: 6 customers × 10 transactions

export const J_CUST = [4, 1, 6, 2, 5, 3];
export const J_TX = [2, 5, 1, 2, 7, 4, 6, 2, 3, 5]; // the customer id on each transaction; #7 has no customer

function joinsSnap(method, cur, work, matches, note, built = 0) {
  const tone = (hit) => (hit ? "match" : "cur");
  const custOrder = method === "merge" ? [...J_CUST].sort((a, b) => a - b) : J_CUST;
  const txOrder = J_TX.map((_, i) => i);
  if (method === "merge") txOrder.sort((a, b) => J_TX[a] - J_TX[b] || a - b);
  const groups = [{
    title: method === "merge" ? "Customers (sorted)" : "Customers",
    items: custOrder.map((c) => chip("#" + c, cur && cur.c === c && cur.t == null ? "cur" : cur && cur.c === c ? tone(cur.hit) : "")),
  }];
  if (method === "hash") {
    groups.push({
      title: "Lookup table (bucket = id ÷ 3, remainder)",
      rows: [0, 1, 2].map((b) => ({
        title: "bucket " + b,
        active: !!cur && cur.b === b,
        items: J_CUST.slice(0, built).filter((c) => c % 3 === b)
          .map((c) => chip("#" + c, cur && cur.c === c && cur.b === b ? (cur.t == null ? "cur" : tone(cur.hit)) : "")),
      })),
    });
  }
  groups.push({
    title: method === "merge" ? "Transactions (sorted by customer)" : "Transactions (t# → customer)",
    items: txOrder.map((ti) => chip(`t${ti + 1}→#${J_TX[ti]}`, cur && cur.t === ti ? tone(cur.hit) : "")),
  });
  return {
    groups,
    counters: [
      { label: "steps of work", value: work, tone: "amber" },
      { label: "matches found", value: matches, tone: "green" },
    ],
    note,
  };
}

function joinsCloseup() {
  const nested = [];
  let w = 0, m = 0;
  for (const c of J_CUST) {
    J_TX.forEach((v, ti) => {
      w++; const hit = c === v; if (hit) m++;
      nested.push(joinsSnap("nested", { c, t: ti, hit }, w, m,
        `Customer #${c} vs t${ti + 1} (customer #${v}): ${hit ? "match" : "no match"}. Every customer gets checked against every transaction.`));
    });
  }
  nested.at(-1).note = `Finished: ${w} steps. At this tiny size that's fine. Make the tables bigger in the race above and it falls apart.`;

  const hash = [];
  w = 0; m = 0;
  J_CUST.forEach((c, i) => {
    w++;
    hash.push(joinsSnap("hash", { c, b: c % 3 }, w, m, `Build: put customer #${c} in bucket ${c % 3}. Each customer is read once.`, i + 1));
  });
  J_TX.forEach((v, ti) => {
    w++; const hit = J_CUST.includes(v); if (hit) m++;
    hash.push(joinsSnap("hash", { c: hit ? v : null, t: ti, b: v % 3, hit }, w, m,
      `Probe: t${ti + 1} wants customer #${v}, so look only in bucket ${v % 3}: ${hit ? "found" : "not there"}.`, J_CUST.length));
  });
  hash.at(-1).note = `Finished: ${w} steps. Build the lookup once, then one lookup per transaction.`;

  const merge = [];
  const sc = [...J_CUST].sort((a, b) => a - b);
  const st = J_TX.map((_, i) => i).sort((a, b) => J_TX[a] - J_TX[b] || a - b);
  w = Math.round(sortCost(J_CUST.length) + sortCost(J_TX.length)); m = 0;
  merge.push(joinsSnap("merge", null, w, m, `Sort both lists first: about ${w} steps. Sorting n rows costs about n × log₂(n).`));
  let i = 0, j = 0;
  while (i < sc.length && j < st.length) {
    const c = sc[i], ti = st[j], v = J_TX[ti]; w++;
    if (c === v) {
      m++;
      merge.push(joinsSnap("merge", { c, t: ti, hit: true }, w, m, `Customer #${c} and t${ti + 1}: match. Move to the next transaction.`));
      j++;
    } else if (c < v) {
      merge.push(joinsSnap("merge", { c, t: ti, hit: false }, w, m, `#${c} is smaller than #${v}, so customer #${c} has no more matches. Move to the next customer.`));
      i++;
    } else {
      merge.push(joinsSnap("merge", { c, t: ti, hit: false }, w, m, `t${ti + 1} is for customer #${v}, smaller than #${c}: no customer for it. Move on.`));
      j++;
    }
  }
  merge.at(-1).note = `Finished: ${w} steps, mostly sorting. After the sort, one walk down both lists finds every match.`;

  const idle = (method) => joinsSnap(method === "hash" ? "hash" : "nested", null, 0, 0, START);
  return {
    heading: "6 customers × 10 transactions",
    methods: [
      { id: "nested", label: "Nested loop", idle: idle("nested"), steps: nested },
      { id: "hash", label: "Hash", idle: idle("hash"), steps: hash },
      { id: "merge", label: "Sort-merge", idle: idle("merge"), steps: merge },
    ],
  };
}

// ---------- broadcast vs shuffle: 4 customers × 12 transactions on 2 workers

export const B_CUST = [1, 2, 3, 4];
export const B_TX = [1, 2, 1, 3, 1, 4, 1, 1, 2, 1, 3, 1]; // customer #1 has 7 of the 12: the skew
const home = (id) => (id % 2 === 1 ? 0 : 1); // shuffle sends odd ids to worker 1, even ids to worker 2

function startWorkers() {
  // Rows start where they were written: first half of each table on worker 1, second half on worker 2.
  const w = [[], []];
  B_CUST.forEach((c, i) => w[i < B_CUST.length / 2 ? 0 : 1].push({ key: "c" + c, label: "cust #" + c, cust: c }));
  B_TX.forEach((c, i) => w[i < B_TX.length / 2 ? 0 : 1].push({ key: "t" + (i + 1), label: `t${i + 1}→#${c}`, cust: c }));
  return w;
}

function workerSnap(workers, curKey, moved, sent, busiest, total, note) {
  return {
    groups: workers.map((rows, wi) => ({
      title: `Worker ${wi + 1} · ${rows.length} rows`,
      items: rows.map((r) => chip(r.label, r.key === curKey ? "cur" : moved.has(r.key + "@" + wi) ? "moved" : "")),
    })),
    counters: [
      { label: "rows sent", value: sent, tone: "amber" },
      { label: "busiest worker", value: busiest, tone: "" },
      { label: "total steps", value: total, tone: "green" },
    ],
    note,
  };
}

function broadcastCloseup() {
  // Shuffle
  const shuffle = [];
  let w = startWorkers();
  const moved = new Set();
  let sent = 0;
  const order = [...w[0].map((r) => [r, 0]), ...w[1].map((r) => [r, 1])];
  const custFirst = [...order.filter(([r]) => r.key[0] === "c"), ...order.filter(([r]) => r.key[0] === "t")];
  for (const [row, from] of custFirst) {
    const to = home(row.cust);
    if (to === from) {
      shuffle.push(workerSnap(w, row.key, moved, sent, "–", "–",
        `${row.label} belongs to customer #${row.cust}, whose home is worker ${to + 1}. It's already there.`));
    } else {
      sent++;
      w = w.map((rows) => rows.filter((r) => r.key !== row.key));
      w[to].push(row);
      moved.add(row.key + "@" + to);
      shuffle.push(workerSnap(w, row.key, moved, sent, "–", "–",
        `${row.label} belongs to customer #${row.cust}, whose home is worker ${to + 1}. Send it over the network.`));
    }
  }
  const loads = w.map((r) => r.length);
  const busy = Math.max(...loads);
  shuffle.push(workerSnap(w, null, moved, sent, busy, sent + busy,
    `Now each worker joins what it holds: ${loads[0]} rows on worker 1, ${loads[1]} on worker 2. Customer #1's rows all went to worker 1, so the job waits on it. Total: ${sent} sent + ${busy} = ${sent + busy} steps.`));

  // Broadcast
  const bcast = [];
  w = startWorkers();
  const bMoved = new Set();
  sent = 0;
  for (const c of B_CUST) {
    const from = w.findIndex((rows) => rows.some((r) => r.key === "c" + c));
    const to = 1 - from;
    sent++;
    w[to].unshift({ key: "c" + c, label: "cust #" + c, cust: c });
    bMoved.add("c" + c + "@" + to);
    bcast.push(workerSnap(w, null, bMoved, sent, "–", "–",
      `Copy customer #${c} to worker ${to + 1}. Every worker gets the whole (small) customer table.`));
    bcast.at(-1).groups[to].items[0].tone = "cur";
  }
  bcast.push(workerSnap(w, null, bMoved, sent, "–", "–", "The transactions stay where they are. Not one of them crosses the network."));
  const bLoads = w.map((r) => r.length);
  const bBusy = Math.max(...bLoads);
  bcast.push(workerSnap(w, null, bMoved, sent, bBusy, sent + bBusy,
    `Each worker joins its own rows: ${bLoads[0]} and ${bLoads[1]}. Customer #1's skew doesn't matter, because its transactions never moved. Total: ${sent} sent + ${bBusy} = ${sent + bBusy} steps.`));

  const idle = workerSnap(startWorkers(), null, new Set(), 0, "–", "–", START);
  return {
    heading: "4 customers × 12 transactions on 2 workers (customer #1 has 7 of them)",
    methods: [
      { id: "shuffle", label: "Shuffle", idle, steps: shuffle },
      { id: "broadcast", label: "Broadcast", idle, steps: bcast },
    ],
  };
}

// ---------- window vs self-join: one customer's 6 transactions

export const W_ROWS = [
  { day: 3, amt: 40 }, { day: 1, amt: 50 }, { day: 5, amt: 30 },
  { day: 2, amt: 20 }, { day: 6, amt: 10 }, { day: 4, amt: -10 },
];
const money = (x) => (x < 0 ? "−$" + -x : "$" + x);
const rowLabel = (r, total) => `Mar ${r.day} · ${money(r.amt)}` + (total == null ? "" : ` → ${money(total)}`);

function windowCloseup() {
  // Self-join: for each row (t1), check every row of the customer (t2) and add those on or before t1's date.
  const self = [];
  const totals = W_ROWS.map(() => null);
  let w = 0, kept = 0;
  W_ROWS.forEach((t1, a) => {
    let sum = 0;
    W_ROWS.forEach((t2, b) => {
      w++;
      const keep = t2.day <= t1.day;
      if (keep) { kept++; sum += t2.amt; }
      if (b === W_ROWS.length - 1) totals[a] = sum;
      self.push({
        groups: [
          { title: "For this row (t1)", items: W_ROWS.map((r, i) => chip(rowLabel(r, totals[i]), i === a ? "cur" : "")) },
          { title: "Check every row of the customer (t2)", items: W_ROWS.map((r, i) => chip(rowLabel(r), i === b ? (keep ? "match" : "cur") : "")) },
        ],
        counters: [
          { label: "steps of work", value: w, tone: "amber" },
          { label: "pairs kept", value: kept, tone: "green" },
        ],
        note: `Row for Mar ${t1.day}: Mar ${t2.day} is ` +
          (keep ? `on or before it, so add ${money(t2.amt)} (sum so far ${money(sum)}).` : `after it, so skip.`),
      });
    });
  });
  self.at(-1).note = `Finished: ${w} pairs checked to keep ${kept}. Every row was compared with every row.`;

  // Window: sort by date once, then one pass keeping a running sum.
  const win = [];
  const sorted = [...W_ROWS].sort((a, b) => a.day - b.day);
  const sortSteps = Math.round(sortCost(W_ROWS.length));
  const wTotals = sorted.map(() => null);
  w = sortSteps;
  win.push({
    groups: [{ title: "Sorted by date", items: sorted.map((r) => chip(rowLabel(r))) }],
    counters: [{ label: "steps of work", value: w, tone: "amber" }],
    note: `Sort the customer's rows by date: about ${sortSteps} steps.`,
  });
  let run = 0;
  sorted.forEach((r, i) => {
    w++; run += r.amt; wTotals[i] = run;
    win.push({
      groups: [{ title: "Sorted by date", items: sorted.map((x, j) => chip(rowLabel(x, wTotals[j]), j === i ? "match" : "")) }],
      counters: [{ label: "steps of work", value: w, tone: "amber" }],
      note: `Add ${money(r.amt)} to the running sum: ${money(run)}. One step per row.`,
    });
  });
  win.at(-1).note = `Finished: ${w} steps. Sort once, walk once, and the same totals as the self-join.`;

  const asStored = { title: "Rows as stored", items: W_ROWS.map((r) => chip(rowLabel(r))) };
  return {
    heading: "One customer, 6 transactions",
    methods: [
      { id: "self", label: "Self-join", steps: self,
        idle: { groups: [asStored], counters: [{ label: "steps of work", value: 0, tone: "amber" }, { label: "pairs kept", value: 0, tone: "green" }], note: START } },
      { id: "win", label: "Window", steps: win,
        idle: { groups: [asStored], counters: [{ label: "steps of work", value: 0, tone: "amber" }], note: START } },
    ],
    totals: { self: totals, window: wTotals, sortedDays: sorted.map((r) => r.day) },
  };
}

const BUILDERS = { joins: joinsCloseup, broadcast: broadcastCloseup, window: windowCloseup };
const cache = {};
export function closeupFor(raceId) {
  if (!cache[raceId]) cache[raceId] = BUILDERS[raceId]();
  return cache[raceId];
}
