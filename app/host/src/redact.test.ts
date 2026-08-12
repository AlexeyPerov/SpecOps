import { describe, expect, it } from "vitest";
import { redactForLogs, redactMessage, containsSecretCanary } from "./redact";
import { makeNotification } from "./protocol";

describe("protocol redaction", () => {
  it("strips bearer tokens and api keys from logged values", () => {
    expect(redactForLogs("Bearer abc123XYZ")).toBe("[redacted]");
    expect(redactForLogs("sk-" + "a".repeat(20))).toBe("[redacted]");
  });

  it("redacts secret-shaped nested fields in a message", () => {
    const message = makeNotification("session.event", {
      event: { authorization: "Bearer supersecret", apiKey: "sk-" + "x".repeat(20), safe: "keep" },
    });
    const redacted = redactMessage(message) as { params: { event: { authorization: string; apiKey: string; safe: string } } };
    expect(redacted.params.event.authorization).toBe("[redacted]");
    expect(redacted.params.event.apiKey).toBe("[redacted]");
    expect(redacted.params.event.safe).toBe("keep");
  });

  it("canary detector recognizes secrets before redaction and clears after", () => {
    expect(containsSecretCanary({ token: "Bearer leak" })).toBe(true);
    expect(containsSecretCanary({ token: "[redacted]" })).toBe(false);
    expect(containsSecretCanary(redactForLogs({ token: "Bearer leak" }))).toBe(false);
  });
});
