# Older changes
## 0.3.0 (2026-11-14)
* (IggePop) simulation: the chart runs in the editor without switching anything, the inputs are set by hand, advance the time, pause, single steps and breakpoints on states and transitions
* (IggePop) parallel states (AND) with an execution order, and history junctions: entering a state returns to its last active sub state
* (IggePop) more temporal logic: `before`, `at`, `every`, counting the wakeups by an input (`after(3, button)`), `after(5, min, condition)`, `elapsed()`, `duration()`, and every day at a time or astro event (`at("22:30")`, `at("sunset", -30)`)
* (IggePop) `getState("id")` reads any state in conditions and actions, control states per chart: `enabled`, `reset` and `event`
* (IggePop) static check of the chart: states which never become active or are never left, transitions which are never taken, conditions which are never true, unused variables
* (IggePop) editor: color of each state (every second level of nested states darker), right-angled transitions as option, snap to the grid, align and distribute, labels of transitions can be moved
* (IggePop) editor: toolbar grouped by tasks with new buttons to cut and delete, collapsible side panels, colors and icons for each kind of element, variables grouped by kind with a search
* (IggePop) editor: transitions are black, their labels have no background
* (IggePop) export of the whole chart as PNG image
* (IggePop) fixed: labels of transitions inside a superstate were hidden, labels of several transitions between the same states and the line to a moved label covered text, self transitions on the top or right side were drawn twisted

## 0.2.0 (2026-11-01)
* (IggePop) the adapter and the editor are written in TypeScript now, no changes of the behavior
* (IggePop) live values of the variables in the editor
* (IggePop) taken transitions light up in the editor
* (IggePop) history of the starts and the transitions taken (tab "History", state `charts.<chart>.history`)
* (IggePop) a chart wakes up once right after the start, so transitions without label are taken without waiting for a change of an input
* (IggePop) chart option "super step": take transitions until none is valid anymore
* (IggePop) the arrows of transitions start and end where the states face each other (floating edges), their ends can be dragged along the border of the states or onto another state to move the transition there
* (IggePop) change detection: `hasChanged`, `hasChangedFrom` and `hasChangedTo`, e.g. `hasChangedTo(button, true)` for edges
* (IggePop) suncalc 2: `isDaytime()` is true all day during the midnight sun, `astroTime()` reports events which do not happen on a day (polar regions)

## 0.1.1 (2026-10-25)
* (IggePop) renamed from "state-machine" to "statechart", because npm does not accept the old name (too similar to an existing package)

## 0.1.0 (2026-10-25)
* (IggePop) initial release
* (IggePop) graphical chart editor in the admin side bar: states, transitions, nested states, function blocks, notes
* (IggePop) transition labels in Stateflow syntax event[condition]{action}, timers with after(n, unit)
* (IggePop) execution with Stateflow semantics (outer before inner transitions, inner transitions)
* (IggePop) charts continue in their state after a restart of the adapter
* (IggePop) per input: wake up on updates or changes, filter by ack, debounce
* (IggePop) helper functions: setState, setStateDelayed, sendTo, isTimeBetween, isDaytime, astroTime
* (IggePop) code editor with syntax highlighting, error checks and completion, generated code view
* (IggePop) undo/redo, copy/paste, import/export of charts as JSON
