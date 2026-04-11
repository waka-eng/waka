import path from "node:path";

export const RESPONSIVE_REGRESSION_BASELINE_SNAPSHOT_ROOT = path.join(
  "tests",
  "__snapshots__",
  "responsive",
);

export const RESPONSIVE_REGRESSION_BASELINE_SNAPSHOT_EXTENSION = ".png";

export type ResponsiveRegressionViewportPresetName =
  | "mobile"
  | "tablet"
  | "desktop";

export interface ResponsiveRegressionViewportPreset {
  baselineDirectory: string;
  displayName: string;
  height: number;
  name: ResponsiveRegressionViewportPresetName;
  snapshotSlug: string;
  width: number;
}

export interface ResponsiveRegressionBaselineSnapshotConfig {
  baselineDirectory: string;
  baselineName: string;
  fileName: string;
  path: string;
  viewport: ResponsiveRegressionViewportPreset;
}

export const RESPONSIVE_REGRESSION_VIEWPORT_PRESET_ORDER = [
  "mobile",
  "tablet",
  "desktop",
] as const satisfies readonly ResponsiveRegressionViewportPresetName[];

export const RESPONSIVE_REGRESSION_VIEWPORT_PRESETS = {
  mobile: {
    baselineDirectory: path.join(
      RESPONSIVE_REGRESSION_BASELINE_SNAPSHOT_ROOT,
      "mobile",
    ),
    displayName: "Mobile 375px",
    height: 812,
    name: "mobile",
    snapshotSlug: "mobile-375w",
    width: 375,
  },
  tablet: {
    baselineDirectory: path.join(
      RESPONSIVE_REGRESSION_BASELINE_SNAPSHOT_ROOT,
      "tablet",
    ),
    displayName: "Tablet 768px",
    height: 1024,
    name: "tablet",
    snapshotSlug: "tablet-768w",
    width: 768,
  },
  desktop: {
    baselineDirectory: path.join(
      RESPONSIVE_REGRESSION_BASELINE_SNAPSHOT_ROOT,
      "desktop",
    ),
    displayName: "Desktop 1440px",
    height: 900,
    name: "desktop",
    snapshotSlug: "desktop-1440w",
    width: 1440,
  },
} as const satisfies Record<
  ResponsiveRegressionViewportPresetName,
  ResponsiveRegressionViewportPreset
>;

export function sanitizeResponsiveRegressionBaselineName(
  baselineName: string,
): string {
  const sanitizedName = baselineName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  if (sanitizedName.length === 0) {
    throw new Error(
      "Responsive regression baseline names must include at least one letter or number.",
    );
  }

  return sanitizedName;
}

export function buildResponsiveRegressionBaselineSnapshotConfig(
  baselineName: string,
  viewportName: ResponsiveRegressionViewportPresetName,
): ResponsiveRegressionBaselineSnapshotConfig {
  const viewport = RESPONSIVE_REGRESSION_VIEWPORT_PRESETS[viewportName];
  const sanitizedBaselineName =
    sanitizeResponsiveRegressionBaselineName(baselineName);
  const fileName = `${sanitizedBaselineName}--${viewport.snapshotSlug}${RESPONSIVE_REGRESSION_BASELINE_SNAPSHOT_EXTENSION}`;

  return {
    baselineDirectory: viewport.baselineDirectory,
    baselineName: sanitizedBaselineName,
    fileName,
    path: path.join(viewport.baselineDirectory, fileName),
    viewport,
  };
}

export function buildResponsiveRegressionBaselineSnapshotMatrix(
  baselineName: string,
): ResponsiveRegressionBaselineSnapshotConfig[] {
  return RESPONSIVE_REGRESSION_VIEWPORT_PRESET_ORDER.map((viewportName) =>
    buildResponsiveRegressionBaselineSnapshotConfig(baselineName, viewportName),
  );
}
