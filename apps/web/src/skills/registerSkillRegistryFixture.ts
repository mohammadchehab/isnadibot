import {
  createSkillRegistryFixture,
  registerSkillRegistrySource,
  SKILL_FIXTURE_SCENARIOS,
  type SkillFixtureScenario,
} from "@isnadi/client-runtime/skills";

/** `?skills=empty` picks a state to review; without it the full fixture shows. */
const FIXTURE_QUERY_PARAM = "skills";

function scenarioFromSearch(search: string): SkillFixtureScenario | undefined {
  const requested = new URLSearchParams(search).get(FIXTURE_QUERY_PARAM);

  return SKILL_FIXTURE_SCENARIOS.find((scenario) => scenario === requested);
}

/**
 * Registers the DEV-only skill registry behind the seam. A shipped build registers the empty
 * source, so the Skills tab and the Settings row are absent exactly as they are today; the
 * gate lives here, once per platform, rather than in each screen.
 *
 * The fixtures are not opt-in behind a flag of their own: they are how the skills screens are
 * reviewed before phase 1, so a dev run shows them.
 */
export function registerSkillRegistryFixture(): void {
  const scenario = scenarioFromSearch(window.location.search);

  registerSkillRegistrySource(
    createSkillRegistryFixture({
      dev: import.meta.env.DEV,
      ...(scenario === undefined ? {} : { scenario }),
    }),
  );
}
