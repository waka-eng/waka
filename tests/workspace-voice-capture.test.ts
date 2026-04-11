import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createWorkspaceHomeVoiceCaptureUploadHandoffPayload,
  createWorkspaceHomeVoiceCaptureErrorState,
  getWorkspaceHomeVoiceCaptureHelperText,
  getWorkspaceHomeVoiceCaptureIdleState,
  getWorkspaceHomeVoiceCaptureRecordingState,
  getWorkspaceHomeVoiceCaptureStatusLabel,
  initializeWorkspaceHomeVoiceCaptureSession,
  readWorkspaceHomeVoiceCaptureErrorMessage,
  startWorkspaceHomeVoiceCapture,
  stopWorkspaceHomeVoiceCapture,
  WORKSPACE_HOME_VOICE_CAPTURE_PERMISSION_DENIED_ERROR,
  WORKSPACE_HOME_VOICE_CAPTURE_START_ERROR,
  WORKSPACE_HOME_VOICE_CAPTURE_STOP_ERROR,
  WORKSPACE_HOME_VOICE_CAPTURE_UNSUPPORTED_ERROR,
} from "../apps/web/src/home/voice-capture.ts";

const WORKSPACE_CAPTURE_BAR_COMPONENT_PATH = path.join(
  process.cwd(),
  "apps/web/src/home/workspace-capture-bar.tsx",
);

test("voice capture helper text and labels reflect idle, recording, and error states", () => {
  assert.equal(
    getWorkspaceHomeVoiceCaptureStatusLabel(
      getWorkspaceHomeVoiceCaptureIdleState(),
    ),
    "Idle",
  );
  assert.match(
    getWorkspaceHomeVoiceCaptureHelperText(
      getWorkspaceHomeVoiceCaptureIdleState(),
    ),
    /start a voice note/i,
  );

  assert.equal(
    getWorkspaceHomeVoiceCaptureStatusLabel(
      getWorkspaceHomeVoiceCaptureRecordingState(),
    ),
    "Recording",
  );
  assert.match(
    getWorkspaceHomeVoiceCaptureHelperText(
      getWorkspaceHomeVoiceCaptureRecordingState(),
    ),
    /stop when the note is ready/i,
  );

  const errorState = createWorkspaceHomeVoiceCaptureErrorState(
    "Microphone permissions are blocked.",
  );

  assert.equal(getWorkspaceHomeVoiceCaptureStatusLabel(errorState), "Error");
  assert.equal(
    getWorkspaceHomeVoiceCaptureHelperText(errorState),
    "Microphone permissions are blocked.",
  );
});

test("initializeWorkspaceHomeVoiceCaptureSession requests microphone access and constructs a new recorder session", async () => {
  const requestedConstraints: MediaStreamConstraints[] = [];
  let recorderConstructionCount = 0;
  let startCallCount = 0;
  let stopTrackCallCount = 0;
  const stream = {
    getTracks() {
      return [
        {
          stop() {
            stopTrackCallCount += 1;
          },
        },
      ];
    },
  };

  class FakeMediaRecorder {
    public state = "inactive";
    public readonly streamLike: typeof stream;

    public constructor(streamLike: typeof stream) {
      recorderConstructionCount += 1;
      this.streamLike = streamLike;
    }

    public start(): void {
      startCallCount += 1;
      this.state = "recording";
    }

    public stop(): void {
      this.state = "inactive";
    }
  }

  const session = await initializeWorkspaceHomeVoiceCaptureSession({
    MediaRecorder: FakeMediaRecorder,
    mediaDevices: {
      async getUserMedia(constraints) {
        requestedConstraints.push(constraints);
        return stream;
      },
    },
  });

  assert.equal(requestedConstraints.length, 1);
  assert.equal(requestedConstraints[0]?.audio, true);
  assert.equal(recorderConstructionCount, 1);
  assert.equal(startCallCount, 0);
  assert.deepEqual(session.audioChunks, []);
  assert.equal(session.stream, stream);
  assert.equal(session.recorder.state, "inactive");
  assert.equal(stopTrackCallCount, 0);
});

