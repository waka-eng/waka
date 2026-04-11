import {
  WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH,
  WAKA_APP_NAME,
  WAKA_ICON_192_PATH,
  WAKA_ICON_512_PATH,
  WAKA_ICON_MASKABLE_512_PATH,
  WAKA_SERVICE_WORKER_SCOPE,
  WAKA_THEME_COLOR,
} from "./install-metadata.ts";

export interface WakaWebManifestIcon {
  purpose?: "any" | "maskable";
  sizes: string;
  src: string;
  type: "image/png";
}

export interface WakaWebManifest {
  background_color: string;
  display: "standalone";
  icons: WakaWebManifestIcon[];
  name: string;
  short_name: string;
  scope: string;
  start_url: string;
  theme_color: string;
}

export function createWakaWebManifest(): WakaWebManifest {
  return {
    name: WAKA_APP_NAME,
    short_name: WAKA_APP_NAME,
    start_url: WAKA_APP_SHELL_DEFAULT_NAVIGATION_PATH,
    scope: WAKA_SERVICE_WORKER_SCOPE,
    display: "standalone",
    theme_color: WAKA_THEME_COLOR,
    background_color: WAKA_THEME_COLOR,
    icons: [
      {
        src: WAKA_ICON_192_PATH,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: WAKA_ICON_512_PATH,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: WAKA_ICON_MASKABLE_512_PATH,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

export function serializeWakaWebManifest(
  manifest: WakaWebManifest = createWakaWebManifest(),
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
