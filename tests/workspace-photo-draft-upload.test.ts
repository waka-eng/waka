import assert from "node:assert/strict";
import test from "node:test";

import {
  attachWorkspaceHomePhotoDraftUploadToken,
  initiateWorkspaceHomePhotoDraftUpload,
  parseWorkspaceHomePhotoDraftUploadToken,
  uploadWorkspaceHomePhotoDraft,
  WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_ABORTED_ERROR,
  WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_TOKEN_MISMATCH_ERROR,
} from "../apps/web/src/home/photo-draft-upload.ts";
import {
  createWorkspaceHomePhotoDraft,
  createWorkspaceHomeSelectedLocalImagePayload,
} from "../apps/web/src/home/photo-capture.ts";

function createPhotoDraft() {
  return createWorkspaceHomePhotoDraft(
    createWorkspaceHomeSelectedLocalImagePayload({
      imageFile: new File(["draft-preview"], "moodboard.webp", {
        type: "image/webp",
      }),
      source: "gallery",
    }),
    {
      createObjectUrl: () => "blob:photo-draft/moodboard.webp",
    },
  );
}

test("parseWorkspaceHomePhotoDraftUploadToken validates the presigned upload contract returned by the photo initiate route", () => {
  assert.deepEqual(
    parseWorkspaceHomePhotoDraftUploadToken({
      image: {
        contentType: "IMAGE/WEBP",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
        sizeBytes: 13,
        storageKey:
          "users/user-photo/photos/1775793906000-moodboard-upload.webp",
      },
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
      objectKey:
        "users/user-photo/photos/1775793906000-moodboard-upload.webp",
      upload: {
        fields: {},
        headers: {
          "content-type": "image/webp",
        },
        method: "PUT",
        url: "https://uploads.waka.app/presigned/moodboard",
      },
    }),
    {
      image: {
        contentType: "image/webp",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
        sizeBytes: 13,
        storageKey:
          "users/user-photo/photos/1775793906000-moodboard-upload.webp",
      },
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
      objectKey:
        "users/user-photo/photos/1775793906000-moodboard-upload.webp",
      storageKey:
        "users/user-photo/photos/1775793906000-moodboard-upload.webp",
      upload: {
        fields: {},
        headers: {
          "content-type": "image/webp",
        },
        method: "PUT",
        url: "https://uploads.waka.app/presigned/moodboard",
      },
    },
  );
});

test("attachWorkspaceHomePhotoDraftUploadToken stores the validated upload token metadata on the draft", () => {
  const draft = createPhotoDraft();
  const updatedDraft = attachWorkspaceHomePhotoDraftUploadToken(draft, {
    image: {
      contentType: "image/webp",
      fileName: "moodboard.webp",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
      sizeBytes: draft.sizeBytes,
      storageKey:
        "users/user-photo/photos/1775793906000-moodboard-upload.webp",
    },
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
    objectKey:
      "users/user-photo/photos/1775793906000-moodboard-upload.webp",
    storageKey:
      "users/user-photo/photos/1775793906000-moodboard-upload.webp",
    upload: {
      fields: {},
      headers: {
        "content-type": "image/webp",
      },
      method: "PUT",
      url: "https://uploads.waka.app/presigned/moodboard",
    },
  });

  assert.equal(draft.uploadToken, undefined);
  assert.equal(
    updatedDraft.uploadToken?.objectKey,
    "users/user-photo/photos/1775793906000-moodboard-upload.webp",
  );
  assert.deepEqual(updatedDraft.uploadIdentity, {
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
    objectKey:
      "users/user-photo/photos/1775793906000-moodboard-upload.webp",
    storageKey:
      "users/user-photo/photos/1775793906000-moodboard-upload.webp",
  });
  assert.equal(
    updatedDraft.uploadToken?.upload.url,
    "https://uploads.waka.app/presigned/moodboard",
  );
});

