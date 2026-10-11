# Infeasibility diagnostics: evidence and limits

The diagnostic output describes relaxations for which a feasible roster was verified. It does not prove that one constraint is the complete cause of infeasibility, and it never changes the saved input.

## Rule rows and coverage

Active hard rules are inventoried by building the ordinary model once. Rows submitted through `ctx.limit(id, ...)` are automatically addressable using `T.rules.relaxKey(id, scope)`. The rule solve hook still runs, so its auxiliary definitions and direct `lp.add` constraints remain. Rules with no hard limit rows are reported as outside automatic coverage. Existing `T.RELAXATIONS` and their plugin-defined semantics remain available.

Rule IDs and names are encoded component-by-component. Use the helper instead of splitting keys at colons. A date/name/slot selector may match multiple rows. A window that contains a slot may be selected through that slot; this means relaxing the corresponding rows, not deleting an assignment on that date.

The solve-side metadata contract and pure `explainSlot` hooks are documented in `rule-modules.md`.

## Order, alternatives, and joint sets

1. Inventory actual hard limit rows, within the existing overall time budget.
2. Test whole-rule relaxations, before legacy groups including fixed input.
3. For groups with verified feasibility, test each enumerated candidate alone, in date order. Fixed candidates are tested even when removing the entire fixed group is infeasible or unknown: fixed-input exemptions can make this operation nonmonotone.
4. Report every individually sufficient candidate that was verified. Show unknown and untested candidates explicitly. A completed scan means all candidates in the declared selector inventory were tested; it does not enumerate every imaginable edit or every minimal combination.
5. When no singleton is verified, validate the exact full candidate set and then reduce it by deletion tests. Report only a jointly verified set. Members are not individual alternatives.

`inclusionMinimal` is asserted only for pure rule-row selectors, after definitive tests show that each retained member is necessary relative to the final set. It means that no proper subset of these monotone relaxations suffices, not minimum cardinality among all possible sets. Legacy fixed/group operations may be nonmonotone; their verified joint sets do not receive this claim. Unknown results or an exhausted budget never certify minimality.

## Static candidate explanations

For active hard composition minimums, the diagnostic can report a slot with fewer unexcluded qualified candidates than required. This is a local static upper bound, not another optimization or a complete conflict proof. It combines explicit unavailable inputs (respecting fixed exceptions), occupied fixed capacity, and active rule-owned `explainSlot` evidence. Built-in hooks cover fixed-only input and completely forced shift-run windows, including previous/next boundaries. Facility-specific outpatient criteria are explained only when that facility's plugin supplies a hook; the core never infers them.

An absent exclusion does not prove that a person can be assigned. Other rules, missing hooks, interactions, or the global solution may still prevent it. The scan is marked incomplete if the remaining budget is exhausted. The UI keeps this static evidence separate from solve-verified alternatives.

## Safety and validation

Normal optimization, checking, penalties, saved inputs, and result formats are unchanged. Relaxed feasible witnesses are validated against the exact relaxed LP rows/domains. Unknown statuses, worker errors, cancellation, and stale inputs keep their existing handling. Fixed-date buttons navigate/highlight only and recheck input/plugin identity before acting.

Fictional tests include the Nov24 qualified-coverage shortage caused by fixed Nov25–27 day shifts with a maximum run of three; a colon-ID synthetic manager plugin; and a synthetic outpatient exclusion. The original diagnostic kept only Nov27. The new diagnostic verifies Nov25, Nov26, and Nov27 independently and identifies the relevant rule/slot selectors.
