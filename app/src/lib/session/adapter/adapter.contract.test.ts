import { expect, it } from "vitest";
import { collectContractEvents } from "./adapter.contract";
import type { SessionEvent } from "../events";
it("rejects duplicate terminals, post-terminal events and missing iterator completion", async () => {
  const terminal = { type: "turn.finished", seq: 1 } as SessionEvent;
  await expect(collectContractEvents((async function* () { yield terminal; yield terminal; })())).rejects.toThrow("exactly one");
  await expect(collectContractEvents((async function* () { yield terminal; yield { type: "text.delta" } as SessionEvent; })())).rejects.toThrow("last");
  await expect(collectContractEvents((async function* () { yield terminal; await new Promise(() => {}); })(), 20)).rejects.toThrow("Timed out");
});
