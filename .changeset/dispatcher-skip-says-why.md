---
"isnadibot": patch
---

The environment server's log now says why **Keep everyone busy** left a team's queue alone. Before
this, a group that waited all night looked exactly like a group that never woke: the reason existed
only as an in-process receipt nothing in a running server could read. Each skip now writes a line
naming the team, the reason, and the member and card when there were any. A team with nothing queued
says so only when the log level is set to debug, so the lines that mean something are not buried
under a routine one after every turn.