test("attachWorkspaceHomePhotoDraftUploadToken rejects upload metadata that does not match the selected draft", () => {
  const draft = createPhotoDraft();

  assert.throws(
    () =>
      attachWorkspaceHomePhotoDraftUploadToken(draft, {
        image: {
          contentType: "image/png",
          fileName: "moodboard.webp",
          mediaUrl:
            "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
          sizeBytes: draft.sizeBytes,
          storageKey:
            "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        },
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
        objectKey:
          "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        storageKey:
          "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        upload: {
          fields: {},
          headers: {
            "content-type": "image/png",
          },
          method: "PUT",
          url: "https://uploads.waka.app/presigned/moodboard",
        },
      }),
    new TypeError(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_TOKEN_MISMATCH_ERROR),
  );
});

test("initiateWorkspaceHomePhotoDraftUpload requests a presigned photo upload and returns the draft with upload token metadata attached", async () => {
  const draft = createPhotoDraft();
  const requests: Array<{
    init?: RequestInit;
    input: RequestInfo | URL;
  }> = [];

  const updatedDraft = await initiateWorkspaceHomePhotoDraftUpload(
    draft,
    async (input, init) => {
      requests.push({ input, init });

      return Response.json({
        image: {
          contentType: "image/webp",
          fileName: draft.fileName,
          mediaUrl:
            "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
          sizeBytes: draft.sizeBytes,
          storageKey:
            "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        },
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
        objectKey:
          "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        upload: {
          fields: {},
          headers: {
            "content-type": "image/webp",
          },
          method: "PUT",
          url: "https://uploads.waka.app/presigned/moodboard",
        },
      });
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/media/photos/initiate");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    contentType: "image/webp",
    fileName: "moodboard.webp",
    sizeBytes: draft.sizeBytes,
  });
  assert.deepEqual(updatedDraft.uploadIdentity, {
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
    objectKey:
      "users/user-photo/photos/1775793906000-moodboard-upload.webp",
    storageKey:
      "users/user-photo/photos/1775793906000-moodboard-upload.webp",
  });
  assert.equal(
    updatedDraft.uploadToken?.storageKey,
    "users/user-photo/photos/1775793906000-moodboard-upload.webp",
  );
});

test("initiateWorkspaceHomePhotoDraftUpload refreshes presigned metadata against the existing draft upload identity", async () => {
  const draft = {
    ...createPhotoDraft(),
    uploadIdentity: {
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
      objectKey:
        "users/user-photo/photos/1775793906000-moodboard-upload.webp",
      storageKey:
        "users/user-photo/photos/1775793906000-moodboard-upload.webp",
    },
  };
  const requests: Array<{
    init?: RequestInit;
    input: RequestInfo | URL;
  }> = [];

  await initiateWorkspaceHomePhotoDraftUpload(draft, async (input, init) => {
    requests.push({ input, init });

    return Response.json({
      image: {
        contentType: "image/webp",
        fileName: draft.fileName,
        mediaUrl: draft.uploadIdentity.mediaUrl,
        sizeBytes: draft.sizeBytes,
        storageKey: draft.uploadIdentity.storageKey,
      },
      mediaUrl: draft.uploadIdentity.mediaUrl,
      objectKey: draft.uploadIdentity.objectKey,
      upload: {
        fields: {},
        headers: {
          "content-type": "image/webp",
        },
        method: "PUT",
        url: "https://uploads.waka.app/presigned/moodboard-refresh",
      },
    });
  });

  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    contentType: "image/webp",
    existingUpload: draft.uploadIdentity,
    fileName: "moodboard.webp",
    sizeBytes: draft.sizeBytes,
  });
});

