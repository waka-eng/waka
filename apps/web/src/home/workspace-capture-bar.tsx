"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { usePathname } from "next/navigation";

import {
  createWorkspaceHomePhotoDraftReadyState,
  markWorkspaceHomePhotoDraftUploadPending,
  prepareWorkspaceHomeCameraPhotoDraft,
  prepareWorkspaceHomeSelectedPhotoDraft,
  releaseWorkspaceHomePhotoDraftPreview,
  resetWorkspaceHomePhotoDraftUploadState,
  WORKSPACE_HOME_PHOTO_CAPTURE_IDLE_HELPER_TEXT,
  type WorkspaceHomePhotoDraft,
  type WorkspaceHomePhotoDraftResult,
} from "./photo-capture.ts";
import { uploadWorkspaceHomePhotoDraft } from "./photo-draft-upload.ts";
import {
  getWorkspaceHomePhotoSourceOptions,
  WORKSPACE_HOME_PHOTO_SOURCE_CAMERA,
  type WorkspaceHomePhotoSource,
} from "./photo-source-entry.ts";
import {
  createWorkspaceHomeTextCapture,
  queueWorkspaceHomeTextCapture,
  replayWorkspaceHomeQueuedCaptures,
  shouldQueueWorkspaceHomeTextCaptureFailure,
} from "./text-capture-create.ts";
import { OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT } from "../offline/online-state-listener.ts";
import { createReconnectReplayController } from "../offline/reconnect-replay-controller.ts";
import {
  createWorkspaceHomeVoiceCaptureErrorState,
  getWorkspaceHomeVoiceCaptureHelperText,
  getWorkspaceHomeVoiceCaptureIdleState,
  getWorkspaceHomeVoiceCaptureRecordingState,
  getWorkspaceHomeVoiceCaptureStatusLabel,
  readWorkspaceHomeVoiceCaptureErrorMessage,
  startWorkspaceHomeVoiceCapture,
  stopWorkspaceHomeVoiceCapture,
  type WorkspaceHomeVoiceCaptureSession,
} from "./voice-capture.ts";
import {
  createWorkspaceHomeOptimisticTextCapture,
  markWorkspaceHomeOptimisticCaptureFailed,
  markWorkspaceHomeOptimisticCaptureQueued,
  markWorkspaceHomeOptimisticCaptureSaved,
  prependWorkspaceHomeOptimisticCapture,
  WORKSPACE_HOME_CAPTURE_PLACEHOLDER,
  WORKSPACE_HOME_DESCRIPTION,
  WORKSPACE_HOME_TITLE,
} from "./workspace-home-screen-model.ts";
import { useWorkspaceHomeShellState } from "./workspace-home-shell-context.tsx";
import { StableControlLabel } from "../ui/stable-control-label.tsx";

const WORKSPACE_CAPTURE_BAR_EYEBROW = "Private workspace";
const WORKSPACE_CAPTURE_BAR_CONTROL_BUTTON_CLASS_NAME =
  "inline-flex min-h-11 w-full max-w-full items-center justify-center gap-2.5 rounded-full border px-4 py-2.5 text-center text-sm font-medium leading-5 whitespace-normal break-words transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5efe6] md:min-h-12 md:w-auto md:justify-start md:gap-3 md:py-3 md:text-left";
const WORKSPACE_CAPTURE_BAR_INLINE_ACTION_BUTTON_CLASS_NAME =
  "inline-flex min-h-11 w-full max-w-full items-center justify-center rounded-full px-4 py-2.5 text-center text-sm font-medium leading-5 whitespace-normal break-words transition focus-visible:outline-none focus-visible:ring-2 md:w-auto";

function getWorkspaceHomePhotoDraftUploadHeading(
  draft: WorkspaceHomePhotoDraft,
): string {
  switch (draft.uploadState.status) {
    case "pending":
      return "Getting upload ready";
    case "uploading":
      return `${draft.uploadState.progressPercent}% uploaded`;
    case "uploaded":
      return "Photo added";
    case "failed":
      return "Upload failed";
    default:
      return "Ready to add";
  }
}

