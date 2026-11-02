# ioBroker.statechart: reference

[Overview](../../README.md) | [Deutsch](../de/reference.md)

## Transition labels

```
event[condition]{action}
```

All parts are optional and may span several lines.

| Part | Meaning | Example |
|---|---|---|
| `event` | Name of an input: the transition is only checked when this input changes | `motion` |
| `after(n, unit)` | Instead of an event: a temporal expression, see below | `after(30, sec)` |
| `[condition]` | JavaScript expression, the transition is only taken if it is true | `[temp > 21 && !window]` |
| `{action}` | JavaScript, executed when the transition is taken | `{count++; light = true;}` |

Without event, a transition is checked whenever any input changes. If a state has several outgoing
transitions, they are checked in the order of their **priority** (shown at the arrow).

### Temporal logic

Instead of an event, a transition can have a temporal expression like in Stateflow. Time is measured from entering
the source state, in the units `msec`, `sec` and `min`:

| Expression | Valid | Example |
|---|---|---|
| `after(n, unit)` | from *n* units on. A timer wakes up the chart, then the condition is checked again on every following wakeup | `after(30, sec)[!motion]` |
| `before(n, unit)` | during the first *n* units, there is no timer | `before(5, sec)[button]` |
| `at(n, unit)` | exactly once: in the wakeup of its timer after *n* units, not later | `at(10, min)` |
| `every(n, unit)` | every *n* units, in the wakeup of its timer | `every(15, min){count++;}` |
| `after(n, unit, condition)` | as soon as the condition has been true for *n* units without interruption. A timer wakes up the chart exactly then | `after(5, min, !motion)` |
| `at("event", minutes)` | every day at an astro event, optionally shifted by minutes (negative: before), in the wakeup of its timer | `at("sunset", -30)` |
| `at("HH:mm")` | every day at this time | `at("22:30")[!window]` |

The same operators can count the wakeups by an input instead of the time, e.g. `after(3, button)` is valid on the
third and every further wakeup by `button` since entering the state, `at(3, button)` only on the third,
`every(2, button)` on every second one and `before(3, button)` on the first two. These transitions are only checked
on the wakeups by that input, the wakeup which entered the state does not count.

`at("sunset")` and `at("22:30")` are not measured from entering the state: while the state is active, they are valid
once a day at that time. Astro events: `sunrise`, `sunriseEnd`, `goldenHourEnd`, `solarNoon`, `goldenHour`,
`sunsetStart`, `sunset`, `dusk`, `nauticalDusk`, `night`, `nadir`, `nightEnd`, `nauticalDawn`, `dawn`, calculated
for the location of the ioBroker system settings. If an event does not happen on a day (polar regions), the
transition is not valid that day.

The condition of `after(n, unit, condition)` is checked on every wakeup, so it should depend on inputs and variables,
not on functions like `isTimeBetween()` which change without a wakeup. In conditions and actions, `elapsed(unit)` and
`duration(condition, unit)` give the times as numbers (see the helper functions). The counters and the times of
`after(n, unit, condition)` continue after a restart of the adapter.

## When inputs wake up the chart

Every input has three settings in the tab **Variables**, under **Wake up options** (shown right away if one of
them differs from the default):

| Setting | Values | Default |
|---|---|---|
| **Wake up on** | every update / value changes only | every update |
| **Acknowledged (ack)** | any / confirmed values only (`ack=true`) / commands only (`ack=false`) | any |
| **Debounce (ms)** | the chart wakes up only after the input had no update for this time, with its last value | 0 (off) |

Updates filtered out by ack do not change the variable, so it e.g. only contains confirmed values.

## Actions

Actions and conditions are JavaScript. All variables of the chart can be used directly by their name,
plus `Math`, `Date`, `JSON` etc. and `log("text")` to write to the ioBroker log.

| Action | Executed |
|---|---|
| `entry` | when the state is entered |
| `during` | on every wakeup of the chart while the state is active and none of its outgoing transitions is taken |
| `exit` | when the state is left |

## Nested states

Drop a state into another state to make it a **sub state**, drag it out again to undo it. While dragging,
the state it would be moved into is highlighted. Every level has its own initial state (dot with arrow).

- Entering a super state also enters its initial sub state (or the sub state the transition points to).
  Leaving it leaves the active sub state first.
- On every wakeup, each active state is processed in this order, starting with the outermost one:
  1. transitions leaving the state, 2. its `during` action, 3. its **inner transitions**, 4. its active sub state.
  So the transitions of a super state have priority over those of its sub states.
- A transition from a state to one of its own sub states is an **inner transition** (dot at its start):
  the state stays active, only its active sub state is left, its own `entry`/`exit` are not executed.
  With the option **Leave and enter the parent state again**, it is left and entered again instead.

