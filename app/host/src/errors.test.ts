import { expect, it } from "vitest";
import { ProtocolError, toProtocolError } from "./errors";
import { adapterErrors } from "../../src/lib/session/adapter";
it("redacts typed, protocol and internal errors at the boundary", () => {
  for (const error of [
    adapterErrors.internal("Bearer typed-canary"),
    new ProtocolError(-32602, "Bearer protocol-canary", { refresh_token: "oauth-canary", client_secret: "client-canary" }),
    new Error("Bearer internal-canary"),
  ]) {
    expect(JSON.stringify(toProtocolError(error))).not.toContain("canary");
  }
});
