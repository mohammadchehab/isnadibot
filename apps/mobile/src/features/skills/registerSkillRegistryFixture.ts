import {
  createSkillRegistryFixture,
  registerSkillRegistrySource,
} from "@isnadi/client-runtime/skills";

import { DEV_FIXTURES_ENABLED } from "../../dev-fixtures";

/**
 * Registers the DEV-only skill registry behind the seam. A shipped build registers the empty
 * source, so the Skills row and the screen behind it are absent exactly as they are today; the
 * gate lives here, once per platform, rather than in each screen.
 */
export function registerSkillRegistryFixture(): void {
  registerSkillRegistrySource(createSkillRegistryFixture({ dev: DEV_FIXTURES_ENABLED }));
}
