"use client";

import {
  createContext,
  useEffect,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { installOfflineCaptureReconnectSignalListener } from "../offline/online-state-listener.ts";
import { type WorkspaceHomeClusterPreview } from "./workspace-home-screen-model.ts";

export interface WorkspaceHomeShellState {
  captureDraft: string;
  clusterPreviews: readonly WorkspaceHomeClusterPreview[];
  selectedRecordId: string | undefined;
  setCaptureDraft: Dispatch<SetStateAction<string>>;
  setClusterPreviews: Dispatch<
    SetStateAction<readonly WorkspaceHomeClusterPreview[]>
  >;
  setSelectedRecordId: Dispatch<SetStateAction<string | undefined>>;
}

const WorkspaceHomeShellContext = createContext<WorkspaceHomeShellState | null>(
  null,
);

export interface WorkspaceHomeShellProviderProps {
  children: ReactNode;
}

export function WorkspaceHomeShellProvider({
  children,
}: WorkspaceHomeShellProviderProps) {
  const [captureDraft, setCaptureDraft] = useState("");
  const [clusterPreviews, setClusterPreviews] = useState<
    readonly WorkspaceHomeClusterPreview[]
  >([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string | undefined>();

  useEffect(() => {
    return installOfflineCaptureReconnectSignalListener();
  }, []);

  return (
    <WorkspaceHomeShellContext.Provider
      value={{
        captureDraft,
        clusterPreviews,
        selectedRecordId,
        setCaptureDraft,
        setClusterPreviews,
        setSelectedRecordId,
      }}
    >
      {children}
    </WorkspaceHomeShellContext.Provider>
  );
}

export function useWorkspaceHomeShellState(): WorkspaceHomeShellState {
  const shellState = useContext(WorkspaceHomeShellContext);

  if (shellState === null) {
    throw new Error(
      "WorkspaceHomeShellProvider is required for authenticated workspace views.",
    );
  }

  return shellState;
}
