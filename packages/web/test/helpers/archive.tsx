/**
 * THE ARCHIVE WITH ITS RECORDER, AS `Home` MOUNTS IT.
 *
 * `SavesOverlay` no longer owns a recorder (L12): `Home` mounts
 * `ArchiveRecorderProvider` around its world and the archive reads the
 * recorder from it, so the recorder outlives the archive. A suite that mounts
 * the archive on its own needs something to play `Home`'s part, and this is
 * that, with the same provider rather than a stub — the recorder, its attach
 * and its failure list all run for real.
 */
import type { ComponentProps } from "react";

import { SavesOverlay } from "../../src/components/SavesOverlay";
import { ArchiveRecorderProvider } from "../../src/lib/archive-recorder";

export function Archive(props: ComponentProps<typeof SavesOverlay>): JSX.Element {
  return <ArchiveRecorderProvider><SavesOverlay {...props} /></ArchiveRecorderProvider>;
}
