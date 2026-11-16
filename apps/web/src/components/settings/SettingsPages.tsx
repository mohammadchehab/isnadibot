import { BrowserSettingsSection } from "./BrowserSettings";
import { InboxSection } from "./InboxPanel";
import { ProvidersListSection } from "./ProviderDetailPage";
import { SandboxSettingsPanel } from "./SandboxSettingsPanel";
import { AdvancedSettingsSections, BotWorkspaceSettingsSection } from "./SettingsPanels";
import { SettingsPageContainer } from "./settingsLayout";
import { SkillRegistryPage } from "../skills/SkillRegistryPage";
import { VoiceSettingsSection } from "./VoiceSettings";

// Pages that combine sections from several panels. Each section keeps its own
// anchor id so search results and deep links still land on the right row.

export function ProvidersSettingsPage() {
  return (
    <SettingsPageContainer>
      <ProvidersListSection />
      <VoiceSettingsSection />
    </SettingsPageContainer>
  );
}

export function SandboxSettingsPage() {
  return (
    <SettingsPageContainer>
      <BotWorkspaceSettingsSection />
      <SandboxSettingsPanel />
    </SettingsPageContainer>
  );
}

export function BrowserSettingsPage() {
  return (
    <SettingsPageContainer>
      <BrowserSettingsSection />
    </SettingsPageContainer>
  );
}

export function SkillsSettingsPage() {
  return (
    <SettingsPageContainer>
      {/* Settings lists every space's skills, so it opens on `All skills` rather than the
          space tab's narrower default. */}
      <SkillRegistryPage defaultFilter="all" />
    </SettingsPageContainer>
  );
}

export function AdvancedSettingsPage() {
  return (
    <SettingsPageContainer>
      {/* The bot inbox keeps its `errors` anchor so old inbox and error links land here. */}
      <InboxSection />
      <AdvancedSettingsSections />
    </SettingsPageContainer>
  );
}
