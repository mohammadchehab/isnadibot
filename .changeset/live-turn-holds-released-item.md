---
"isnadibot": patch
---

Moving a bot out of a group, or taking an item off a bot by hand, no longer lets a second bot pick up that item while the first bot is still working it. The item goes back to the queue as before, but the keep-busy dispatcher leaves it alone until the turn that was working it finishes, and then wakes the item's current group so exactly one bot picks it up.
