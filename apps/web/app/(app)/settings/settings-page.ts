import { Suspense, createElement as h, type ReactElement, type ReactNode } from "react";

import type { SettingsApiKeysData } from "../../../src/auth/api-key-settings-loader.ts";
import { AuthenticatedAppPageOutlet } from "../../../src/shell/authenticated-app-page-outlet.tsx";
import { SettingsApiKeysClientSection } from "./settings-api-keys-client.tsx";
import {
  SETTINGS_API_KEYS_LOADING_MESSAGE,
  SETTINGS_API_KEYS_SECTION_DESCRIPTION,
  SETTINGS_API_KEYS_SECTION_TITLE,
} from "./settings-page-model.ts";

export type SettingsPageApiKeysLoader = () => Promise<SettingsApiKeysData>;

export interface SettingsPageProps {
  loadApiKeys?: SettingsPageApiKeysLoader;
}

const DEFAULT_SETTINGS_PAGE_API_KEYS_DATA: SettingsApiKeysData = {
  apiKeys: [],
};

const DEFAULT_SETTINGS_PAGE_API_KEYS_LOADER: SettingsPageApiKeysLoader =
  async function loadDefaultSettingsPageApiKeys() {
    return DEFAULT_SETTINGS_PAGE_API_KEYS_DATA;
  };

const settingsApiKeysSectionComponent =
  SettingsApiKeysSection as unknown as (
    props: SettingsPageProps,
  ) => ReactElement;

const settingsCardClassName =
  "waka-primary-section rounded-3xl border border-stone-200 bg-white shadow-[0_18px_50px_rgba(41,37,36,0.06)]";

const settingsPageHeader = {
  description:
    "Manage the keys that let the CLI and other tools save into this workspace without exposing your account.",
  eyebrow: "Settings",
  title: "Connect your tools safely.",
};

function createSettingsPageContent(content: ReactNode): ReactElement {
  return h(
    AuthenticatedAppPageOutlet,
    {
      "data-page": "settings",
      "data-layout": "settings-content",
      header: settingsPageHeader,
    },
    [
      h(
        "section",
        {
          key: "overview",
          className: settingsCardClassName,
        },
        [
          h(
            "h2",
                {
                  key: "title",
                  className: "text-lg font-medium text-stone-950",
                },
                "Access from other tools",
              ),
          h(
            "p",
                {
                  key: "body",
                  className: "mt-3 max-w-3xl text-sm leading-6 text-stone-600",
                },
                "Create an API key for the CLI or another tool that saves into Waka. You'll only see the full key once, and you can revoke access at any time.",
          ),
        ],
      ),
      h("div", { key: "content" }, content),
    ],
  );
}

function createApiKeysSectionShell(content: ReactNode): ReactElement {
  return h(
    "section",
    {
      className: settingsCardClassName,
    },
    [
      h(
        "div",
        {
          key: "header",
          className:
            "flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:justify-between",
        },
        [
          h(
            "div",
            {
              key: "copy",
              className: "min-w-0 space-y-2",
            },
            [
              h(
                "h2",
                {
                  key: "title",
                  className: "text-lg font-medium text-stone-950",
                },
                SETTINGS_API_KEYS_SECTION_TITLE,
              ),
              h(
                "p",
                {
                  key: "description",
                  className: "max-w-3xl break-words text-sm leading-6 text-stone-600",
                },
                SETTINGS_API_KEYS_SECTION_DESCRIPTION,
              ),
            ],
          ),
        ],
      ),
      h(
        "div",
        {
          key: "content",
          className: "mt-6 space-y-6",
        },
        content,
      ),
    ],
  );
}

export async function SettingsApiKeysSection({
  loadApiKeys = DEFAULT_SETTINGS_PAGE_API_KEYS_LOADER,
}: SettingsPageProps = {}): Promise<ReactElement> {
  return h(SettingsApiKeysClientSection, {
    initialData: await loadApiKeys(),
  });
}

export function SettingsApiKeysLoadingState(): ReactElement {
  return createApiKeysSectionShell(
    h(
      "div",
      {
        className: "space-y-4",
      },
      [
        h(
          "p",
          {
            key: "copy",
            className: "text-sm text-stone-600",
          },
          SETTINGS_API_KEYS_LOADING_MESSAGE,
        ),
        h(
          "div",
          {
            key: "skeleton-1",
            className:
              "h-24 animate-pulse rounded-3xl border border-stone-200 bg-stone-100",
          },
        ),
        h(
          "div",
          {
            key: "skeleton-2",
            className:
              "h-24 animate-pulse rounded-3xl border border-stone-200 bg-stone-100",
          },
        ),
      ],
    ),
  );
}

export function SettingsPage({
  loadApiKeys = DEFAULT_SETTINGS_PAGE_API_KEYS_LOADER,
}: SettingsPageProps = {}): ReactElement {
  return createSettingsPageContent(
    h(
      Suspense,
      {
        fallback: h(SettingsApiKeysLoadingState),
      },
      h(settingsApiKeysSectionComponent, {
        loadApiKeys,
      }),
    ),
  );
}

export function SettingsPageLoading(): ReactElement {
  return createSettingsPageContent(h(SettingsApiKeysLoadingState));
}
