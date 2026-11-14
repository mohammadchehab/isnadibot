---
"isnadibot": patch
---

A provider failure from a newer server no longer arrives as a parse error. The reason a provider
could not run now crosses the wire as a plain string, in the dispatch error, in a chat's session and
latest turn, and on a channel binding. A build that predates a reason still shows the server's own
message instead of losing it.
