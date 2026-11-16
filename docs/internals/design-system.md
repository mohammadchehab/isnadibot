# Design system

> For IsnadiBot maintainers and the agents that work on the repo.

The Figma component sets describe the **product**, not the component library. A set declares the
looks, sizes and presentations that shipped screens actually reach; a code variant no screen uses
stays undeclared. That is decision-94, answered 2026-11-15, and it is the reason this page exists
rather than a design-system reference that lists everything the code can do.

The distinction matters because "draw everything" is not one card's work: Button alone ships 21
looks × 21 sizes × 35 presentations, and the sets are meant to stay small enough to browse. A
developer reaching for a variant no screen uses will not find it drawn; that is the accepted cost.

Two rules sit beside this one and are enforced rather than described:

- [`lint.md`](./lint.md) covers `shadcn/no-restyle`, which keeps a call site from styling a
  primitive. When a call site needs a look no variant provides, the look is added to the primitive
  and used by name.
- `lint.md` also covers the theme tokens in `apps/web/src/index.css`. A look binds to those
  tokens; it does not carry a palette color of its own.

## What the sets declare today

Measured by reading each set's `componentPropertyDefinitions` back, at `8118b7b02`. Three sets were
extended, **32 variants added across them, nothing deleted**.

| Set            | Node       | Variants | Extent                                                           |
| -------------- | ---------- | -------- | ---------------------------------------------------------------- |
| Button         | `2047:243` | 99       | Variant 10→20, Size 4→13, State Rest/Disabled                    |
| Icon button    | `2047:324` | 35       | Variant 4, Size 4→7, State Rest/Disabled                         |
| Sidebar / Menu | `2089:399` | 20       | Size 2→4 (default, sm, icon, lg), State 5, no Variant axis       |
| Dialog         | `2067:111` | 2        | unchanged — sub-part props are its own spec, not a cross-product |

Each axis value is declared **once**, on a representative variant, not as a full cross-product. The
Button set declares 10 looks and 9 non-icon sizes; the icon sizes live once, in the Icon button
set, under the same names the Button's `size` prop uses. Declaring them in both would create the
near-duplicate that condition 3 below forbids. A full cross-product would be 520 Button variants;
the shipped surface reaches 99.

**Sidebar `outline` stays undeclared, and that is not a deferral.** The code ships
`variant: default | outline`, and the set has no Variant axis. Adding one would have been structural
work, so it was measured first: **`outline` has zero call sites** — no `<SidebarMenuButton>` in
`apps/web/src` passes `variant` at all. Under decision-94 it stays undrawn like `glass`, `xl`,
`icon-xl` and `wizard-preview-action`. The structural axis was avoided, not postponed.

## The size-admission rule

Decision-94 answers how far the sets should be brought up to the code. This rule governs a
different moment: someone wants to add a size **to the code**. Both answers to 94 need it — if 94
had said "draw everything", this would decide what earns drawing; because it says "declare only
what shipped screens use", this decides what "used" means.

A new size may be added to a component's size axis only when all six hold.

1. **A frame asks for it, and the frame exists.** The numbers come from a drawn surface, and the
   code comment cites its node id. If no frame draws the surface, the answer is not "add a size" —
   it is "take the nearest declared size, and log the gap". A frame governs a drawn surface; the
   component set governs an undrawn one. A size invented to make an undrawn screen look right is a
   screen decision wearing system clothes.

2. **No existing size holds it, and the arithmetic says so.** Name the sizes tried and why each
   fails. For `icon-round` the answer was subtraction: `icon` steps 36→32, `icon-sm-round` steps
   32→28, and the frame is a constant 36. If an existing size holds the frame, use the existing
   size — an extra size that is nearly right is worse than a reuse that is nearly right, because
   only one of them compounds.

3. **It is not a near-duplicate.** If the new size differs from an existing one by one step in one
   dimension, one of the two is wrong. Resolve which; do not ship both.

4. **It changes extent, not ink and not fade.** A size sets height, width, radius or icon box. If
   the only difference is color, it is a **variant**. If the only difference is how a disabled
   control looks, it is a **state treatment** — and there are exactly four: 64% · recolor 100% ·
   segment 50% · row 50% (States legend `2047:339`). Anything else is a fifth weight pretending to
   be a control.

5. **It is declared once and read everywhere, never overridden at a call site.** A call site that
   needs a different shape takes a size or a presentation. It does not add `rounded-full`, `h-[Npx]`
   or `size-9` itself. That is the defect class `shadcn/no-restyle` exists to delete: nine sites
   hand-writing a fade the component already owns, and one of them was the size.

6. **It is logged as Figma debt in the same breath it is admitted.** Code may run ahead of the set —
   how far is decision-94's question — but it must never run ahead silently. An admitted size that
   is not in the set goes on the debt list with its frame id and the arithmetic from condition 2.

### The one exception, and it is narrow

**A constant size that does not step down is allowed only when it must align with a neighbour that
is itself constant, and the comment names the neighbour.** `icon-round` is `size-9` at every width
while every other size steps down at ≥640px. That is allowed only because the send button beside it
is a constant `size-9 … rounded-full`, and a stepping size would misalign the pair. Without a named
constant neighbour, a size that skips the step-down is a bug, not a size.

### When the rule says no

Take the nearest declared size. Write the difference on the work item as a comment. Let the
designer rule. Do not invent the shape at the call site — a wrong size in one place is a bug, a
hand-written shape in one place is a system that stops being one.

### Worked examples

Both come from the same change, so the rule is shown biting in both directions.

|                              | `icon-round`                       | `opacity-25`                                 |
| ---------------------------- | ---------------------------------- | -------------------------------------------- |
| 1. Frame exists, cited       | ✓ `2096:629`                       | ✗ no frame, and not a size                   |
| 2. No existing size holds it | ✓ arithmetic shown                 | n/a                                          |
| 3. Not a near-duplicate      | ✓ 36-constant vs 32→28, still open | n/a                                          |
| 4. Extent, not ink or fade   | ✓                                  | ✗ it _is_ a fade                             |
| 5. Declared once             | ✓                                  | ✗ hand-written utility                       |
| 6. Logged as debt            | ✓ 18th undeclared size             | ✗                                            |
| **Verdict**                  | **admitted**                       | **rejected — a state treatment, not a size** |

`opacity-25` on the send button was not a size question at all. It is an undeclared state treatment,
and it should not survive as a hand-written utility — the fourth condition is what catches it.

## Known debt this rule has not resolved

These are recorded, not fixed. Resolving any of them is its own work item.

- **Two round sizes with no written distinction.** `icon-sm-round` (32→28, one caller) and
  `icon-round` (36 constant, the dictation slot). Either a frame justifies both, or one absorbs the
  other. Condition 3 says do not ship both; which one goes needs a frame nobody has read yet.
- **Four looks share one Rest appearance.** `keybinding-action`, `ghost-muted`, `ghost-quiet` and
  `ghost-fade` all render muted ink on no fill at Rest; their difference is hover behavior and
  `aria-hidden`, which the set has no axis for.
- **`icon-lg` is the one dead value that stays declared.** Zero call sites, but it was drawn before
  decision-94, and that decision does not delete unused variants.
- **One attribute, two semantics.** `aria-disabled` means "blocked but explainable, stays live" on
  Button and "inert" on Sidebar / Menu. Both predate the current sets; the split is recorded so it
  is a decision rather than a coincidence.
