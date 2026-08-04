import type { Readable, Subscriber, Unsubscriber } from "svelte/store";

/**
 * Wraps a source store and re-publishes its values with strict (`===`)
 * equality instead of Svelte's `safe_not_equal`.
 *
 * Svelte's `derived` store calls its internal `set` with `safe_not_equal`,
 * which treats **every object** as changed even when the emitted slice is
 * reference-identical to the previous one. That means a store like
 * `derived(appState, ($state) => $state.contexts)` re-notifies every consumer
 * on every `appState.update()` — including cursor moves that leave `contexts`
 * untouched — because `safe_not_equal(oldContexts, newContexts)` is `true`
 * whenever the value is an object, regardless of reference identity.
 *
 * This is the storm behind P03-08-20: one keystroke re-evaluates every
 * descendant that reads any object-valued app-state slice. Wrapping those
 * slices in `stableDerived` suppresses the spurious notifications: subscribers
 * are only re-run when the published value actually changes by reference (or,
 * for primitives, by value).
 *
 * The source store's computation still runs on every upstream change — this
 * wrapper only gates the downstream fan-out. Pair it with referential-stability
 * work in the selector (return the same object reference when nothing changed)
 * for the full benefit.
 */
export function stableDerived<T>(source: Readable<T>): Readable<T> {
  let current: T;
  let initialized = false;
  const subscribers = new Set<Subscriber<T>>();
  let unsubscribeSource: Unsubscriber | null = null;

  function publish(next: T): void {
    if (initialized && current === next) {
      return;
    }
    initialized = true;
    current = next;
    for (const subscriber of subscribers) {
      subscriber(next);
    }
  }

  return {
    subscribe(run: Subscriber<T>): Unsubscriber {
      subscribers.add(run);
      if (subscribers.size === 1) {
        unsubscribeSource = source.subscribe((value) => {
          publish(value);
        });
      } else if (initialized) {
        // Svelte's store contract: a new subscriber is synchronously notified
        // with the current value. `readable` does this via the initial `sync()`
        // in its start notifier; we mirror it here for late subscribers.
        run(current);
      }
      return () => {
        subscribers.delete(run);
        if (subscribers.size === 0 && unsubscribeSource) {
          unsubscribeSource();
          unsubscribeSource = null;
          // Release the held value so a re-subscribe after everyone leaves does
          // not hand a stale reference to the first new subscriber before the
          // source emits again.
          initialized = false;
        }
      };
    },
  };
}
