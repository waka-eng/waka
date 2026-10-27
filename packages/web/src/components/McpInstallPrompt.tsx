import { formatMessage, t, type SupportedLocale } from '../lib/locales';
import { mcpClientName, mcpSetupPrompt, type McpAuthMethod, type McpClient, type McpScope } from '../lib/mcp-setup';
import { McpCopyBlock } from './McpCopyBlock';

export function McpInstallPrompt({ locale, profile, apiUrl, packageOrigin, client, scope, authMethod, hideCopy = false, onCopied, onCopyFailed }: {
  locale: SupportedLocale;
  profile: { id: string; name: string };
  apiUrl: string;
  packageOrigin: string;
  client: McpClient;
  scope: McpScope;
  authMethod: McpAuthMethod;
  hideCopy?: boolean;
  onCopied?: () => void;
  onCopyFailed?: () => void;
}): JSX.Element {
  return <>
    <p className="waka-settings-note">{formatMessage(locale,
      authMethod === 'key' ? 'profileMcpPromptKeyHint' : 'profileMcpPromptHint', { client: mcpClientName(client) })}</p>
    <McpCopyBlock locale={locale} prompt scrollable mode={hideCopy ? 'text' : 'full'} copyLabel={t(locale, 'profileMcpCopySetupPrompt')}
      onCopied={onCopied} onCopyFailed={onCopyFailed}
      text={mcpSetupPrompt({ locale, profile, apiUrl, packageOrigin, client, scope, authMethod })} />
  </>;
}
