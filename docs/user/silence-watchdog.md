# When a bot goes quiet

Sometimes a provider stops sending anything while a bot is still working. After 90 seconds with no output, the chat stops showing the working indicator and says "No response from" the provider, for example "No response from Claude". The timer next to it counts from the last time the provider sent something.

The bot also gets one item in the inbox, labeled "Bot stopped responding". Isnadi does not stop the turn right away: it waits to see whether the provider comes back.

While the notice is up, the bot shows as idle rather than busy. Nothing is running that will answer.

- **Just send your next message.** You do not need to press Stop first: sending ends the quiet turn and starts a new one.
- If the provider starts responding again, the notice goes away, the turn carries on, and the inbox item resolves on its own.
- If the same turn goes quiet more than once, the same inbox item comes back instead of a new one.
- When the turn finishes or you stop it, the inbox item resolves.
- **If nothing comes back**, the quiet turn is ended for you and the chat says the turn stopped responding and was closed. Send a new message to carry on. How long the bot waits is different for each provider: it is how long that provider can reasonably stay quiet, so a long build or test run has room to finish first.

Time the bot spends waiting for your approval or your answer to a question does not count as silence.

A quiet stretch is not always a problem. Long builds, test runs, and large file reads can keep a provider busy without output. If providers go quiet often, check your connection to the environment and the provider's status page.