test("uploadWorkspaceHomePhotoDraft performs the direct PUT upload and streams progress updates into the draft state", async () => {
  const draft = createPhotoDraft();
  const lifecycleStates: string[] = [];
  const progressPercentages: number[] = [];
  const requests: Array<{
    init?: RequestInit;
    input: RequestInfo | URL;
  }> = [];

  class MockUploadTarget {
    private readonly listeners = new Map<
      string,
      Array<(event: { lengthComputable?: boolean; loaded?: number; total?: number }) => void>
    >();

    addEventListener(
      type: "progress",
      listener: (event: {
        lengthComputable?: boolean;
        loaded?: number;
        total?: number;
      }) => void,
    ): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    emit(
      type: "progress",
      event: { lengthComputable?: boolean; loaded?: number; total?: number },
    ): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  class MockUploadTransport {
    readonly upload = new MockUploadTarget();
    readonly headers: Record<string, string> = {};
    openCall?: {
      method: string;
      url: string;
    };
    sentBody?: Blob;
    status = 0;
    private readonly listeners = new Map<string, Array<() => void>>();

    addEventListener(
      type: "abort" | "error" | "load",
      listener: () => void,
    ): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    open(method: string, url: string): void {
      this.openCall = {
        method,
        url,
      };
    }

    send(body: Blob): void {
      this.sentBody = body;
      this.upload.emit("progress", {
        lengthComputable: true,
        loaded: 5,
        total: draft.sizeBytes,
      });
      this.upload.emit("progress", {
        lengthComputable: true,
        loaded: draft.sizeBytes,
        total: draft.sizeBytes,
      });
      this.status = 200;

      for (const listener of this.listeners.get("load") ?? []) {
        listener();
      }
    }

    setRequestHeader(name: string, value: string): void {
      this.headers[name] = value;
    }
  }

  const uploadTransport = new MockUploadTransport();
  const uploadedDraft = await uploadWorkspaceHomePhotoDraft(draft, {
    createUploadTransport: () => uploadTransport,
    fetchImplementation: async (input, init) => {
      requests.push({ input, init });

      return Response.json({
        image: {
          contentType: "image/webp",
          fileName: draft.fileName,
          mediaUrl:
            "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
          sizeBytes: draft.sizeBytes,
          storageKey:
            "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        },
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
        objectKey:
          "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        upload: {
          fields: {},
          headers: {
            "content-type": "image/webp",
          },
          method: "PUT",
          url: "https://uploads.waka.app/presigned/moodboard",
        },
      });
    },
    onProgress(progress, nextDraft) {
      progressPercentages.push(progress.progressPercent);
      lifecycleStates.push(`${nextDraft.uploadState.status}:${nextDraft.uploadState.progressPercent}`);
    },
    onStateChange(nextDraft) {
      lifecycleStates.push(
        `${nextDraft.uploadState.status}:${nextDraft.uploadState.progressPercent}`,
      );
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "/api/media/photos/initiate");
  assert.deepEqual(uploadTransport.openCall, {
    method: "PUT",
    url: "https://uploads.waka.app/presigned/moodboard",
  });
  assert.deepEqual(uploadTransport.headers, {
    "content-type": "image/webp",
  });
  assert.equal(uploadTransport.sentBody, draft.imageFile);
  assert.deepEqual(progressPercentages, [38.46153846153847, 100]);
  assert.deepEqual(lifecycleStates, [
    "pending:0",
    "pending:0",
    "uploading:38",
    "uploading:38",
    "uploading:100",
    "uploading:100",
    "uploaded:100",
  ]);
  assert.deepEqual(uploadedDraft.uploadState, {
    progressPercent: 100,
    status: "uploaded",
    uploadedBytes: draft.sizeBytes,
  });
  assert.equal(
    uploadedDraft.uploadToken?.objectKey,
    "users/user-photo/photos/1775793906000-moodboard-upload.webp",
  );
});

test("uploadWorkspaceHomePhotoDraft refreshes expired presigned metadata and retries against the same draft upload identity", async () => {
  const draft = createPhotoDraft();
  const requests: Array<{
    init?: RequestInit;
    input: RequestInfo | URL;
  }> = [];
  let uploadAttempt = 0;

  class MockUploadTarget {
    addEventListener(): void {}
  }

  class MockUploadTransport {
    readonly upload = new MockUploadTarget();
    readonly headers: Record<string, string> = {};
    readonly url: string;
    status = 0;
    private readonly listeners = new Map<string, Array<() => void>>();

    constructor(url: string) {
      this.url = url;
    }

    addEventListener(
      type: "abort" | "error" | "load",
      listener: () => void,
    ): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    open(_method: string, url: string): void {
      assert.equal(url, this.url);
    }

    send(): void {
      this.status = uploadAttempt === 0 ? 403 : 200;
      uploadAttempt += 1;

      for (const listener of this.listeners.get("load") ?? []) {
        listener();
      }
    }

    setRequestHeader(name: string, value: string): void {
      this.headers[name] = value;
    }
  }

  const transports = [
    new MockUploadTransport("https://uploads.waka.app/presigned/original"),
    new MockUploadTransport("https://uploads.waka.app/presigned/refreshed"),
  ];

  const uploadedDraft = await uploadWorkspaceHomePhotoDraft(draft, {
    createUploadTransport: () => {
      const nextTransport = transports.shift();

      assert.ok(nextTransport);
      return nextTransport;
    },
    fetchImplementation: async (input, init) => {
      requests.push({ input, init });

      const uploadUrl =
        requests.length === 1
          ? "https://uploads.waka.app/presigned/original"
          : "https://uploads.waka.app/presigned/refreshed";

      return Response.json({
        image: {
          contentType: "image/webp",
          fileName: draft.fileName,
          mediaUrl:
            "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
          sizeBytes: draft.sizeBytes,
          storageKey:
            "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        },
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
        objectKey:
          "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        upload: {
          fields: {},
          headers: {
            "content-type": "image/webp",
          },
          method: "PUT",
          url: uploadUrl,
        },
      });
    },
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    contentType: "image/webp",
    fileName: "moodboard.webp",
    sizeBytes: draft.sizeBytes,
  });
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    contentType: "image/webp",
    existingUpload: {
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
      objectKey:
        "users/user-photo/photos/1775793906000-moodboard-upload.webp",
      storageKey:
        "users/user-photo/photos/1775793906000-moodboard-upload.webp",
    },
    fileName: "moodboard.webp",
    sizeBytes: draft.sizeBytes,
  });
  assert.equal(
    uploadedDraft.uploadIdentity?.objectKey,
    "users/user-photo/photos/1775793906000-moodboard-upload.webp",
  );
  assert.equal(uploadedDraft.uploadState.status, "uploaded");
});

test("uploadWorkspaceHomePhotoDraft preserves the local draft in a failed state when the active upload is cancelled", async () => {
  const draft = createPhotoDraft();
  const lifecycleStates: string[] = [];
  const abortController = new AbortController();
  let resolveSendStarted: (() => void) | undefined;
  const sendStarted = new Promise<void>((resolve) => {
    resolveSendStarted = resolve;
  });

  class MockUploadTarget {
    private readonly listeners = new Map<
      string,
      Array<(event: { lengthComputable?: boolean; loaded?: number; total?: number }) => void>
    >();

    addEventListener(
      type: "progress",
      listener: (event: {
        lengthComputable?: boolean;
        loaded?: number;
        total?: number;
      }) => void,
    ): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
  }

  class MockUploadTransport {
    readonly upload = new MockUploadTarget();
    abortCallCount = 0;
    private readonly listeners = new Map<string, Array<() => void>>();

    addEventListener(
      type: "abort" | "error" | "load",
      listener: () => void,
    ): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    abort(): void {
      this.abortCallCount += 1;

      for (const listener of this.listeners.get("abort") ?? []) {
        listener();
      }
    }

    open(): void {}

    send(): void {
      resolveSendStarted?.();
    }

    setRequestHeader(): void {}

    status = 0;
  }

  const uploadTransport = new MockUploadTransport();
  const uploadPromise = uploadWorkspaceHomePhotoDraft(draft, {
    createUploadTransport: () => uploadTransport,
    fetchImplementation: async () =>
      Response.json({
        image: {
          contentType: "image/webp",
          fileName: draft.fileName,
          mediaUrl:
            "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
          sizeBytes: draft.sizeBytes,
          storageKey:
            "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        },
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-upload.webp",
        objectKey:
          "users/user-photo/photos/1775793906000-moodboard-upload.webp",
        upload: {
          fields: {},
          headers: {
            "content-type": "image/webp",
          },
          method: "PUT",
          url: "https://uploads.waka.app/presigned/moodboard",
        },
      }),
    onStateChange(nextDraft) {
      lifecycleStates.push(
        `${nextDraft.uploadState.status}:${nextDraft.uploadState.errorMessage ?? ""}`,
      );
    },
    signal: abortController.signal,
  });

  await sendStarted;
  abortController.abort();

  await assert.rejects(
    uploadPromise,
    new Error(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_ABORTED_ERROR),
  );
  assert.equal(uploadTransport.abortCallCount, 1);
  assert.deepEqual(lifecycleStates, [
    "pending:",
    "pending:",
    `failed:${WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_ABORTED_ERROR}`,
  ]);
});
