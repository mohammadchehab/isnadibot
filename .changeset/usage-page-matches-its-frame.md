---
"@isnadi/web": patch
---

The Usage page now looks like the page it was drawn as: stacked bars, a period menu, and a by-time table in plain words.

The activity plot used to be a smooth line per provider over an unlabelled scale. It is now one stacked bar per period, each band a provider's share of that period's cost or tokens, with six dates under it and a hover that reads out every provider plus the total.

The window is a menu — Past 24 hours, Past 7 days, Past 30 days, Past 90 days — instead of a row of toggles, and the chart sits in a bordered card. The breakdown below is one card whose title follows the toggle, and its by-time view is a Period / Cost / Tokens table rather than a column per provider, so it fits a phone. The provider list collapses to a single line per provider below `sm`, and the page carries a back control in its top bar.

While a page load is in flight the placeholders now hold still instead of sweeping, because a loop that never settles reads as a stuck page. A failed environment's row is red with a Retry button.
