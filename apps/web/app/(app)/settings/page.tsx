import { SettingsPage } from "./settings-page.ts";
import { createSettingsApiKeysDependenciesFromCookies } from "../../../src/auth/runtime.ts";
import { createCurrentWorkspaceSettingsApiKeysLoader } from "../../../src/auth/api-key-settings-loader.ts";

export default async function SettingsPageEntry() {
  return (
    <SettingsPage
      loadApiKeys={createCurrentWorkspaceSettingsApiKeysLoader(
        await createSettingsApiKeysDependenciesFromCookies(),
      )}
    />
  );
}