test("initializeWorkspaceHomeVoiceCaptureSession stops tracks when recorder construction fails", async () => {
  let stopTrackCallCount = 0;

  await assert.rejects(
    () =>
      initializeWorkspaceHomeVoiceCaptureSession({
        MediaRecorder: class BrokenMediaRecorder {
          public constructor() {
            throw new Error("MediaRecorder construction failed");
          }

          public start(): void {}

          public stop(): void {}
        },
        mediaDevices: {
          async getUserMedia() {
            return {
              getTracks() {
                return [
                  {
                    stop() {
                      stopTrackCallCount += 1;
                    },
                  },
                ];
              },
            };
          },
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === WORKSPACE_HOME_VOICE_CAPTURE_START_ERROR,
  );

  assert.equal(stopTrackCallCount, 1);
});

test("startWorkspaceHomeVoiceCapture requests audio input and starts a recorder", async () => {
  let startCallCount = 0;
  let stopTrackCallCount = 0;
  const stream = {
    getTracks() {
      return [
        {
          stop() {
            stopTrackCallCount += 1;
          },
        },
      ];
    },
  };

  class FakeMediaRecorder {
    public state = "inactive";
    public readonly streamLike: typeof stream;

    public constructor(streamLike: typeof stream) {
      this.streamLike = streamLike;
    }

    public start(): void {
      startCallCount += 1;
      this.state = "recording";
    }

    public stop(): void {
      this.state = "inactive";
    }
  }

  const session = await startWorkspaceHomeVoiceCapture({
    MediaRecorder: FakeMediaRecorder,
    mediaDevices: {
      async getUserMedia() {
        return stream;
      },
    },
  });

  assert.equal(startCallCount, 1);
  assert.deepEqual(session.audioChunks, []);
  assert.equal(session.stream, stream);
  assert.equal(session.recorder.state, "recording");
  assert.equal(typeof session.startedAt, "number");
  assert.equal(stopTrackCallCount, 0);
});

test("startWorkspaceHomeVoiceCapture collects non-empty dataavailable chunks into the active session", async () => {
  const stream = {
    getTracks() {
      return [];
    },
  };

  class FakeMediaRecorder {
    public ondataavailable:
      | ((event: { data: Blob }) => void)
      | null = null;
    public state = "inactive";
    public readonly streamLike: typeof stream;

    public constructor(streamLike: typeof stream) {
      this.streamLike = streamLike;
    }

    public start(): void {
      this.state = "recording";
    }

    public stop(): void {
      this.state = "inactive";
    }

    public emitDataAvailable(data: Blob): void {
      this.ondataavailable?.({
        data,
      });
    }
  }

  const session = await startWorkspaceHomeVoiceCapture({
    MediaRecorder: FakeMediaRecorder,
    mediaDevices: {
      async getUserMedia() {
        return stream;
      },
    },
  });

  const firstChunk = new Blob(["first"], {
    type: "audio/webm",
  });
  const secondChunk = new Blob(["second"], {
    type: "audio/webm",
  });
  const recorder = session.recorder as FakeMediaRecorder;

  recorder.emitDataAvailable(new Blob([]));
  recorder.emitDataAvailable(firstChunk);
  recorder.emitDataAvailable(secondChunk);

  assert.deepEqual(session.audioChunks, [firstChunk, secondChunk]);
});

test("startWorkspaceHomeVoiceCapture maps microphone permission failures to an explicit error", async () => {
  await assert.rejects(
    () =>
      startWorkspaceHomeVoiceCapture({
        MediaRecorder: class FakeMediaRecorder {
          public start(): void {}

          public stop(): void {}
        },
        mediaDevices: {
          async getUserMedia() {
            throw {
              name: "NotAllowedError",
            };
          },
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === WORKSPACE_HOME_VOICE_CAPTURE_PERMISSION_DENIED_ERROR,
  );
});

test("readWorkspaceHomeVoiceCaptureErrorMessage preserves explicit stop failures", () => {
  assert.equal(
    readWorkspaceHomeVoiceCaptureErrorMessage(
      new Error(WORKSPACE_HOME_VOICE_CAPTURE_STOP_ERROR),
    ),
    WORKSPACE_HOME_VOICE_CAPTURE_STOP_ERROR,
  );
});

test("startWorkspaceHomeVoiceCapture rejects unsupported environments before recording starts", async () => {
  await assert.rejects(
    () => startWorkspaceHomeVoiceCapture({}),
    (error: unknown) =>
      error instanceof Error &&
      error.message === WORKSPACE_HOME_VOICE_CAPTURE_UNSUPPORTED_ERROR,
  );
});

test("stopWorkspaceHomeVoiceCapture waits for recorder finalization, assembles the recorded chunks, and closes stream tracks", async () => {
  let recorderStopCount = 0;
  let trackStopCount = 0;
  const firstChunk = new Blob(["first"], {
    type: "audio/webm",
  });
  const secondChunk = new Blob(["second"], {
    type: "audio/webm",
  });
  const recorder = {
    mimeType: "audio/webm",
    onstop: null as (() => void) | null,
    state: "recording",
    start() {},
    stop() {
      recorderStopCount += 1;
    },
  };

  const session = {
    audioChunks: [firstChunk],
    recorder,
    startedAt: Date.now(),
    stream: {
      getTracks() {
        return [
          {
            stop() {
              trackStopCount += 1;
            },
          },
        ];
      },
    },
  };
  const stopPromise = stopWorkspaceHomeVoiceCapture(session);

  assert.equal(recorderStopCount, 1);
  assert.equal(trackStopCount, 0);

  session.audioChunks.push(secondChunk);
  const activeAudioChunks = [firstChunk, secondChunk];
  recorder.state = "inactive";
  recorder.onstop?.();

  const completedPayload = await stopPromise;

  assert.equal(recorderStopCount, 1);
  assert.equal(trackStopCount, 1);
  assert.deepEqual(completedPayload.audioChunks, activeAudioChunks);
  assert.equal(completedPayload.mimeType, "audio/webm");
  assert.equal(completedPayload.audioBlob.type, "audio/webm");
  assert.equal(completedPayload.sizeBytes, firstChunk.size + secondChunk.size);
  assert.equal(await completedPayload.audioBlob.text(), "firstsecond");
  assert.equal(completedPayload.sourceType, "VOICE_NOTE");
  assert.equal(completedPayload.sourceMeta.mimeType, "audio/webm");
  assert.equal(
    completedPayload.sourceMeta.sizeBytes,
    firstChunk.size + secondChunk.size,
  );
  assert.ok(completedPayload.sourceMeta.durationSeconds >= 0);
  assert.equal(completedPayload.uploadHandoff.audioBlob, completedPayload.audioBlob);
  assert.equal(
    completedPayload.uploadHandoff.audioMimeType,
    completedPayload.mimeType,
  );
  assert.equal(
    completedPayload.uploadHandoff.audioSizeBytes,
    completedPayload.sizeBytes,
  );
  assert.equal(
    completedPayload.uploadHandoff.audioDurationSeconds,
    completedPayload.durationSeconds,
  );
  assert.equal(completedPayload.uploadHandoff.mimeType, "audio/webm");
  assert.equal(
    completedPayload.uploadHandoff.sizeBytes,
    firstChunk.size + secondChunk.size,
  );
  assert.equal(completedPayload.uploadHandoff.sourceType, "VOICE_NOTE");
  assert.equal(
    completedPayload.uploadHandoff.sourceMeta.mimeType,
    "audio/webm",
  );
  assert.ok(
    completedPayload.uploadHandoff.sourceMeta.durationSeconds >= 0,
  );
  assert.ok(completedPayload.durationMs >= 0);
  assert.ok(completedPayload.durationSeconds >= 0);
});

test("stopWorkspaceHomeVoiceCapture falls back to the first recorded chunk MIME type for the upload blob", async () => {
  const firstChunk = new Blob(["first"], {
    type: "audio/mp4",
  });
  const secondChunk = new Blob(["second"], {
    type: "audio/mp4",
  });

  const completedPayload = await stopWorkspaceHomeVoiceCapture({
    audioChunks: [firstChunk, secondChunk],
    recorder: {
      mimeType: "   ",
      state: "inactive",
      start() {},
      stop() {},
    },
    startedAt: Date.now(),
    stream: {
      getTracks() {
        return [];
      },
    },
  });

  assert.equal(completedPayload.mimeType, "audio/mp4");
  assert.equal(completedPayload.audioBlob.type, "audio/mp4");
  assert.equal(await completedPayload.audioBlob.text(), "firstsecond");
  assert.equal(completedPayload.sourceType, "VOICE_NOTE");
  assert.equal(completedPayload.sourceMeta.mimeType, "audio/mp4");
  assert.equal(completedPayload.sourceMeta.sizeBytes, firstChunk.size + secondChunk.size);
  assert.equal(completedPayload.uploadHandoff.mimeType, "audio/mp4");
  assert.equal(completedPayload.uploadHandoff.audioMimeType, "audio/mp4");
  assert.equal(
    completedPayload.uploadHandoff.sourceMeta.mimeType,
    "audio/mp4",
  );
});

test("createWorkspaceHomeVoiceCaptureUploadHandoffPayload packages the audio blob with voice-note capture metadata", async () => {
  const audioBlob = new Blob(["voice-note"], {
    type: "audio/webm",
  });

  const uploadHandoff = createWorkspaceHomeVoiceCaptureUploadHandoffPayload({
    audioBlob,
    durationSeconds: 4.2,
    mimeType: "audio/webm",
    sizeBytes: audioBlob.size,
  });

  assert.equal(uploadHandoff.audioBlob, audioBlob);
  assert.equal(uploadHandoff.audioDurationSeconds, 4.2);
  assert.equal(uploadHandoff.audioMimeType, "audio/webm");
  assert.equal(uploadHandoff.audioSizeBytes, audioBlob.size);
  assert.equal(uploadHandoff.mimeType, "audio/webm");
  assert.equal(uploadHandoff.sizeBytes, audioBlob.size);
  assert.equal(uploadHandoff.sourceType, "VOICE_NOTE");
  assert.deepEqual(uploadHandoff.sourceMeta, {
    durationSeconds: 4.2,
    mimeType: "audio/webm",
    sizeBytes: audioBlob.size,
  });
  assert.equal(await uploadHandoff.audioBlob.text(), "voice-note");
});

test("stopWorkspaceHomeVoiceCapture surfaces a stop error and still stops tracks", async () => {
  let trackStopCount = 0;

  await assert.rejects(
    () =>
      stopWorkspaceHomeVoiceCapture({
        audioChunks: [],
        recorder: {
          state: "recording",
          start() {},
          stop() {
            throw new Error("stop failed");
          },
        },
        stream: {
          getTracks() {
            return [
              {
                stop() {
                  trackStopCount += 1;
                },
              },
            ];
          },
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === WORKSPACE_HOME_VOICE_CAPTURE_STOP_ERROR,
  );

  assert.equal(trackStopCount, 1);
});

test("workspace capture bar exposes voice capture toggle and state hooks", () => {
  const source = readFileSync(WORKSPACE_CAPTURE_BAR_COMPONENT_PATH, "utf8");

  assert.match(source, /handleVoiceCaptureToggle/);
  assert.match(source, /startWorkspaceHomeVoiceCapture/);
  assert.match(source, /stopWorkspaceHomeVoiceCapture/);
  assert.match(source, /await stopWorkspaceHomeVoiceCapture\(activeVoiceCaptureSession\)/);
  assert.match(source, /data-voice-capture-state=\{voiceCaptureState\.status\}/);
  assert.match(source, /data-voice-capture-toggle=\{voiceCaptureState\.status\}/);
  assert.match(source, /data-voice-capture-status-label=\{voiceCaptureState\.status\}/);
  assert.match(source, /data-voice-capture-feedback=\{voiceCaptureState\.status\}/);
  assert.match(source, /aria-pressed=\{isVoiceCaptureRecording\}/);
  assert.match(source, /Record voice/);
  assert.match(source, /Stop recording/);
});
