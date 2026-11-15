---
"isnadibot": patch
---

Writing a file no longer asks for approval as if it were deleting or sending
something. Both command classifiers read the whole raw command, so the text
inside a heredoc body — a README saying "delete a todo", a script importing
`node:crypto` — was read as the command's intent. Bodies are now stripped
before classifying, in every quoting form the shell accepts.

A `<<` is only an opener where the shell reads it as one: not inside a quoted
string, a `#` comment or the `<<<` here-string, and not in an arithmetic region
such as `$((1 << n))` or `$[1<<k]` where it is a shift. An arithmetic region is
tracked by nesting depth and across line breaks, so a region spread over several
lines, or a subscript such as `$[ a[1] << k ]` whose own bracket is not the
region's, is still read as arithmetic.

Where the scanner cannot prove what a `<<` is — `${…}`, `$'…'`, `$"…"` and
`$(…)`, a backtick, a continued line, a delimiter the shell expands, a quote or
region still open at the end, an opener with no terminator — it now strips
nothing at all and the command is classified as it is written. Naming the
regions one at a time lost a construct per review round, and each one was a way
to run `rm -rf` with no approval prompt; refusing to guess keeps that from being
the next round's finding. Over-classifying costs a prompt, under-classifying
costs the approval.
