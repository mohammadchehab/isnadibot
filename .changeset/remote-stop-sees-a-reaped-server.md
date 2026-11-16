---
"@isnadi/desktop": patch
---

Stopping a remote Isnadi server no longer reports a timeout for a server that already stopped. On a busy machine the exited server can linger as a process its parent has not reaped yet, which the stop check read as still running: the stop then kept its ownership files and told you it had timed out.
