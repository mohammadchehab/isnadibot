---
"isnadibot": patch
---

Connecting an MCP server now says why the server's sign-in provider turned the app down. IsnadiBot registers itself with the provider to sign in, and it was offering more callback addresses than some providers accept, so a provider with a ten-address limit refused the registration and the app only said the server could not be reached. The app now offers ten addresses, and a refused registration reports the provider's own reason instead of a generic failure.
