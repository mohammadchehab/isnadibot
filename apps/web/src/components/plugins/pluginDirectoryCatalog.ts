import { isDirectoryPlugin, loadDirectoryCatalog } from "../../../../../plugins";
import { buildPluginFilters } from "./pluginPresentation";

// The directory lists every entry that has not been retired. An installed plugin
// that later drops off it (a retired entry) must stay manageable, so the dialog
// resolves servers against the full catalog, not this list.
export const FULL_PLUGIN_CATALOG = loadDirectoryCatalog();

export const PLUGIN_DIRECTORY_CATALOG = FULL_PLUGIN_CATALOG.filter(isDirectoryPlugin);

export const PLUGIN_DIRECTORY_FILTERS = buildPluginFilters(PLUGIN_DIRECTORY_CATALOG);
