---
"@isnadi/web": patch
---

Leaving bot settings right after a save no longer asks "Discard unsaved bot settings?". The page now remembers what it last saved, so a save that has not reached the screen yet still counts as saved, while a real change made after it still asks before it is dropped.
