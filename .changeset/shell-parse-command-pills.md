---
"isnadibot": patch
---

A command's approval pills now come from one shell parse, so a read-only command that redirects a descriptor (`2>&1`) or writes to `/dev/null` is no longer tagged "Writes files", and a program named only inside a quoted argument (`grep "git push" log`) no longer raises its pill.
