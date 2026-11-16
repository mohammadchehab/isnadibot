---
"@isnadi/web": patch
---

A bot that hits an unexpected internal error no longer sends that error's text to your other devices. When the server fails in a way it did not plan for, every paired client now receives a plain "Internal server error" instead of the raw message, which could carry file paths or other private details. Failures the app reports on purpose are unchanged.