### History junction

With the option **Return to the last active sub state (history)** of a state with sub states, entering it returns to
the sub state which was active when it was left last, instead of its initial state. Like in Stateflow, the state
shows a circle with an **H**. Example: a state "Auto" with the sub states "Eco" and "Comfort", and a state "Manual".
After "Manual", the chart returns to "Comfort" if that was active before.

- The initial state is only used when the state is entered the first time, and after a start without the stored
  state (e.g. after `reset` or a changed chart).
- It applies to all transitions ending at the state, also its self transitions and those from its sub states.
  A transition to one of its sub states enters that sub state as usual.
- Only the direct sub state is remembered (shallow history): its own sub states are entered at their initial state,
  unless it has a history junction itself.
- The history is kept when the adapter restarts, like the active states.

## Parallel states

With the option **Sub states are parallel (AND)** of a state, all its sub states are active at the same time
instead of exactly one, e.g. "Heating" and "Window" in a state "Home". The option **Top level states are parallel
(AND)** of the chart does the same for the top level. Like in Stateflow, parallel states have a dashed border and
show their position in the execution order in the upper right corner. They have no initial state.

- Entering the parent enters all parallel states (each with its initial sub state), in their execution order.
  Leaving it leaves them in reverse order.
- On every wakeup, after the parent (its transitions and its `during` action), each parallel state is processed in
  its execution order, see above. A transition in one of them does not stop the others, so each of them can take a
  transition in the same wakeup. A transition which leaves the parent stops the processing of the remaining ones.
- The execution order is set in the properties of the parallel states: lower first, states without a number after
  the others.
- Transitions between parallel states, or between their sub states, are not possible: both are active anyway.
- `activeState` contains all active states, separated by commas, e.g. `Home.Heating.On, Home.Window.Closed`.

## Helper functions

In conditions, actions and function blocks:

| Function | Purpose |
|---|---|
| `log(message, level)` | writes to the ioBroker log, level `"debug"`, `"info"` (default), `"warn"` or `"error"` |
| `setState(id, value, ack)` | writes any ioBroker state, `ack` is `false` by default |
| `setStateDelayed(id, value, delayMs, ack)` | writes after a delay, cancelled when the chart stops |
| `sendTo(instance, command, message)` | sends a message to an adapter, e.g. `sendTo("telegram.0", "send", { text: "Window open" })` |
| `isTimeBetween("22:00", "06:00")` | true if the current time is in the range, also over midnight |
| `isDaytime()` | true between sunrise and sunset |
| `astroTime("sunset", offsetMinutes)` | time of an astro event today as `Date`: `sunrise`, `sunset`, `dawn`, `dusk`, `solarNoon`, ... |
| `hasChanged(variable)` | true if the variable has changed, see below |
| `hasChangedFrom(variable, value)` | true if the variable has changed and its previous value was `value` |
| `hasChangedTo(variable, value)` | true if the variable has changed to `value`, e.g. `hasChangedTo(button, true)` for a rising edge |
| `getState("id")` | reads any ioBroker state: `{ val, ack, ts, lc }`, `null` if it does not exist, e.g. `[getState("0_userdata.0.lux").val < 50]`. The ID must be written as text: the adapter reads these states when the chart starts and keeps them up to date. Unlike inputs, they do not wake up the chart |
| `elapsed(unit)` | time since the state was entered (in conditions of transitions: the source state), unit `sec` (default), `msec` or `min`, e.g. `[elapsed(min) > 10]` |
| `duration(condition, unit)` | time the condition has been true without interruption, measured on the wakeups, unit `sec` (default), `msec` or `min`. It does not wake up the chart, for that use `after(n, unit, condition)` |

`isDaytime()` and `astroTime()` use the location of the ioBroker system settings. States which should wake up the
chart when they change are added as inputs, `getState()` is for states which are only needed in a condition or an
action. Time based functions do not wake up the chart by themselves, they are evaluated when it wakes up, for a
time of day use `at("22:30")`.

**Change detection** works like in Stateflow: it compares the value of the variable at the start of the current
wakeup with its value at the start of the previous wakeup. Inputs, outputs and locals can be checked. An update
with the same value is no change, neither is a wakeup by another input or a timer, so `[hasChangedTo(button, true)]`
is only true once per press of the button. On the wakeup after the start nothing has changed yet. A change of a
local by an action is seen on the next wakeup, also in a super step. Objects and arrays are compared by their
contents.

## Function blocks

**Add function** creates a block for your own JavaScript. It is executed once when the chart starts,
all functions and constants declared in it can be used in every condition and action of the chart:

