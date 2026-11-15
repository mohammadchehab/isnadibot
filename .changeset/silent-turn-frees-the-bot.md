---
"isnadibot": patch
---

A bot whose turn goes quiet no longer keeps showing Busy, and your next message starts a new turn without pressing Stop first. A quiet turn that never resumes is now closed for you instead of staying open forever, after a window that each provider declares for itself rather than one number shared by all of them. When that happens the chat says the turn stopped responding and was closed, which is a different message from a provider session that went away. A turn left open when its provider session disappeared is still settled at startup.
