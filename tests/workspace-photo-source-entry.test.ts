import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  getWorkspaceHomePhotoSourceOption,
  getWorkspaceHomePhotoSourceOptions,
  WORKSPACE_HOME_PHOTO_SOURCE_ACCEPT,
  WORKSPACE_HOME_PHOTO_SOURCE_CAMERA,
  WORKSPACE_HOME_PHOTO_SOURCE_GALLERY,
} from "../apps/web/src/home/photo-source-entry.ts";

const WORKSPACE_CAPTURE_BAR_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-capture-bar.tsx",
);

test("photo source options expose camera and gallery intake paths", () => {
  const photoSourceOptions = getWorkspaceHomePhotoSourceOptions();
  const cameraOption = getWorkspaceHomePhotoSourceOption(
    WORKSPACE_HOME_PHOTO_SOURCE_CAMERA,
  );
  const galleryOption = getWorkspaceHomePhotoSourceOption(
    WORKSPACE_HOME_PHOTO_SOURCE_GALLERY,
  );

  assert.deepEqual(
    photoSourceOptions.map((option) => option.source),
    [WORKSPACE_HOME_PHOTO_SOURCE_CAMERA, WORKSPACE_HOME_PHOTO_SOURCE_GALLERY],
  );
  assert.equal(cameraOption.buttonLabel, "Use camera");
  assert.equal(
    cameraOption.description,
    "Open the device camera for a fresh capture.",
  );
  assert.equal(cameraOption.inputAttributes.accept, WORKSPACE_HOME_PHOTO_SOURCE_ACCEPT);
  assert.equal(cameraOption.inputAttributes.capture, "environment");
  assert.equal(cameraOption.intakePath, "camera-capture");

  assert.equal(galleryOption.buttonLabel, "Choose from gallery");
  assert.equal(
    galleryOption.description,
    "Pick an existing image from the device library.",
  );
  assert.equal(galleryOption.inputAttributes.accept, WORKSPACE_HOME_PHOTO_SOURCE_ACCEPT);
  assert.equal(galleryOption.inputAttributes.capture, undefined);
  assert.equal(galleryOption.intakePath, "gallery-selection");
});

test("workspace capture bar wires the photo source chooser to source-specific file inputs", () => {
  const source = readFileSync(WORKSPACE_CAPTURE_BAR_COMPONENT_PATH, "utf8");

  assert.match(source, /handlePhotoSourceChooserToggle/);
  assert.match(source, /queueWorkspaceHomePhotoDraftUpload/);
  assert.match(source, /handlePhotoDraftUploadRetry/);
  assert.match(source, /handlePhotoDraftUploadCancel/);
  assert.match(source, /resetWorkspaceHomePhotoDraft/);
  assert.match(source, /openWorkspaceHomePhotoIntake/);
  assert.match(source, /handlePhotoSourceFileSelection/);
  assert.match(source, /uploadWorkspaceHomePhotoDraft/);
  assert.match(source, /markWorkspaceHomePhotoDraftUploadPending/);
  assert.match(source, /resetWorkspaceHomePhotoDraftUploadState/);
  assert.match(source, /createWorkspaceHomePhotoDraftReadyState/);
  assert.match(source, /AbortController/);
  assert.match(source, /prepareWorkspaceHomeCameraPhotoDraft/);
  assert.match(source, /prepareWorkspaceHomeSelectedPhotoDraft/);
  assert.match(source, /releaseWorkspaceHomePhotoDraftPreview/);
  assert.match(source, /WORKSPACE_HOME_PHOTO_SOURCE_CAMERA/);
  assert.match(source, /data-photo-source-toggle=/);
  assert.match(source, /aria-controls="workspace-photo-source-chooser"/);
  assert.match(source, /aria-expanded=\{isPhotoSourceChooserOpen\}/);
  assert.match(source, /data-photo-source-chooser="open"/);
  assert.match(source, /data-photo-source-trigger=/);
  assert.match(source, /data-photo-source-input=/);
  assert.match(source, /data-photo-intake-path=/);
  assert.match(source, /Add photo/);
  assert.match(source, /photoSourceOptions\.map/);
  assert.match(source, /photoSourceOption\.buttonLabel/);
  assert.match(source, /photoSourceOption\.description/);
  assert.match(source, /capture=\{photoSourceOption\.inputAttributes\.capture\}/);
  assert.match(source, /if \(source === WORKSPACE_HOME_PHOTO_SOURCE_CAMERA\)/);
  assert.match(source, /photoSourceInput\.click\(\)/);
  assert.match(source, /queueWorkspaceHomePhotoDraftUpload\(photoDraftResult\.draft\)/);
  assert.match(source, /setPhotoCaptureResult\(photoDraftResult\)/);
  assert.match(source, /data-pending-photo-draft=/);
  assert.match(source, /data-photo-draft-upload-state=/);
  assert.match(source, /data-photo-draft-upload-progress=/);
  assert.match(source, /data-photo-draft-retry-action=/);
  assert.match(source, /data-photo-draft-cancel-action=/);
  assert.match(source, /data-photo-draft-reset-action=/);
  assert.match(
    source,
    /className="grid min-w-0 gap-2 min-\[56rem\]:grid-cols-\[repeat\(auto-fit,minmax\(16rem,1fr\)\)\]"/,
  );
  assert.match(source, /className="text-xs leading-5 text-sky-100\/70 md:col-span-2"/);
  assert.match(source, /pendingPhotoCapture\.preview\.objectUrl/);
  assert.match(source, /pendingPhotoCapture\.uploadState\.progressPercent/);
  assert.match(
    source,
    /Local draft kept until you retry or reset it\./,
  );
  assert.match(
    source,
    /Cancel keeps the local photo draft available for retry\./,
  );
  assert.match(source, /photoCaptureResult\.status === "ready"/);
});
