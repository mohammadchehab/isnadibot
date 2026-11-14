---
"isnadibot": patch
---

Deleting a group from the roster now tells you what the delete costs before it happens. When the group still holds open work items, the confirmation dialog names the count, its button reads "Delete and discard", and the app sends `discardWorkItems` only because you saw that number and confirmed it. A group with no open work keeps the plain "Delete group" dialog and never sends the flag. The two refusals the server can return — open work that was not confirmed for discard, and a person without `access:write` — now arrive as specific messages instead of the generic "Something went wrong" toast.
