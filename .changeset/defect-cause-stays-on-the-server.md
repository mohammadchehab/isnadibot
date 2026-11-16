---
"isnadibot": patch
---

A failure a client receives no longer carries the server's internal error detail. Errors used to
put the underlying filesystem or provider failure on the wire, where every connected client
decoded its name, message and cause chain; that detail now stays on the server for its logs. The
structured fields a client already reads — the reason, the operation, the path — are unchanged.