```js
const LIMIT = 22;

function tooWarm(temp) {
    return temp > LIMIT;
}
```

Transition label: `[tooWarm(temperature)]{heating = false;}`

## Comments and notes

- **Comment:** states, transitions, function blocks and the chart itself have a field **Comment** in their properties.
  A speech bubble on the canvas shows that there is a comment, the comment is shown as tooltip.
- **Notes** (icon **Add note** in the toolbar) are free texts on the canvas, like sticky notes. Drop a note into a
  state, so it moves together with it.

Comments and notes have no influence on the execution. They are included in the generated code and in exported
files, and changing them does not prevent restoring the state after a restart.

## Checking the chart

While you edit, the editor checks the chart. Errors are shown red, warnings orange, both at the state, transition,
function block or variable, with the message as tooltip of the icon. Hints are only shown by a blue icon. When a
chart starts, the adapter writes errors and warnings to the log, hints only with the log level debug.

- **Code:** syntax errors, unknown variables and events, invalid temporal logic, writing an input (warning). They are
  also underlined in the code editors.
- **States which never become active** (warning): no transition leads to them, and they are not entered as initial
  state. Only the topmost one is reported, its sub states are never active either.
- **Transitions which are never taken** (warning): a transition before them (higher priority) is always valid, i.e. it
  has no condition (or one which is always true) and no temporal logic, and no event or the same event. Or one before
  them has the same event, temporal logic and condition. The transitions leaving a state are checked before its inner
  transitions, like when the chart runs.
- **Conditions which are never true** (warning, e.g. `[1 > 2]`) or always true (hint, e.g. `[true]`). Only conditions
  which do not depend on variables or functions are evaluated.
- **States which are never left** (hint): neither the state nor a state containing it has an outgoing transition. That
  is often intended, e.g. for a state "Error". States with a `during` action are not reported, they work as long as
  they are active.
- **Variables:** an output which is never written (warning), an input which is not used and only wakes up the chart
  (hint), a local variable which is not used or only written (hint).

