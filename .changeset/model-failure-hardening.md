---
---

Internal hardening of the model-failure classifier: bounded patterns, a capped classification head, a
parsed and capped `Retry-After`, and the rule that an `unavailable` failure never crosses provider
instances. No user-visible change until the fallback router reads these.
