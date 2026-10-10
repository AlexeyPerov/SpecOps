import { describe, expect, it } from "vitest";
import { newerComponentJob, type ComponentJob } from "./componentManager";
const job: ComponentJob = { operationId: "j-1-1", generation: 1, sequence: 1, state: "downloading", id: "node", completedBytes: 0, totalBytes: 10, error: null };
describe("native installer event ownership", () => {
  it("accepts ordered progress for the current operation and generation", () => {
    expect(newerComponentJob(undefined, job)).toBe(true);
    expect(newerComponentJob(job, { ...job, sequence: 2, completedBytes: 4 })).toBe(true);
    for (const event of [{ ...job }, { ...job, sequence: 0 }, { ...job, generation: 2, sequence: 2 }, { ...job, operationId: "other", sequence: 2 }, { ...job, completedBytes: 11, sequence: 2 }, { ...job, totalBytes: Infinity, sequence: 2 }, { ...job, operationId: "private/secret-canary", sequence: 2 }]) expect(newerComponentJob(job, event)).toBe(false);
  });
  it("rejects malformed enums and secret-bearing unknown fields before UI callbacks", () => {
    for (const incoming of [null, { ...job, state: "private/secret" }, { ...job, id: "foreign" }, { ...job, error: "secret-canary" }, { ...job, url: "https://secret@invalid.test" }]) expect(newerComponentJob(undefined, incoming as ComponentJob)).toBe(false);
  });
});
