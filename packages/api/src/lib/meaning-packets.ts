/**
 * Compatibility exports for the old meaning-packet service name.
 *
 * New code should import from `signal-packets`; the persisted table is still
 * `meaning_packets` during the phased migration.
 */

import {
  buildSignalPacket,
  type BuildSignalPacketInput,
  persistSignalPacketForSignal,
  type PersistSignalPacketParams,
} from "./signal-packets.js";

export type {
  BuiltSignalPacket as BuiltMeaningPacket,
  PersistSignalPacketResult as PersistMeaningPacketResult,
  SignalPacket as MeaningPacket,
  WakaDb,
} from "./signal-packets.js";

export interface BuildMeaningPacketInput
  extends Omit<BuildSignalPacketInput, "signal"> {
  inspiration: BuildSignalPacketInput["signal"];
}

export function buildMeaningPacket(params: BuildMeaningPacketInput) {
  return buildSignalPacket({
    signal: params.inspiration,
    sparks: params.sparks,
  });
}

export interface PersistMeaningPacketParams
  extends Omit<PersistSignalPacketParams, "signalId"> {
  inspirationId: string;
}

export async function persistMeaningPacketForInspiration(
  params: PersistMeaningPacketParams,
) {
  return persistSignalPacketForSignal({
    db: params.db,
    userId: params.userId,
    signalId: params.inspirationId,
  });
}
