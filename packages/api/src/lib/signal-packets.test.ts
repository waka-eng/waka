import { describe, expect, it } from "vitest";

import { buildMeaningPacket } from "./meaning-packets.js";
import { buildSignalPacket } from "./signal-packets.js";

const now = new Date("2026-05-30T12:00:00.000Z");

function signal(overrides: Partial<Parameters<typeof buildSignalPacket>[0]["signal"]> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    userId: "00000000-0000-4000-8000-000000000002",
    text: "A small studio near serious peers made the work feel more possible.",
    kind: "note",
    category: null,
    cluster: "bridge",
    classifiedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies Parameters<typeof buildSignalPacket>[0]["signal"];
}

function spark(overrides: Partial<Parameters<typeof buildSignalPacket>[0]["sparks"][number]> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    text: "serious peers made the work feel more possible",
    source: "user_selected",
    confidence: 94,
    isPrimary: true,
    note: "environment changed ambition",
    startOffset: 20,
    endOffset: 64,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } satisfies Parameters<typeof buildSignalPacket>[0]["sparks"][number];
}

describe("buildSignalPacket", () => {
  it("builds deterministic signal packet text for signal_packets storage", () => {
    const packet = buildSignalPacket({ signal: signal(), sparks: [spark()] });

    expect(packet.packetText).toContain("waka.signal_packet.v1");
    expect(packet.packetText).toContain("WHAT_HIT");
    expect(packet.packetText).toContain("WHY_IT_MATTERS");
    expect(packet.packetText).not.toContain("waka.meaning_packet.v1");
    expect(packet.sourceMetadata).toMatchObject({
      persistedAs: "signal_packets",
      sparkCount: 1,
      hasPrimarySpark: true,
    });
  });

  it("keeps the old meaning-packet builder export compatible", () => {
    const capturedSignal = signal();
    const sparks = [spark()];

    expect(buildMeaningPacket({ inspiration: capturedSignal, sparks })).toEqual(
      buildSignalPacket({ signal: capturedSignal, sparks }),
    );
  });
});
