---
"isnadibot": patch
---

Turning on **Keep everyone busy** now starts a freshly hired team working. A bot has no chat until
someone opens one, and the dispatcher used to pass over a bot in that state, so a new team sat idle
with its cards queued and nothing happening. The dispatcher now opens the missing chat itself, the
same way the app would, and starts the turn in it. It files that chat where the team already talks,
and waits instead of guessing when the workspace holds several projects and nothing says which one
the work belongs in.
