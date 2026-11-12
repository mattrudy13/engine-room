# Engine Room

Watch what happens underneath a query. **Join Race** puts query plans side by side and counts the work each one
does as the tables grow:

- **Join methods:** nested loop vs hash join vs sort-merge.
- **Broadcast vs shuffle:** the same join on four workers, with a switch that skews one key.
- **Window vs self-join:** a running total per customer, written two ways.

Guess the winner first, watch the race, then move the sliders. Each race has a step-by-step close-up on a tiny
example and links to matching drills in [Query Workbook](https://mattrudy13.github.io/sql-drills/).

Open it: https://mattrudy13.github.io/engine-room/

The races are simulated: they count steps of work with simple stated rules, not real timings.

Plain HTML, CSS and JavaScript, no build step. `npm test` checks the step counts the page quotes.