function getWorkspaceHomePhotoDraftUploadDetail(
  draft: WorkspaceHomePhotoDraft,
): string {
  switch (draft.uploadState.status) {
    case "pending":
      return `Getting ${draft.fileName} ready to upload.`;
    case "uploading":
      return `${draft.uploadState.progressPercent}% uploaded.`;
    case "uploaded":
      return `${draft.fileName} is attached to this note.`;
    case "failed":
      return draft.uploadState.errorMessage ?? "Photo upload failed.";
    default:
      return `${draft.uploadHandoff.mimeType} file ready to upload.`;
  }
}

function getWorkspaceHomePhotoDraftUploadFeedback(
  draft: WorkspaceHomePhotoDraft,
): string | null {
  switch (draft.uploadState.status) {
    case "pending":
      return `Uploading ${draft.fileName}.`;
    case "uploading":
      return `${draft.fileName} upload is ${draft.uploadState.progressPercent}% complete.`;
    case "uploaded":
      return `${draft.fileName} is ready.`;
    case "failed":
      return draft.uploadState.errorMessage ?? "Photo upload failed.";
    default:
      return null;
  }
}

function isWorkspaceHomePhotoDraftUploadError(
  draft: WorkspaceHomePhotoDraft | null,
): boolean {
  return draft?.uploadState.status === "failed";
}

