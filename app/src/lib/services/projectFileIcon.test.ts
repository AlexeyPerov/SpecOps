import { describe, expect, it } from "vitest";
import { classifyProjectFileIcon } from "./projectFileIcon";

describe("project file icon classification", () => {
  it.each([
    ["README.md", "readme"], ["readme", "readme"], ["ReadMe.MDX", "readme"],
    ["LICENSE.txt", "license"], ["UNLICENSE", "license"], ["COPYING", "license"],
    [".gitignore", "git"], [".gitattributes", "git"], [".gitkeep", "git"],
    [".editorconfig", "config"], [".env.local", "config"], [".prettierrc.json", "config"],
    [".mcp.json", "json"], ["Dockerfile.prod", "container"], ["compose.yaml", "container"],
    ["CMakeLists.txt", "build"], ["Makefile", "build"],
  ])("prioritizes special name %s over its extension", (name, expected) => {
    expect(classifyProjectFileIcon(name)).toBe(expected);
  });

  it.each([
    ["main.TS", "typescript"], ["types.d.mts", "typescript"], ["vite.config.mjs", "javascript"],
    ["view.tsx", "react"], ["App.svelte", "svelte"], ["index.astro", "astro"],
    ["AGENTS.md", "markdown"], ["CONTRIBUTING.md", "markdown"],
    ["Player.cs", "csharp"], ["main.py", "python"], ["lib.rs", "rust"],
    ["level.unity", "scene"], ["enemy.prefab", "prefab"], ["surface.mat", "material"],
    ["effect.shadergraph", "shader"], ["shared.cginc", "shader"], ["mesh.fbx", "model"],
    ["walk.anim", "animation"], ["movement.controller", "animation"],
    ["texture.png.meta", "metadata"], ["settings.asset", "metadata"],
    ["runtime.asmdef", "assembly"], ["game.csproj", "assembly"],
    ["cover.webp", "image"], ["icon.svg", "image"], ["sound.wav", "audio"],
    ["clip.mp4", "video"], ["font.woff2", "font"], ["data.csv", "table"],
    ["query.sql", "database"], ["report.pdf", "document"], ["backup.tar.gz", "archive"],
    ["runtime.dll", "binary"], ["build.ps1", "shell"],
  ])("classifies %s without reading its contents", (name, expected) => {
    expect(classifyProjectFileIcon(name)).toBe(expected);
  });

  it.each(["unknown.custom", "no-extension", ".hidden", "READMEish.md.custom", "constructor", "file.constructor", "toString", "file.", ""])(
    "uses a generic symbol for %s", (name) => expect(classifyProjectFileIcon(name)).toBe("file"),
  );
});
