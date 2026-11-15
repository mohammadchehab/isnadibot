---
---

Empty on purpose: the change is test-harness only. The browser-session bootstrap the server
suites share now retries a transport failure with a bounded budget, so a starved accept queue on a
loaded runner stops reding an unrelated PR. No shipped code path changes.
