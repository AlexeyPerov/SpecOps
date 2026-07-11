import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFileCatalogRegistry,
  type WorkspaceFileCatalogRegistry,
} from "./workspaceFileCatalogRegistry";
import type { EnumerateOpenableFilesResult } from "./workspaceTraversal";

function makeEnumerate(paths: string[]) {
  return vi.fn(async (): Promise<EnumerateOpenableFilesResult> => ({
    paths,
    partialErrors: [],
    cancelled: false,
  }));
}

describe("createWorkspaceFileCatalogRegistry", () => {
  let registry: WorkspaceFileCatalogRegistry;

  afterEach(() => {
    registry?.dispose();
  });

  it("isolates catalogs per normalized root so switches cannot leak candidates", async () => {
    const enumerateA = makeEnumerate(["/ws-a/a.ts"]);
    const enumerateB = makeEnumerate(["/ws-b/b.ts"]);
    const enumerateImpl = vi.fn((root: string) =>
      root.endsWith("ws-a") ? enumerateA() : enumerateB(),
    );
    registry = createWorkspaceFileCatalogRegistry({ enumerate: enumerateImpl });

    registry.setActiveRoot("/ws-a");
    await vi.waitFor(() =>
      expect(registry.getActiveSnapshot().status).toBe("ready"),
    );
    expect(registry.getActiveSnapshot().entries).toHaveLength(1);
    expect(
      registry.getActiveSnapshot().entries.some((e) =>
        e.absolutePath.includes("ws-a"),
      ),
    ).toBe(true);

    registry.setActiveRoot("/ws-b");
    await vi.waitFor(() =>
      expect(registry.getActiveSnapshot().status).toBe("ready"),
    );
    // No ws-a candidates leak into the ws-b catalog.
    const entries = registry.getActiveSnapshot().entries;
    expect(entries).toHaveLength(1);
    expect(entries.every((e) => !e.absolutePath.includes("ws-a"))).toBe(true);
  });

  it("caches and reuses a catalog when revisiting a recently-used root", async () => {
    const enumerate = makeEnumerate(["/ws/a.ts"]);
    registry = createWorkspaceFileCatalogRegistry({ enumerate });

    registry.setActiveRoot("/ws");
    await vi.waitFor(() =>
      expect(registry.getActiveSnapshot().status).toBe("ready"),
    );
    const firstCatalog = registry.getActive();
    expect(firstCatalog).not.toBeNull();

    // Switch away and back.
    registry.setActiveRoot(null);
    expect(registry.getActive()).toBeNull();

    registry.setActiveRoot("/ws");
    await vi.waitFor(() =>
      expect(registry.getActiveSnapshot().status).toBe("ready"),
    );
    // Same catalog instance reused — enumeration ran only once.
    expect(registry.getActive()).toBe(firstCatalog);
    expect(enumerate).toHaveBeenCalledTimes(1);
  });

  it("returns an idle snapshot when no root is active", () => {
    registry = createWorkspaceFileCatalogRegistry({ enumerate: makeEnumerate([]) });
    expect(registry.getActive()).toBeNull();
    expect(registry.getActiveSnapshot().status).toBe("idle");
    expect(registry.getActiveSnapshot().entries).toEqual([]);
    expect(registry.getActiveDiagnostics()).toBeNull();
  });

  it("routes watcher events only to the active catalog", async () => {
    const enumerate = makeEnumerate(["/ws/a.ts"]);
    registry = createWorkspaceFileCatalogRegistry({
      enumerate,
      invalidateDebounceMs: 50,
    });
    registry.setActiveRoot("/ws");
    await vi.waitFor(() =>
      expect(registry.getActiveSnapshot().status).toBe("ready"),
    );

    registry.notifyFilesystemChange("/ws/a.ts", "remove");
    expect(registry.getActiveSnapshot().entries).toHaveLength(0);
  });

  it("disposes a single root catalog on disposeRoot", async () => {
    const enumerate = makeEnumerate(["/ws/a.ts"]);
    registry = createWorkspaceFileCatalogRegistry({ enumerate });
    registry.setActiveRoot("/ws");
    await vi.waitFor(() =>
      expect(registry.getActiveSnapshot().status).toBe("ready"),
    );

    registry.disposeRoot("/ws");
    expect(registry.getActive()).toBeNull();
    // Re-activating creates a fresh catalog.
    registry.setActiveRoot("/ws");
    await vi.waitFor(() =>
      expect(registry.getActiveSnapshot().status).toBe("ready"),
    );
    expect(enumerate).toHaveBeenCalledTimes(2);
  });

  it("disposes all catalogs on dispose", async () => {
    const enumerate = makeEnumerate(["/ws/a.ts"]);
    registry = createWorkspaceFileCatalogRegistry({ enumerate });
    registry.setActiveRoot("/ws-a");
    registry.setActiveRoot("/ws-b");
    registry.dispose();

    expect(registry.getActive()).toBeNull();
    expect(registry.getActiveSnapshot().status).toBe("idle");
  });

  it("refresh triggers a rebuild of the active catalog", async () => {
    const enumerate = makeEnumerate(["/ws/a.ts"]);
    registry = createWorkspaceFileCatalogRegistry({ enumerate });
    registry.setActiveRoot("/ws");
    await vi.waitFor(() =>
      expect(registry.getActiveSnapshot().status).toBe("ready"),
    );
    expect(enumerate).toHaveBeenCalledTimes(1);

    registry.refresh();
    await vi.waitFor(() => expect(enumerate).toHaveBeenCalledTimes(2));
  });
});
