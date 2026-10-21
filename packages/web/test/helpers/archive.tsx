/**
 * THE ARCHIVE WITH ITS RECORDER, AS `Home` MOUNTS IT.
 *
 * `SavesOverlay` no longer owns a recorder (L12): `Home` calls
 * `useArchiveRecorder` and hands it down, so the recorder outlives the
 * archive. A suite that mounts the archive on its own needs something to play
 * `Home`'s part, and this is that, with the same hook rather than a stub —
 * the recorder, its attach and its failure list all run for real.
 */
import type { ComponentProps } from "react";

import { SavesOverlay } from "../../src/components/SavesOverlay";
import { useArchiveRecorder } from "../../src/lib/archive-recorder";

export function Archive(props: Omit<ComponentProps<typeof SavesOverlay>, "recorder">): JSX.Element {
  const recorder = useArchiveRecorder();
  return <SavesOverlay {...props} recorder={recorder} />;
}
