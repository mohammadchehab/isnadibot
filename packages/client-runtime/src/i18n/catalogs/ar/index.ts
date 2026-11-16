import { rosterCatalog } from "./roster.ts";
import { connectionsCatalog } from "./connections.ts";
import { chatCatalog } from "./chat.ts";
import { settingsCatalog } from "./settings.ts";
import { memoryCatalog } from "./memory.ts";
import { commonCatalog } from "./common.ts";
import { browserAuthCatalog } from "./browserAuth.ts";
import { refusalsCatalog } from "./refusals.ts";
import { fleetCatalog } from "./fleet.ts";
import { skillsCatalog } from "./skills.ts";

export const arCatalog = {
  ...rosterCatalog,
  ...connectionsCatalog,
  ...chatCatalog,
  ...settingsCatalog,
  ...memoryCatalog,
  ...commonCatalog,
  ...browserAuthCatalog,
  ...refusalsCatalog,
  ...fleetCatalog,
  ...skillsCatalog,
} as const;
