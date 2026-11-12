# Ideas for later

Not scheduled. Ask Rudy before starting any of these.

1. **Delta log sandbox** (planned v0.2): click through writes, UPDATE, OPTIMIZE, VACUUM and time travel, and watch
   the Parquet files and `_delta_log` change.
2. **Spark plan reader** (planned v0.3): paste `EXPLAIN` text, get a tree with shuffles, broadcasts and full scans
   flagged in plain words. Needs real plan samples to test against; practice on Query Workbook's tables, not
   work plans.
3. **Light mode.** v0.1 is dark only.
4. **Board tile** on Rudy's Board (hub), and a **portfolio card** once it's polished.
5. **A sort race** (insertion vs merge vs quick), if wanted. Left out of v0.1 as least tied to Spark.
6. **Memory meter** on the join race: show the hash table's size, to make "why Spark sorts big tables" visible
   instead of only stated.
