export const WORKSPACE_HOME_PHOTO_SOURCE_ACCEPT = "image/*";
export const WORKSPACE_HOME_PHOTO_SOURCE_CAMERA = "camera";
export const WORKSPACE_HOME_PHOTO_SOURCE_GALLERY = "gallery";

export type WorkspaceHomePhotoSource =
  | typeof WORKSPACE_HOME_PHOTO_SOURCE_CAMERA
  | typeof WORKSPACE_HOME_PHOTO_SOURCE_GALLERY;

export type WorkspaceHomePhotoSourceIntakePath =
  | "camera-capture"
  | "gallery-selection";

export interface WorkspaceHomePhotoSourceInputAttributes {
  accept: typeof WORKSPACE_HOME_PHOTO_SOURCE_ACCEPT;
  capture?: "environment";
}

export interface WorkspaceHomePhotoSourceOption {
  buttonLabel: string;
  description: string;
  inputAttributes: WorkspaceHomePhotoSourceInputAttributes;
  inputId: string;
  intakePath: WorkspaceHomePhotoSourceIntakePath;
  source: WorkspaceHomePhotoSource;
}

const WORKSPACE_HOME_PHOTO_SOURCE_OPTIONS: Record<
  WorkspaceHomePhotoSource,
  WorkspaceHomePhotoSourceOption
> = {
  camera: {
    buttonLabel: "Use camera",
    description: "Open the device camera for a fresh capture.",
    inputAttributes: {
      accept: WORKSPACE_HOME_PHOTO_SOURCE_ACCEPT,
      capture: "environment",
    },
    inputId: "workspace-photo-camera-input",
    intakePath: "camera-capture",
    source: WORKSPACE_HOME_PHOTO_SOURCE_CAMERA,
  },
  gallery: {
    buttonLabel: "Choose from gallery",
    description: "Pick an existing image from the device library.",
    inputAttributes: {
      accept: WORKSPACE_HOME_PHOTO_SOURCE_ACCEPT,
    },
    inputId: "workspace-photo-gallery-input",
    intakePath: "gallery-selection",
    source: WORKSPACE_HOME_PHOTO_SOURCE_GALLERY,
  },
};

export function getWorkspaceHomePhotoSourceOption(
  source: WorkspaceHomePhotoSource,
): WorkspaceHomePhotoSourceOption {
  return WORKSPACE_HOME_PHOTO_SOURCE_OPTIONS[source];
}

export function getWorkspaceHomePhotoSourceOptions(): readonly WorkspaceHomePhotoSourceOption[] {
  return [
    getWorkspaceHomePhotoSourceOption(WORKSPACE_HOME_PHOTO_SOURCE_CAMERA),
    getWorkspaceHomePhotoSourceOption(WORKSPACE_HOME_PHOTO_SOURCE_GALLERY),
  ];
}