The check cannot know which values the states will have. Whether a condition with variables ever becomes true is
shown by the [simulation](#simulation).

## Watching a running chart

While a chart runs, the editor shows what it does:

- The **active states** have a green border.
- **Live values** (panel at the top left of the canvas, switched on and off with the last icon in the toolbar):
  the current values of all variables. They are also shown in the line of each variable in the tab **Variables**.
- A **transition lights up** for a moment when the chart takes it.
- The tab **History** lists the starts of the chart and the transitions taken, newest first: when, from which state
  to which, triggered by which input or by a timer (`after`), and which states were active afterwards. Click a
  transition to select it in the chart. The adapter keeps the last 200 events, also when the editor is closed and
  after a restart. **Clear history** removes them.

The live values and the history come from the running chart, so they refer to the saved chart, not to unsaved
changes in the editor.

## Simulation

The button with the flask in the toolbar starts a **simulation**: the chart runs as shown in the editor, including
unsaved changes, but nothing is switched in the house.

- The real chart is stopped while the simulation runs.
- The inputs start with their current values. Then they only change when you set them in the panel on the top left:
  booleans with a switch, other values in the text field with Enter (a number, `true`/`false`, or text). The flash
  next to an input wakes up the chart with its event, without changing its value. Real changes of the inputs are
  ignored.
- Outputs, `setState()`, `setStateDelayed()` and `sendTo()` are not executed. The history shows them as
  **Not executed: …**, the live values show the simulated values of the outputs. `getState()` reads the real
  states.
- Timers and the temporal logic run in real time, unless you advance the time (see below).
- The active states, the live values and the history work as for the real chart, the events of the simulation are
  marked in the history. The stored state of the real chart is not changed.
- **Stop simulation** ends it, then the real chart continues where it was before. The simulation also ends when the
  chart is saved, when the adapter restarts, when another chart is selected, and after two minutes if the editor was
  closed.

The bar at the top of the canvas shows the simulated time, the next timer and the state of the simulation:

- **Advance the time:** the fast forward button jumps to the next timer, e.g. to the end of `after(2, min)`, the
  buttons **+1 min**, **+10 min** and **+1 h** let time pass. The timers which are due meanwhile fire in their order,
  `every(...)` as often as it is due. Everything which depends on the time uses the simulated time: `elapsed()`,
  `isTimeBetween()`, `at("22:30")`, astro events and the times in the history.
- **Pause:** the following events (inputs set by hand, events, timers) wait instead of being processed. **Single
  step** processes the next waiting event, **Continue** processes all of them and runs on.
- **Breakpoints:** in the properties of a state or transition, **Breakpoint** stops the simulation when the state is
  entered or the transition is taken. It is shown as red dot and also works for the initial states right after the
  start. The simulation stops after the step in which the breakpoint was reached, the history shows where. With the
  super step option, it stops after the transition, the rest of the chain is the next step. Breakpoints are not
  stored in the chart, they are lost when the editor is reloaded.

## Import and export

- **Export chart** (last icon in the toolbar of the editor) saves the chart as JSON file, including unsaved changes.
- **Export all charts** (icon above the chart list) saves all saved charts in one file.
- **Import charts** (icon above the chart list) adds the charts of such a file as new charts, existing charts are not
  changed. The file is checked before (structure, IDs, references between states and transitions).

Imported charts are **paused**: their variables may refer to states of another system. Check them in the tab
**Variables**, then start the chart with the button in the chart list.

## States created by the adapter

For every chart, the adapter creates below `statechart.<instance>.charts.<chart>`:

| State | Content |
|---|---|
| `activeState` | Name of the active state, nested states as `Parent.Child`, parallel states separated by commas |
| `activeStateIds` | IDs of all active states as JSON |
| `snapshot` | Stored state of the chart (active states, when they were entered, locals), see below |
| `values` | Current values of all variables as JSON, `{}` if the chart does not run |
| `history` | The last 200 events (starts and transitions taken) as JSON. Writing it without ack clears it |
| `simulation` | `true` while the chart runs as simulation from the editor |
| `simulationStatus` | Status of the simulation as JSON: paused, time offset, waiting events, next timer, breakpoint |

The chart itself is stored in the object `statechart.<instance>.charts.<chart>`.

### Controlling a chart from vis or scripts

Three states control a chart. They react on commands (written without ack), the adapter confirms them with ack:

| State | Write | Effect |
|---|---|---|
| `enabled` | `false` / `true` | Pauses the chart, or starts it in its initial state, like ▶ and ⏸ in the chart list. The state always shows whether the chart runs, also when it is started or paused in the editor |
| `reset` | `true` | Starts a running chart again in its initial state, the entry actions of the initial states are executed. A paused chart stays paused |
| `event` | name of an input | Wakes up the chart with the event of this input, without changing its value: transitions like `button[...]` and counting expressions like `after(3, button)` react as if the input was updated. Other names are logged as warning |

Example for a script of the JavaScript adapter: `setState("statechart.0.charts.light.reset", true);`

## Restart of the adapter

After a restart of the adapter or of ioBroker, every chart continues in the states which were active
before, with its local variables. The entry actions are not executed again, and timers continue with
their remaining time. A timer which expired while the adapter was stopped is taken right after the start.
Like after every start, the chart then wakes up once, so changes of the inputs during the stop are
noticed.

The chart starts in its initial state instead if it was changed meanwhile (positions in the editor do not
count), after saving it in the editor, after pausing it, and if the option **Restore the state after a
restart** in the chart properties is switched off. Variables declared in function blocks are not restored.

## Execution model and differences to other statechart tools

- The adapter uses [XState](https://stately.ai/docs/xstate) to execute the charts.
- Every change of an input wakes up the chart once, as well as an expiring `after(...)` and the start of the chart
  (also after restoring it). Transitions without event, e.g. without label, are checked on every wakeup, so they
  are taken right after the start if their condition is true.
- By default, only one transition is taken per wakeup, a following one waits for the next wakeup. With the
  chart option **Take transitions until none is valid (super step)**, the chart is checked again right after a
  transition, until no transition is valid anymore, like the super step semantics of Stateflow. The event of an
  input only counts for the first transition of a wakeup, during actions may run several times. To protect against
  loops, at most 100 transitions are taken per wakeup, then a warning is logged.
- `{action}` is executed while the transition is taken, i.e. after `exit` of the old and before `entry` of
  the new state. A separate condition action and `/action` are not supported (yet).
- Transitions are selected like in Stateflow (outer before inner, see above), XState only executes them.
  Pure XState would check the transitions of sub states first.
- Temporal logic is measured in real time, not in time steps: conditions are only checked when the chart wakes up.
  `after(n, unit, condition)` replaces the common Stateflow pattern `[duration(condition) > n]`, which would need a
  wakeup at the right time.
- Conditions and actions use JavaScript, not MATLAB/C syntax.

## Limitations

- History junctions and connective junctions are not supported yet.
- Deleting a super state also deletes its sub states.
- Unsaved changes are lost when you select another chart.
- Conditions and actions run in a separate JavaScript context with a time limit of 1 second, but this
  is **no security sandbox**: everyone who may edit charts can execute any code in the adapter,
  just like with the JavaScript adapter.
