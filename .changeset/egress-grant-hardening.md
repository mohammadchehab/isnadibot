---
---

Egress grants are fsynced before the rename, a grants file that cannot be read denies every host
instead of reading as empty, and stored grants are re-checked against the current rules on load.
Nothing user-visible until the grant UI lands in TASK-127.
