// The rules moved to @isnadi/client-runtime so mobile reads the same ones
// (decision-106). This stays as the binding the web components import, and it
// must not grow logic of its own: a rule that lives here cannot reach the phone.
export {
  spaceSettingsState,
  type SpaceSettingsMember,
  type SpaceSettingsState,
  type SpaceSettingsTranslator,
} from "@isnadi/client-runtime/space/settings";