export function WorkspaceCaptureBar() {
  const pathname = usePathname() ?? "/dashboard";
  const {
    captureDraft,
    setCaptureDraft,
    setClusterPreviews: resolvedSetClusterPreviews,
    setSelectedRecordId: resolvedSetSelectedRecordId,
  } = useWorkspaceHomeShellState();
  const [isSubmittingCapture, setIsSubmittingCapture] = useState(false);
  const [isPhotoSourceChooserOpen, setIsPhotoSourceChooserOpen] =
    useState(false);
  const [pendingPhotoCapture, setPendingPhotoCapture] =
    useState<WorkspaceHomePhotoDraft | null>(null);
  const [photoCaptureResult, setPhotoCaptureResult] =
    useState<WorkspaceHomePhotoDraftResult | null>(null);
  const [isVoiceCapturePending, setIsVoiceCapturePending] = useState(false);
  const [voiceCaptureState, setVoiceCaptureState] = useState(
    getWorkspaceHomeVoiceCaptureIdleState,
  );
  const previousPendingPhotoCaptureRef = useRef<WorkspaceHomePhotoDraft | null>(
    null,
  );
  const photoUploadAbortControllerRef = useRef<AbortController | null>(null);
  const voiceCaptureSessionRef = useRef<WorkspaceHomeVoiceCaptureSession | null>(
    null,
  );
  const photoSourceInputRefs = useRef<
    Record<WorkspaceHomePhotoSource, HTMLInputElement | null>
  >({
    camera: null,
    gallery: null,
  });
  const photoSourceOptions = getWorkspaceHomePhotoSourceOptions();
  const shouldRenderCaptureBar = pathname === "/dashboard";
  const isVoiceCaptureRecording = voiceCaptureState.status === "recording";
  const voiceCaptureStatusLabel =
    getWorkspaceHomeVoiceCaptureStatusLabel(voiceCaptureState);
  const voiceCaptureHelperText =
    getWorkspaceHomeVoiceCaptureHelperText(voiceCaptureState);
  const photoDraftUploadFeedback =
    pendingPhotoCapture === null
      ? null
      : getWorkspaceHomePhotoDraftUploadFeedback(pendingPhotoCapture);
  const isPhotoUploadError =
    isWorkspaceHomePhotoDraftUploadError(pendingPhotoCapture);
  const photoCaptureFeedback =
    photoDraftUploadFeedback !== null
      ? photoDraftUploadFeedback
      : photoCaptureResult === null
        ? WORKSPACE_HOME_PHOTO_CAPTURE_IDLE_HELPER_TEXT
        : photoCaptureResult.status === "ready"
          ? photoCaptureResult.feedbackMessage
          : `${photoCaptureResult.feedbackMessage} ${photoCaptureResult.nextStep}`;
  const isPhotoCaptureError =
    photoCaptureResult?.status === "error" || isPhotoUploadError;

  useEffect(() => {
    return () => {
      photoUploadAbortControllerRef.current?.abort();
      photoUploadAbortControllerRef.current = null;

      const activeVoiceCaptureSession = voiceCaptureSessionRef.current;

      if (activeVoiceCaptureSession === null) {
        return;
      }

      void stopWorkspaceHomeVoiceCapture(activeVoiceCaptureSession).catch(
        () => {
          // Ignore recorder teardown failures while leaving the capture bar.
        },
      );
      voiceCaptureSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      releaseWorkspaceHomePhotoDraftPreview(
        previousPendingPhotoCaptureRef.current,
      );
    };
  }, []);

  useEffect(() => {
    const previousPendingPhotoCapture = previousPendingPhotoCaptureRef.current;

    if (
      previousPendingPhotoCapture !== null &&
      previousPendingPhotoCapture.preview.objectUrl !==
        pendingPhotoCapture?.preview.objectUrl
    ) {
      releaseWorkspaceHomePhotoDraftPreview(previousPendingPhotoCapture);
    }

    previousPendingPhotoCaptureRef.current = pendingPhotoCapture;
  }, [pendingPhotoCapture?.preview.objectUrl]);

  useEffect(() => {
    const { handleReconnectSignal: handleOfflineCaptureReconnect } =
      createReconnectReplayController({
        isOnline: () =>
          typeof navigator === "undefined" ? true : navigator.onLine !== false,
        startReplay: async () => {
          const { failures, synced } = await replayWorkspaceHomeQueuedCaptures();

          if (synced.length === 0 && failures.length === 0) {
            return;
          }

          resolvedSetClusterPreviews((currentClusterPreviews) => {
            let nextClusterPreviews = currentClusterPreviews;

            for (const syncedCapture of synced) {
              nextClusterPreviews = markWorkspaceHomeOptimisticCaptureSaved(
                nextClusterPreviews,
                syncedCapture.localCaptureId,
                syncedCapture.persistedCaptureId,
                syncedCapture.processingState,
              );
            }

            for (const failedCapture of failures) {
              nextClusterPreviews = markWorkspaceHomeOptimisticCaptureFailed(
                nextClusterPreviews,
                failedCapture.localCaptureId,
              );
            }

            return nextClusterPreviews;
          });

          const mostRecentSyncedCapture = synced.at(-1);

          if (mostRecentSyncedCapture !== undefined) {
            resolvedSetSelectedRecordId(
              mostRecentSyncedCapture.persistedCaptureId,
            );
          }
        },
      });

    window.addEventListener(
      OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
      handleOfflineCaptureReconnect,
    );

    return () => {
      window.removeEventListener(
        OFFLINE_CAPTURE_RECONNECT_SIGNAL_EVENT,
        handleOfflineCaptureReconnect,
      );
    };
  }, [resolvedSetClusterPreviews, resolvedSetSelectedRecordId]);

  async function handleVoiceCaptureToggle(): Promise<void> {
    if (isVoiceCapturePending) {
      return;
    }

    setIsVoiceCapturePending(true);

    if (isVoiceCaptureRecording) {
      const activeVoiceCaptureSession = voiceCaptureSessionRef.current;

      if (activeVoiceCaptureSession === null) {
        setVoiceCaptureState(getWorkspaceHomeVoiceCaptureIdleState());
        setIsVoiceCapturePending(false);
        return;
      }

      try {
        await stopWorkspaceHomeVoiceCapture(activeVoiceCaptureSession);
        voiceCaptureSessionRef.current = null;
        setVoiceCaptureState(getWorkspaceHomeVoiceCaptureIdleState());
      } catch (error) {
        voiceCaptureSessionRef.current = null;
        setVoiceCaptureState(
          createWorkspaceHomeVoiceCaptureErrorState(
            readWorkspaceHomeVoiceCaptureErrorMessage(error),
          ),
        );
      } finally {
        setIsVoiceCapturePending(false);
      }

      return;
    }

    try {
      const voiceCaptureSession = await startWorkspaceHomeVoiceCapture();
      voiceCaptureSessionRef.current = voiceCaptureSession;
      setVoiceCaptureState(getWorkspaceHomeVoiceCaptureRecordingState());
    } catch (error) {
      voiceCaptureSessionRef.current = null;
      setVoiceCaptureState(
        createWorkspaceHomeVoiceCaptureErrorState(
          readWorkspaceHomeVoiceCaptureErrorMessage(error),
        ),
      );
    } finally {
      setIsVoiceCapturePending(false);
    }
  }

  function handlePhotoSourceChooserToggle(): void {
    setIsPhotoSourceChooserOpen((currentValue) => !currentValue);
  }

  function cancelWorkspaceHomePhotoDraftUpload(): void {
    photoUploadAbortControllerRef.current?.abort();
    photoUploadAbortControllerRef.current = null;
  }

  function resetWorkspaceHomePhotoDraft(): void {
    cancelWorkspaceHomePhotoDraftUpload();
    setPendingPhotoCapture(null);
    setPhotoCaptureResult(null);
  }

  function queueWorkspaceHomePhotoDraftUpload(
    draft: WorkspaceHomePhotoDraft,
  ): void {
    const pendingDraft = markWorkspaceHomePhotoDraftUploadPending(draft);
    const previewObjectUrl = draft.preview.objectUrl;
    const abortController = new AbortController();

    cancelWorkspaceHomePhotoDraftUpload();
    photoUploadAbortControllerRef.current = abortController;

    setPendingPhotoCapture(pendingDraft);

    void uploadWorkspaceHomePhotoDraft(pendingDraft, {
      signal: abortController.signal,
      onStateChange(nextDraft) {
        setPendingPhotoCapture((currentDraft) =>
          currentDraft?.preview.objectUrl === previewObjectUrl
            ? nextDraft
            : currentDraft,
        );
      },
    })
      .catch(() => undefined)
      .finally(() => {
        if (photoUploadAbortControllerRef.current === abortController) {
          photoUploadAbortControllerRef.current = null;
        }
      });
  }

  function handlePhotoDraftUploadRetry(): void {
    if (pendingPhotoCapture === null) {
      return;
    }

    const retryDraft = resetWorkspaceHomePhotoDraftUploadState(
      pendingPhotoCapture,
    );

    setPhotoCaptureResult(createWorkspaceHomePhotoDraftReadyState(retryDraft));
    queueWorkspaceHomePhotoDraftUpload(retryDraft);
  }

  function handlePhotoDraftUploadCancel(): void {
    if (pendingPhotoCapture === null) {
      return;
    }

    cancelWorkspaceHomePhotoDraftUpload();
  }

  async function openWorkspaceHomePhotoIntake(
    source: WorkspaceHomePhotoSource,
  ): Promise<void> {
    if (source === WORKSPACE_HOME_PHOTO_SOURCE_CAMERA) {
      setIsPhotoSourceChooserOpen(false);

      const photoDraftResult = await prepareWorkspaceHomeCameraPhotoDraft();

      setPhotoCaptureResult(photoDraftResult);

      if (photoDraftResult.status === "ready") {
        queueWorkspaceHomePhotoDraftUpload(photoDraftResult.draft);
      }

      return;
    }

    const photoSourceInput = photoSourceInputRefs.current[source];

    if (photoSourceInput === null) {
      return;
    }

    photoSourceInput.click();
    setIsPhotoSourceChooserOpen(false);
  }

  function handlePhotoSourceFileSelection(
    source: WorkspaceHomePhotoSource,
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    const selectedImageFile = event.currentTarget.files?.item(0);
    event.currentTarget.value = "";

    if (selectedImageFile === null || selectedImageFile === undefined) {
      return;
    }

    setIsPhotoSourceChooserOpen(false);

    const photoDraftResult = prepareWorkspaceHomeSelectedPhotoDraft({
      imageFile: selectedImageFile,
      source,
    });

    setPhotoCaptureResult(photoDraftResult);

    if (photoDraftResult.status === "ready") {
      queueWorkspaceHomePhotoDraftUpload(photoDraftResult.draft);
    }
  }

  async function handleCaptureSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (captureDraft.length < 1 || isSubmittingCapture) {
      return;
    }

    const submittedRawContent = captureDraft;
    const optimisticCaptureId = `optimistic-${globalThis.crypto.randomUUID()}`;
    const optimisticCapture = createWorkspaceHomeOptimisticTextCapture(
      submittedRawContent,
      optimisticCaptureId,
    );

    resolvedSetClusterPreviews((currentClusterPreviews) =>
      prependWorkspaceHomeOptimisticCapture(
        currentClusterPreviews,
        optimisticCapture,
      ),
    );
    resolvedSetSelectedRecordId(optimisticCaptureId);
    setIsSubmittingCapture(true);

    async function queueCaptureForOfflineSync(): Promise<void> {
      const queuedCapture = await queueWorkspaceHomeTextCapture(
        submittedRawContent,
        {
          id: optimisticCaptureId,
        },
      );

      resolvedSetClusterPreviews((currentClusterPreviews) =>
        markWorkspaceHomeOptimisticCaptureQueued(
          currentClusterPreviews,
          optimisticCaptureId,
          queuedCapture.id,
        ),
      );
      resolvedSetSelectedRecordId(queuedCapture.id);
    }

    try {
      let didPersistCapture = false;

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        await queueCaptureForOfflineSync();
        didPersistCapture = true;
      } else {
        try {
          const { persistedCaptureId, processingState } =
            await createWorkspaceHomeTextCapture(submittedRawContent);

          resolvedSetClusterPreviews((currentClusterPreviews) =>
            markWorkspaceHomeOptimisticCaptureSaved(
              currentClusterPreviews,
              optimisticCaptureId,
              persistedCaptureId,
              processingState,
            ),
          );
          resolvedSetSelectedRecordId(persistedCaptureId);
          didPersistCapture = true;
        } catch (error) {
          if (!shouldQueueWorkspaceHomeTextCaptureFailure(error)) {
            throw error;
          }

          await queueCaptureForOfflineSync();
          didPersistCapture = true;
        }
      }

      if (didPersistCapture) {
        setCaptureDraft("");
      }
    } catch {
      resolvedSetClusterPreviews((currentClusterPreviews) =>
        markWorkspaceHomeOptimisticCaptureFailed(
          currentClusterPreviews,
          optimisticCaptureId,
        ),
      );
    } finally {
      setIsSubmittingCapture(false);
    }
  }

  if (!shouldRenderCaptureBar) {
    return null;
  }

  return (
    <section
      data-section="capture-bar"
      className="sticky top-4 z-20 overflow-hidden rounded-[2rem] border border-stone-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(249,245,238,0.96))] shadow-[0_24px_60px_rgba(41,37,36,0.08)] backdrop-blur"
    >
      <div className="flex min-w-0 flex-col gap-5 px-4 py-4 md:gap-6 md:px-6 md:py-6 xl:px-8">
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
          <div className="min-w-0 max-w-3xl space-y-3">
            <p className="text-xs uppercase tracking-[0.35em] text-amber-700">
              {WORKSPACE_CAPTURE_BAR_EYEBROW}
            </p>
            <h1 className="max-w-3xl break-words text-2xl font-semibold tracking-tight text-stone-950 md:text-4xl">
              {WORKSPACE_HOME_TITLE}
            </h1>
            <p className="max-w-3xl text-sm leading-6 text-stone-600 md:text-base md:leading-7">
              {WORKSPACE_HOME_DESCRIPTION}
            </p>
          </div>

          <div className="inline-flex max-w-full self-start rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 md:px-4 md:py-2 md:text-sm">
            Capture stays private until you share it
          </div>
        </div>

        <div className="min-w-0 rounded-[1.75rem] border border-stone-200 bg-[#f8f3eb] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] md:p-5">
          <p className="text-sm leading-6 text-stone-600">
            Start with the rough version. The draft stays in place while Waka
            saves it and catches up in the background.
          </p>

          <label
            htmlFor="workspace-capture"
            id="workspace-capture-label"
            className="mt-5 block text-xs uppercase tracking-[0.3em] text-stone-500"
          >
            Capture now
          </label>
          <form
            className="mt-3 flex min-w-0 flex-col gap-3 rounded-[1.5rem] border border-stone-200 bg-white p-3 shadow-[0_12px_30px_rgba(41,37,36,0.04)] md:gap-4 md:p-4"
            onSubmit={handleCaptureSubmit}
          >
            <div className="flex min-w-0 max-w-full flex-1 flex-col gap-3">
              <div
                data-voice-capture-state={voiceCaptureState.status}
                className="flex min-w-0 flex-col gap-3 rounded-[1.25rem] border border-stone-200 bg-[#fcfaf6] px-3.5 py-3 md:px-4"
              >
                <div className="grid min-w-0 grid-cols-2 gap-2 md:flex md:flex-wrap md:items-center md:gap-3">
                  <button
                    type="button"
                    aria-label={
                      isVoiceCaptureRecording
                        ? "Stop voice capture"
                        : "Start voice capture"
                    }
                    aria-pressed={isVoiceCaptureRecording}
                    data-voice-capture-toggle={voiceCaptureState.status}
                    disabled={isVoiceCapturePending}
                    onClick={() => {
                      void handleVoiceCaptureToggle();
                    }}
                    className={`${WORKSPACE_CAPTURE_BAR_CONTROL_BUTTON_CLASS_NAME} ${
                      isVoiceCaptureRecording
                        ? "border-rose-200 bg-rose-50 text-rose-700 focus-visible:ring-rose-300/70"
                        : "border-stone-200 bg-white text-stone-700 hover:border-amber-300/60 hover:text-stone-950 focus-visible:ring-amber-300/60"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 rounded-full ${
                        isVoiceCaptureRecording
                          ? "bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,0.45)]"
                          : voiceCaptureState.status === "error"
                            ? "bg-amber-500"
                            : "bg-stone-400"
                      }`}
                    />
                    <StableControlLabel
                      label={
                        isVoiceCaptureRecording
                          ? "Stop recording"
                          : "Record voice"
                      }
                      widestLabel="Stop recording"
                    />
                  </button>

                  <button
                    type="button"
                    aria-controls="workspace-photo-source-chooser"
                    aria-expanded={isPhotoSourceChooserOpen}
                    aria-label={
                      isPhotoSourceChooserOpen
                        ? "Close photo source chooser"
                        : "Open photo source chooser"
                    }
                    data-photo-source-toggle={
                      isPhotoSourceChooserOpen ? "open" : "closed"
                    }
                    onClick={handlePhotoSourceChooserToggle}
                    className={`${WORKSPACE_CAPTURE_BAR_CONTROL_BUTTON_CLASS_NAME} ${
                      isPhotoSourceChooserOpen
                        ? "border-sky-200 bg-sky-50 text-sky-700 focus-visible:ring-sky-200/70"
                        : "border-stone-200 bg-white text-stone-700 hover:border-sky-300/60 hover:text-stone-950 focus-visible:ring-sky-200/60"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 rounded-full ${
                        isPhotoSourceChooserOpen
                          ? "bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.35)]"
                          : "bg-stone-400"
                      }`}
                    />
                    Add photo
                  </button>

                  <span
                    data-voice-capture-status-label={voiceCaptureState.status}
                    className={`col-span-2 inline-flex w-full max-w-full justify-center rounded-full border px-3 py-1 text-center text-[0.7rem] uppercase leading-5 tracking-[0.24em] whitespace-normal break-words md:w-auto ${
                      voiceCaptureState.status === "recording"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : voiceCaptureState.status === "error"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-stone-200 bg-white text-stone-500"
                    }`}
                  >
                    {voiceCaptureStatusLabel}
                  </span>
                </div>

                <p
                  role="status"
                  aria-live="polite"
                  data-voice-capture-feedback={voiceCaptureState.status}
                  className={`text-sm ${
                    voiceCaptureState.status === "error"
                      ? "text-amber-700"
                      : "text-stone-600"
                  }`}
                >
                  {voiceCaptureHelperText}
                </p>

                <p
                  data-photo-source-helper={
                    isPhotoSourceChooserOpen ? "expanded" : "collapsed"
                  }
                  aria-live="polite"
                  className={`text-sm ${
                    isPhotoCaptureError ? "text-amber-700" : "text-stone-600"
                  }`}
                >
                  {photoCaptureFeedback}
                </p>

                {pendingPhotoCapture ? (
                  <div
                    data-pending-photo-draft={pendingPhotoCapture.source}
                    data-photo-draft-upload-progress={
                      pendingPhotoCapture.uploadState.progressPercent
                    }
                    data-photo-draft-upload-state={
                      pendingPhotoCapture.uploadState.status
                    }
                    className="flex min-w-0 flex-col gap-3 rounded-[1.2rem] border border-sky-200 bg-sky-50 px-3 py-3 md:flex-row md:items-center"
                  >
                    <img
                      alt={pendingPhotoCapture.preview.altText}
                      className="h-14 w-14 shrink-0 self-start rounded-2xl border border-sky-200 object-cover"
                      src={pendingPhotoCapture.preview.objectUrl}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs uppercase tracking-[0.28em] text-sky-700/80">
                        {getWorkspaceHomePhotoDraftUploadHeading(
                          pendingPhotoCapture,
                        )}
                      </p>
                      <p className="break-words text-sm font-medium text-sky-950">
                        {pendingPhotoCapture.fileName}
                      </p>
                      <p className="break-words text-xs text-sky-700/75">
                        {getWorkspaceHomePhotoDraftUploadDetail(
                          pendingPhotoCapture,
                        )}
                      </p>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
                        <div
                          aria-hidden="true"
                          className="h-full rounded-full bg-sky-400 transition-[width] duration-300"
                          style={{
                            width: `${pendingPhotoCapture.uploadState.progressPercent}%`,
                          }}
                        />
                      </div>
                      {pendingPhotoCapture.uploadState.status === "failed" ? (
                        <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
                          <button
                            type="button"
                            data-photo-draft-retry-action={
                              pendingPhotoCapture.source
                            }
                            onClick={handlePhotoDraftUploadRetry}
                            className={`${WORKSPACE_CAPTURE_BAR_INLINE_ACTION_BUTTON_CLASS_NAME} bg-sky-600 text-white hover:bg-sky-500 focus-visible:ring-sky-300/70`}
                          >
                            Try upload again
                          </button>
                          <button
                            type="button"
                            data-photo-draft-reset-action={
                              pendingPhotoCapture.source
                            }
                            onClick={resetWorkspaceHomePhotoDraft}
                            className={`${WORKSPACE_CAPTURE_BAR_INLINE_ACTION_BUTTON_CLASS_NAME} border border-sky-200 bg-white text-sky-700 hover:border-sky-300 hover:text-sky-900 focus-visible:ring-sky-300/50`}
                          >
                            Remove photo
                          </button>
                          <p className="text-xs leading-5 text-sky-700/75 md:col-span-2">
                            Local draft kept until you retry or reset it.
                          </p>
                        </div>
                      ) : pendingPhotoCapture.uploadState.status === "pending" ||
                          pendingPhotoCapture.uploadState.status ===
                            "uploading" ? (
                        <div className="mt-3 grid min-w-0 gap-2">
                          <button
                            type="button"
                            data-photo-draft-cancel-action={
                              pendingPhotoCapture.source
                            }
                            onClick={handlePhotoDraftUploadCancel}
                            className={`${WORKSPACE_CAPTURE_BAR_INLINE_ACTION_BUTTON_CLASS_NAME} border border-sky-200 bg-white text-sky-700 hover:border-sky-300 hover:text-sky-900 focus-visible:ring-sky-300/50`}
                          >
                            Cancel upload
                          </button>
                          <p className="text-xs leading-5 text-sky-700/75">
                            Cancel keeps the local photo draft available for retry.
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {isPhotoSourceChooserOpen ? (
                  <div
                    id="workspace-photo-source-chooser"
                    data-photo-source-chooser="open"
                    className="grid min-w-0 gap-2 min-[56rem]:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]"
                  >
                    {photoSourceOptions.map((photoSourceOption) => (
                      <button
                        key={photoSourceOption.source}
                        type="button"
                        data-photo-intake-path={photoSourceOption.intakePath}
                        data-photo-source-trigger={photoSourceOption.source}
                        onClick={() => {
                          void openWorkspaceHomePhotoIntake(
                            photoSourceOption.source,
                          );
                        }}
                        className="min-w-0 rounded-[1.1rem] border border-stone-200 bg-white px-4 py-3 text-left transition hover:border-sky-300/60 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200/70"
                      >
                        <span className="block text-sm font-medium text-stone-900">
                          {photoSourceOption.buttonLabel}
                        </span>
                        <span className="mt-1 block text-sm leading-6 text-stone-600">
                          {photoSourceOption.description}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {photoSourceOptions.map((photoSourceOption) => (
                  <input
                    key={photoSourceOption.inputId}
                    ref={(inputElement) => {
                      photoSourceInputRefs.current[photoSourceOption.source] =
                        inputElement;
                    }}
                    accept={photoSourceOption.inputAttributes.accept}
                    capture={photoSourceOption.inputAttributes.capture}
                    className="sr-only"
                    data-photo-intake-path={photoSourceOption.intakePath}
                    data-photo-source-input={photoSourceOption.source}
                    id={photoSourceOption.inputId}
                    onChange={(event) => {
                      handlePhotoSourceFileSelection(
                        photoSourceOption.source,
                        event,
                      );
                    }}
                    tabIndex={-1}
                    type="file"
                  />
                ))}
              </div>

              <textarea
                id="workspace-capture"
                name="rawContent"
                aria-label="Capture note"
                autoFocus
                disabled={isSubmittingCapture}
                minLength={1}
                onChange={(event) => setCaptureDraft(event.target.value)}
                placeholder={WORKSPACE_HOME_CAPTURE_PLACEHOLDER}
                rows={3}
                value={captureDraft}
                className="min-h-24 w-full min-w-0 max-w-full flex-1 resize-none rounded-[1.25rem] border border-stone-200 bg-[#fcfaf6] px-4 py-3 text-[0.9375rem] leading-6 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-300/30 md:min-h-28 md:py-4 md:text-base md:leading-7"
              />
            </div>
            <button
              type="submit"
              disabled={captureDraft.length < 1 || isSubmittingCapture}
              data-capture-submit-state={isSubmittingCapture ? "saving" : "idle"}
              className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-full bg-stone-950 px-5 py-2.5 text-center text-sm font-medium leading-5 whitespace-normal break-words text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 disabled:cursor-not-allowed disabled:bg-stone-400 md:min-h-12 md:w-auto md:self-end md:py-3"
            >
              <StableControlLabel
                label={isSubmittingCapture ? "Saving..." : "Save note"}
                widestLabel="Save note"
              />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
