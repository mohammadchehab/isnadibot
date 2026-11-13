---
"isnadibot": patch
---

The desktop's egress tunnel no longer buffers without limit: a destination that sends faster than the server reads is paused instead of filling desktop memory, and a lookup or connection that hangs is refused after ten seconds instead of holding the stream. When a profile leaves the desktop's egress binding, the tunnel reconnects from the store's current state.
