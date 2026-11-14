import { assert, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { OrchestrationBot } from "./roster.ts";

const decodeBot = Schema.decodeUnknownSync(OrchestrationBot);

const timestamp = "2026-11-14T09:00:00.000Z";

const botWithChannel = (failureCategory: string) => ({
  id: "bot-1",
  name: "Ada",
  title: "Engineer",
  avatar: { kind: "dither", seed: "ada" },
  engine: null,
  sandbox: null,
  groupId: null,
  archivedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  channelBindings: [
    {
      botId: "bot-1",
      provider: "slack",
      status: "failed",
      externalIdentity: null,
      connectedAt: null,
      lastError: "Slack rejected the bot token.",
      failureCategory,
    },
  ],
});

it("decodes a channel binding carrying a failure category this build knows", () => {
  const bot = decodeBot(botWithChannel("credentials"));

  assert.strictEqual(bot.channelBindings[0]?.failureCategory, "credentials");
});

it("keeps the whole bot when a newer server names a failure category this build does not know", () => {
  const bot = decodeBot(botWithChannel("rate-limited"));

  assert.strictEqual(bot.channelBindings[0]?.failureCategory, "rate-limited");
  assert.strictEqual(bot.channelBindings[0]?.lastError, "Slack rejected the bot token.");
  assert.strictEqual(bot.name, "Ada");
});
