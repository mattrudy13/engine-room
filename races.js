// The three Join Race races: their controls, step counts and captions.
// No DOM here, so the Node tests import this file directly.
//
// Every race counts "steps of work" with a simple, stated model (see each race's howWeCount).
// The numbers are not timings; they show how the work grows as the tables grow.

export const fmt = (x) => Math.round(x).toLocaleString("en-US");

// 1250000 -> "1.3M", 5000 -> "5k". Used where space is tight (slider labels, axis ticks).
export function compact(x) {
  const one = (v) => String(v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  if (x >= 1e9) return one(x / 1e9) + "B";
  if (x >= 1e6) return one(x / 1e6) + "M";
  if (x >= 1e3) return one(x / 1e3) + "k";
  return String(Math.round(x));
}

// Sorting n rows costs about n × log2(n) comparisons (merge sort, which is what Spark's sort is close to).
export const sortCost = (n) => (n > 1 ? n * Math.log2(n) : 0);

const QW = "https://mattrudy13.github.io/sql-drills/#";

// ---------- race 1: join methods

const joins = {
  id: "joins",
  title: "Join methods",
  short: "Joins",
  blurb: "Nested loop · hash · sort-merge",
  intro: "Join customers to their transactions three ways, and count the work each way does.",
  controls: [
    {
      type: "range", key: "scale", label: "Table size",
      values: [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100], defaultIndex: 3,
      show: (v) => `${v}× (${compact(1000 * v)} × ${compact(5000 * v)})`,
    },
  ],
  sizes(p) { return { n: 1000 * p.scale, m: 5000 * p.scale }; },
  question(p) {
    const { n, m } = this.sizes(p);
    return `Which join finishes first: ${fmt(n)} customers × ${fmt(m)} transactions?`;
  },
  lanes(p) {
    const { n, m } = this.sizes(p);
    return [
      { id: "nested", name: "Nested loop", steps: n * m },
      { id: "hash", name: "Hash join", steps: n + m },
      { id: "merge", name: "Sort-merge", steps: sortCost(n) + sortCost(m) + n + m },
    ];
  },
  caption(p) {
    const { n, m } = this.sizes(p);
    return [
      `The nested loop checks every customer against every transaction: ${fmt(n)} × ${fmt(m)} = ${fmt(n * m)} checks. ` +
      `Hash join reads the ${fmt(n)} customers once into a lookup table, then does one lookup per transaction: ` +
      `${fmt(n + m)} steps. Sort-merge sorts both tables first (${fmt(sortCost(n) + sortCost(m))} steps), then walks ` +
      `them side by side once (${fmt(n + m)}).`,
      `Double both tables and the nested loop does 4× the work, because it pairs everything with everything. ` +
      `Hash join does exactly 2×, and sort-merge a little over 2× (the sort grows slightly faster than the table).`,
      `So why does Spark use sort-merge for two big tables? A hash table built from a big table won't fit in one ` +
      `worker's memory, and this race doesn't count memory. When one side is small, Spark copies it to every worker ` +
      `and hash-joins there. That's the next race.`,
    ];
  },
  howWeCount: [
    "Each comparison or lookup is 1 step.",
    "Nested loop: every customer against every transaction, so customers × transactions.",
    "Hash join: 1 step to put each customer into the lookup table, then 1 step to look up each transaction.",
    "Sort-merge: sorting n rows takes about n × log₂(n) steps, then 1 step per row to walk both sorted lists.",
    "Memory isn't counted. That's the one thing hash join needs a lot of.",
  ],
  drills: [{ id: "c6", title: "Which join will Spark pick?" }],
};

// ---------- race 2: broadcast vs shuffle

const WORKERS = 4;
const TXNS = 1_000_000;
const HOT_SHARE = 0.4; // with skew on, one customer owns 40% of the transactions
const HOT_WORKER = 2;  // worker 3 (0-based 2) owns that customer

const broadcast = {
  id: "broadcast",
  title: "Broadcast vs shuffle",
  short: "Broadcast",
  blurb: "Four workers, with a skew switch",
  intro: "The same join on a cluster of 4 workers. Count the rows sent over the network, and the rows on the busiest worker.",
  controls: [
    {
      type: "range", key: "cust", label: "Customer table size",
      values: [1000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000], defaultIndex: 0,
      show: (v) => `${fmt(v)} rows`,
    },
    { type: "check", key: "skew", label: "Skew: one customer has 40% of the transactions", default: true },
  ],
  question(p) {
    return `${fmt(p.cust)} customers × ${fmt(TXNS)} transactions on ${WORKERS} workers, ` +
      `${p.skew ? "with skew on" : "no skew"}. Which finishes first?`;
  },
  detail(p) {
    const c = p.cust, m = TXNS, W = WORKERS;
    // Shuffle: every row goes to the worker that owns its customer id. Rows start spread evenly,
    // so about (W-1)/W of them are on the wrong worker and cross the network.
    const evenTx = p.skew ? (1 - HOT_SHARE) * m / W : m / W;
    const shuffleLoads = Array.from({ length: W }, (_, i) => c / W + evenTx + (p.skew && i === HOT_WORKER ? HOT_SHARE * m : 0));
    // Broadcast: each worker already has 1/W of the customers and needs the rest; transactions don't move.
    const broadcastLoads = Array.from({ length: W }, () => m / W + c);
    return {
      shuffle: { net: (W - 1) / W * (c + m), loads: shuffleLoads },
      broadcast: { net: c * (W - 1), loads: broadcastLoads },
    };
  },
  lanes(p) {
    const d = this.detail(p);
    const lane = (id, name, x) => ({ id, name, steps: x.net + Math.max(...x.loads), net: x.net, loads: x.loads });
    return [lane("shuffle", "Shuffle join", d.shuffle), lane("broadcast", "Broadcast join", d.broadcast)];
  },
  caption(p) {
    const d = this.detail(p);
    const sMax = Math.max(...d.shuffle.loads), sMin = Math.min(...d.shuffle.loads);
    const bLoad = d.broadcast.loads[0];
    const bWins = d.broadcast.net + bLoad < d.shuffle.net + sMax;
    const out = [
      `A shuffle join sends every row to the worker that owns its customer id, so about ¾ of all rows ` +
      `(${fmt(d.shuffle.net)}) cross the network. ` +
      (p.skew
        ? `The busy customer's rows all land on worker 3, which ends up with ${fmt(sMax)} rows while the others have ` +
          `${fmt(sMin)}. Everyone waits for worker 3.`
        : `Each worker ends up with about ${fmt(sMax)} rows.`),
      `A broadcast join copies the customer table to every worker (${fmt(d.broadcast.net)} rows sent) and leaves the ` +
      `transactions where they are, so each worker joins ${fmt(bLoad)} rows` +
      (p.skew ? `, and the skew never piles up on one worker.` : `.`),
    ];
    const x = fmt(this.crossover(p));
    const why = p.skew ? " Skew makes the shuffle worse, which pushes that point higher." : "";
    out.push(bWins
      ? `Make the customer table bigger and copying it to every worker stops being cheap: past about ${x} customers ` +
        `the shuffle takes over.${why}`
      : `Past about ${x} customers the table is too big to copy everywhere cheaply, so the shuffle wins.${why} ` +
        `Spark only broadcasts tables under spark.sql.autoBroadcastJoinThreshold (10 MB by default).`);
    return out;
  },
  // Customer-table size where both joins cost the same. Both totals are straight lines in the
  // customer count, so two points pin each line down.
  crossover(p) {
    const total = (c) => this.lanes({ ...p, cust: c }).map((l) => l.steps);
    const [s0, b0] = total(0), [s1, b1] = total(1);
    return (s0 - b0) / ((b1 - b0) - (s1 - s0));
  },
  howWeCount: [
    "Each row sent over the network is 1 step.",
    "Each row a worker joins is 1 step, but the workers run at the same time, so only the busiest one counts: the job is done when it is.",
    "Total = rows sent + rows on the busiest worker.",
    "Real networks are slower than local work, so if anything this undersells how much a shuffle costs.",
  ],
  drills: [
    { id: "c1", title: "Broadcast or shuffle?" },
    { id: "c5", title: "One slow task (skew)" },
    { id: "c7", title: "Find the hot key" },
  ],
};

// ---------- race 3: window vs self-join

const ROWS = 5000;

const windowRace = {
  id: "window",
  title: "Window vs self-join",
  short: "Window",
  blurb: "Running total per customer",
  intro: "A running total of each customer's transactions, written two ways. Same 5,000 rows; the slider changes how they're spread across customers.",
  controls: [
    {
      type: "range", key: "k", label: "Transactions per customer",
      values: [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 5000], defaultIndex: 5,
      show: (v) => `${fmt(v)} each (${fmt(ROWS / v)} customer${ROWS / v === 1 ? "" : "s"})`,
    },
  ],
  question(p) {
    return `${fmt(ROWS / p.k)} customers with ${fmt(p.k)} transactions each. Which running total finishes first?`;
  },
  lanes(p) {
    return [
      { id: "self", name: "Self-join", steps: ROWS * p.k },
      { id: "win", name: "Window function", steps: sortCost(ROWS) + ROWS },
    ];
  },
  caption(p) {
    const k = p.k, self = ROWS * k, win = sortCost(ROWS) + ROWS;
    return [
      `The self-join pairs every transaction with every transaction of the same customer (${fmt(k)} × ${fmt(k)} ` +
      `pairs per customer, ${fmt(self)} in all), then keeps the ones dated on or before it. The window function sorts ` +
      `the rows once (${fmt(sortCost(ROWS))} steps) and walks down each customer keeping a running sum (${fmt(ROWS)}).`,
      self <= win
        ? `With only ${fmt(k)} transaction${k === 1 ? "" : "s"} per customer the self-join is actually cheaper here. ` +
          `That flips fast: its work grows with the square of the rows per customer.`
        : `Each extra transaction per customer adds a whole row of pairs to the self-join, so its work grows with the ` +
          `square of the rows per customer. The window's doesn't change at all: it's the same 5,000 rows to sort.`,
    ];
  },
  howWeCount: [
    "Self-join: joining on customer_id pairs each transaction with every transaction of that customer, k × k per customer. Each pair is 1 step; the date filter comes after.",
    "Window function: sorting n rows takes about n × log₂(n) steps, then 1 step per row for the running sum.",
    "Spark really sorts each partition separately, which is a bit cheaper than one big sort, but the shape is the same.",
  ],
  drills: [{ id: "w2", title: "Running total" }],
};

export const RACES = [joins, broadcast, windowRace];
export const raceById = (id) => RACES.find((r) => r.id === id);
export const drillUrl = (id) => QW + id;

// Control values for a race, from slider indexes / checkbox states.
export function defaultState(race) {
  const s = {};
  for (const c of race.controls) s[c.key] = c.type === "range" ? c.defaultIndex : c.default;
  return s;
}
export function paramsFor(race, state) {
  const p = {};
  for (const c of race.controls) p[c.key] = c.type === "range" ? c.values[state[c.key]] : !!state[c.key];
  return p;
}

// Lanes in finishing order (fewest steps first; ties keep their listed order).
export function standings(lanes) {
  return lanes.map((l, i) => ({ ...l, i })).sort((a, b) => a.steps - b.steps || a.i - b.i);
}
