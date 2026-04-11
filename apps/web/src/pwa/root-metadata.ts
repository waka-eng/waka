import type { Metadata } from "next";

import {
  WAKA_APPLE_TOUCH_ICON_120_PATH,
  WAKA_APPLE_TOUCH_ICON_152_PATH,
  WAKA_APPLE_TOUCH_ICON_167_PATH,
  WAKA_APPLE_TOUCH_ICON_PATH,
  WAKA_APP_DESCRIPTION,
  WAKA_APP_NAME,
  WAKA_ICON_16_PATH,
  WAKA_ICON_192_PATH,
  WAKA_ICON_32_PATH,
  WAKA_MANIFEST_PATH,
  WAKA_ROOT_METADATA_ICON_PATHS,
  WAKA_THEME_COLOR,
} from "./install-metadata.ts";

export const WAKA_ROOT_VIEWPORT_CONFIG = {
  width: "device-width",
  initialScale: 1,
  themeColor: WAKA_THEME_COLOR,
  colorScheme: "dark",
} as const;

export const WAKA_ROOT_METADATA_APPLE_ICONS = [
  {
    url: WAKA_APPLE_TOUCH_ICON_PATH,
    sizes: "180x180",
    type: "image/png",
  },
  {
    url: WAKA_APPLE_TOUCH_ICON_167_PATH,
    sizes: "167x167",
    type: "image/png",
  },
  {
    url: WAKA_APPLE_TOUCH_ICON_152_PATH,
    sizes: "152x152",
    type: "image/png",
  },
  {
    url: WAKA_APPLE_TOUCH_ICON_120_PATH,
    sizes: "120x120",
    type: "image/png",
  },
] satisfies NonNullable<Metadata["icons"]> extends infer TIcons
  ? TIcons extends { apple?: infer TApple }
    ? Extract<TApple, unknown[]>
    : never
  : never;

export const WAKA_ROOT_METADATA_ICONS = [
  {
    url: WAKA_ICON_16_PATH,
    sizes: "16x16",
    type: "image/png",
  },
  {
    url: WAKA_ICON_32_PATH,
    sizes: "32x32",
    type: "image/png",
  },
  {
    url: WAKA_ICON_192_PATH,
    sizes: "192x192",
    type: "image/png",
  },
] satisfies NonNullable<Metadata["icons"]> extends infer TIcons
  ? TIcons extends { icon?: infer TIcon }
    ? Extract<TIcon, unknown[]>
    : never
  : never;

export const WAKA_ROOT_METADATA_SHORTCUT_ICONS = [
  {
    url: WAKA_ICON_32_PATH,
    sizes: "32x32",
    type: "image/png",
  },
] satisfies NonNullable<Metadata["icons"]> extends infer TIcons
  ? TIcons extends { shortcut?: infer TShortcut }
    ? Extract<TShortcut, unknown[]>
    : never
  : never;

export const WAKA_ROOT_METADATA_APPLE_WEB_APP = {
  capable: true,
  title: WAKA_APP_NAME,
  statusBarStyle: "black-translucent",
} satisfies NonNullable<Metadata["appleWebApp"]>;

export const WAKA_ROOT_METADATA_CONFIG = {
  applicationName: WAKA_APP_NAME,
  title: WAKA_APP_NAME,
  description: WAKA_APP_DESCRIPTION,
  manifest: WAKA_MANIFEST_PATH,
  appleWebApp: WAKA_ROOT_METADATA_APPLE_WEB_APP,
  icons: {
    apple: WAKA_ROOT_METADATA_APPLE_ICONS,
    icon: WAKA_ROOT_METADATA_ICONS,
    shortcut: WAKA_ROOT_METADATA_SHORTCUT_ICONS,
  },
} satisfies Metadata;

export { WAKA_ROOT_METADATA_ICON_PATHS };
