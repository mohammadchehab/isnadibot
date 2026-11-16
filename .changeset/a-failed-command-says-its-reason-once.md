---
"@isnadi/web": patch
---

A command that fails now sends its reason once. A server error used to carry the same sentence twice — including a host, port or folder path — which made the message harder to read and put the details on the wire twice.
