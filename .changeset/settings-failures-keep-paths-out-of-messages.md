---
"@isnadi/web": patch
---

A failure while saving settings, opening an editor, or signing in to a provider now says what went wrong in plain words, instead of printing a file path, a provider instance id, or an environment variable name on screen. Those details stay in the log.

Settings failures also say what failed again: reading the settings, saving them, storing or removing an API key, or rejecting invalid sandbox values each get their own sentence, rather than one line covering all of them.
