import { describe, expect, it, vi } from "vitest";
import { derived, get, writable } from "svelte/store";
import { stableDerived } from "./stableStore";

describe("stableDerived", () => {
  it("does not re-notify subscribers when the emitted value is reference-identical", () => {
    const obj = { n: 1 };
    const upstream = writable(obj);
    const stable = stableDerived(upstream);

    const subscriber = vi.fn();
    const unsubscribe = stable.subscribe(subscriber);
    // Initial value is emitted once on subscribe.
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenLastCalledWith(obj);

    // Set the same reference: no new notification.
    upstream.set(obj);
    expect(subscriber).toHaveBeenCalledTimes(1);

    // A genuinely new reference re-notifies.
    const next = { n: 2 };
    upstream.set(next);
    expect(subscriber).toHaveBeenCalledTimes(2);
    expect(subscriber).toHaveBeenLastCalledWith(next);

    unsubscribe();
  });

  it("re-notifies when a primitive value changes by value", () => {
    const upstream = writable(0);
    const stable = stableDerived(upstream);
    const subscriber = vi.fn();
    stable.subscribe(subscriber);
    expect(subscriber).toHaveBeenCalledTimes(1);

    upstream.set(0);
    expect(subscriber).toHaveBeenCalledTimes(1);

    upstream.set(1);
    expect(subscriber).toHaveBeenCalledTimes(2);
  });

  it("drops the upstream subscription when the last subscriber leaves", () => {
    const upstream = writable(0);
    const stable = stableDerived(upstream);
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = stable.subscribe(a);
    const unsubB = stable.subscribe(b);
    expect(a).toHaveBeenCalledTimes(1);
    // Late subscriber receives the current value immediately.
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    unsubB();
    a.mockClear();
    b.mockClear();

    // After everyone leaves and re-subscribes, the new subscriber gets the
    // latest upstream value (not a stale cached reference).
    const c = vi.fn();
    upstream.set(7);
    stable.subscribe(c);
    expect(c).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledWith(7);
  });

  it("composes with derived()", () => {
    const upstream = writable({ editor: { cursor: 1 } });
    const stable = stableDerived(derived(upstream, ($u) => $u.editor));
    // Same reference → no spurious re-notify.
    const sub = vi.fn();
    stable.subscribe(sub);
    expect(sub).toHaveBeenCalledTimes(1);
    upstream.set({ editor: { cursor: 2 } });
    expect(sub).toHaveBeenCalledTimes(2);
    // Re-set same ref of editor slice.
    const editorSlice = get(stable);
    upstream.set({ editor: editorSlice });
    expect(sub).toHaveBeenCalledTimes(2);
  });
});
