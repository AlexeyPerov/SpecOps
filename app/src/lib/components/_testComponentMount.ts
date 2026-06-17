/**
 * Tiny Svelte 5 component-mount harness for component tests.
 *
 * The repo has no `@testing-library/svelte`; rather than add a dependency, we
 * use the built-in `mount` / `unmount` from `svelte` and return the host
 * element plus a teardown closure. Each test calls `mountComponent(Component,
 * props)`; teardown is automatic at end-of-test via an `afterEach` safety net,
 * but tests can also call `unmount()` early when they want to assert behaviour
 * across a re-mount with different props.
 *
 * Tests live alongside the components under `app/src/lib/components/*.test.ts`.
 * The vitest config sets `resolve.conditions: ["browser"]` so Svelte 5
 * resolves to its client build (which exports `mount`); without that the
 * server entry throws `lifecycle_function_unavailable` on `mount`.
 */
import { afterEach } from "vitest";
import { mount, unmount, type Component } from "svelte";

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    try {
      cleanup?.();
    } catch {
      // Best-effort teardown; a failing unmount shouldn't mask the test result.
    }
  }
});

export interface Mounted {
  host: HTMLElement;
  unmount: () => void;
}

/**
 * Mount a component into a fresh `<div>` appended to `document.body`, return
 * the host, and register unmount for automatic teardown at end-of-test.
 *
 * The `Component` parameter is typed as Svelte 5's generic `Component` (erased
 * props) so the call site can pass any `.svelte` default export; per-call prop
 * types are checked by the component's own `interface Props`.
 */
export function mountComponent<Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  // `mount`'s generic signature is happy with any `Component<Props, ...>`;
  // we cast to satisfy TS without losing the per-call prop checking the call
  // site gets via the explicit `Props` parameter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instance = mount(component as Component<any>, { target: host, props });
  let unmounted = false;
  const doUnmount = () => {
    if (unmounted) return;
    unmounted = true;
    unmount(instance);
    host.remove();
  };
  cleanups.push(doUnmount);
  return { host, unmount: doUnmount };
}
