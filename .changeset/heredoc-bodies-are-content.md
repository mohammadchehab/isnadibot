---
"isnadibot": patch
---

Writing a file no longer asks for approval as if it were deleting or sending
something. Both command classifiers read the whole raw command, so the text
inside a heredoc body — a README saying "delete a todo", a script importing
`node:crypto` — was read as the command's intent. Bodies are now stripped
before classifying, in every quoting form the shell accepts.

An unterminated heredoc is deliberately left whole: it swallows the rest of the
command, so dropping what follows a stray opener would hide a real destructive
command behind it. A `<<` inside a quoted string or a comment, the `<<<`
here-string, and an arithmetic region such as `$((1 << n))` or `$[1<<k]` where
it is a shift, are text rather than operators, so they open nothing — otherwise
a command could hide its destructive part behind a `<<` the shell never runs.
