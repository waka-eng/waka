export const WAKA_APP_NAME = "Waka";
export const WAKA_APP_DESCRIPTION = "Capture-first inspiration engine";
export const WAKA_SERVICE_WORKER_PATH = "/sw.js";
export const WAKA_SERVICE_WORKER_SCOPE = "/";
export const WAKA_MANIFEST_PATH = "/manifest.webmanifest";
export const WAKA_THEME_COLOR = "#0c0a09";
export const WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH = "/dashboard";
export const WAKA_APP_SHELL_ROUTE_PATHS = [
  "/",
  WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH,
  "/settings",
] as const;
export const WAKA_APPLE_TOUCH_ICON_PATH = "/icons/apple-touch-icon.png";
export const WAKA_APPLE_TOUCH_ICON_167_PATH = "/icons/apple-touch-icon-167.png";
export const WAKA_APPLE_TOUCH_ICON_152_PATH = "/icons/apple-touch-icon-152.png";
export const WAKA_APPLE_TOUCH_ICON_120_PATH = "/icons/apple-touch-icon-120.png";
export const WAKA_APPLE_TOUCH_ICON_PATHS = [
  WAKA_APPLE_TOUCH_ICON_PATH,
  WAKA_APPLE_TOUCH_ICON_167_PATH,
  WAKA_APPLE_TOUCH_ICON_152_PATH,
  WAKA_APPLE_TOUCH_ICON_120_PATH,
] as const;
export const WAKA_ICON_16_PATH = "/icons/icon-16.png";
export const WAKA_ICON_32_PATH = "/icons/icon-32.png";
export const WAKA_ICON_192_PATH = "/icons/icon-192.png";
export const WAKA_ICON_512_PATH = "/icons/icon-512.png";
export const WAKA_ICON_MASKABLE_512_PATH = "/icons/icon-maskable-512.png";
export const WAKA_ROOT_METADATA_ICON_PATHS = [
  ...WAKA_APPLE_TOUCH_ICON_PATHS,
  WAKA_ICON_16_PATH,
  WAKA_ICON_32_PATH,
  WAKA_ICON_192_PATH,
] as const;
export const WAKA_INSTALLABLE_ICON_PATHS = [
  ...WAKA_ROOT_METADATA_ICON_PATHS,
  WAKA_ICON_512_PATH,
  WAKA_ICON_MASKABLE_512_PATH,
] as const;
export const WAKA_INSTALLABILITY_ASSET_PATHS = [
  WAKA_MANIFEST_PATH,
  ...WAKA_INSTALLABLE_ICON_PATHS,
] as const;
export const WAKA_SERVICE_WORKER_PRECACHE_PATHS = [
  ...WAKA_APP_SHELL_ROUTE_PATHS,
  ...WAKA_INSTALLABILITY_ASSET_PATHS,
] as const;
