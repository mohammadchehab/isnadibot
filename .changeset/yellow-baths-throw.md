---
---

Empty on purpose: the change is a test snapshot only. TASK-354 moved the memory fallback out of a
direct `t()` call, so the i18n inventory counts one fewer direct message; the snapshot now records
that count. No shipped string and no runtime code changes.
