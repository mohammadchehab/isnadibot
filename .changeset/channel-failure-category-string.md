---
"isnadibot": patch
---

A channel failure from a newer server no longer arrives as a parse error. The failure category
crosses the wire as a plain string, so a build that predates a category still shows the server's
message instead of losing it.
