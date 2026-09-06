import type { IndexedChunk } from "./search";

export const demoSourceCount = 20;

export const demoChunks: IndexedChunk[] = [{
  chunkId: "dl32-qsg:sync-leds",
  sourceId: "dl32-qsg",
  title: "DL32 Quick Start Guide",
  path: "research/midas-m32/corpus/DL32_Quick_Start_Guide_WW.txt",
  locator: "Controls > AES50 SYNC LEDs (page 8; extracted text lines 507-510)",
  authority: "manufacturer-primary",
  versionOrDate: "PDF creation metadata 2023-08-14",
  capturedAt: "2026-09-06T00:00:00.000Z",
  digest: "c4448224bd03147eb6e126fb3005ca5d35c737e16e7bd4426fb59e3896aab9ac",
  text: "AES50 SYNC LEDs indicate proper clock synchronisation on either AES50 port with a green light. A red light indicates the AES50 connection is not synchronised, and off indicates that AES50 is not connected.",
}];
