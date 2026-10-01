export type ProjectFileIconKind =
  | "file" | "text" | "markdown" | "readme" | "license" | "git" | "config"
  | "json" | "yaml" | "xml" | "typescript" | "javascript" | "svelte"
  | "react" | "vue" | "astro" | "html" | "css" | "csharp" | "python"
  | "rust" | "go" | "native" | "java" | "swift" | "shell" | "database"
  | "table" | "image" | "audio" | "video" | "font" | "archive" | "binary"
  | "document" | "scene" | "prefab" | "material" | "shader" | "model"
  | "animation" | "metadata" | "assembly" | "container" | "build";

const extensions: Readonly<Record<string, ProjectFileIconKind>> = {
  txt: "text", log: "text", rst: "text", snippet: "text",
  md: "markdown", markdown: "markdown", mdx: "markdown",
  json: "json", jsonc: "json", json5: "json", ipynb: "json",
  yaml: "yaml", yml: "yaml", toml: "config", ini: "config", cfg: "config",
  conf: "config", config: "config", properties: "config", env: "config",
  xml: "xml", plist: "xml", xaml: "xml", uxml: "xml", svg: "image",
  ts: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "react", tsx: "react", svelte: "svelte", vue: "vue", astro: "astro",
  html: "html", htm: "html", css: "css", scss: "css", sass: "css", less: "css", uss: "css",
  cs: "csharp", csx: "csharp", py: "python", pyi: "python", rs: "rust", go: "go",
  c: "native", h: "native", cc: "native", cpp: "native", cxx: "native",
  hpp: "native", m: "native", mm: "native", java: "java", kt: "java", kts: "java",
  swift: "swift", sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
  ps1: "shell", bat: "shell", cmd: "shell",
  sql: "database", db: "database", sqlite: "database", sqlite3: "database",
  csv: "table", tsv: "table", xls: "table", xlsx: "table", ods: "table",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  avif: "image", ico: "image", bmp: "image", tga: "image", tif: "image",
  tiff: "image", psd: "image", exr: "image", hdr: "image", spriteatlas: "image",
  wav: "audio", mp3: "audio", ogg: "audio", flac: "audio", aac: "audio", m4a: "audio", aiff: "audio",
  mp4: "video", mov: "video", webm: "video", avi: "video", mkv: "video",
  ttf: "font", otf: "font", woff: "font", woff2: "font",
  zip: "archive", gz: "archive", tar: "archive", tgz: "archive", bz2: "archive", xz: "archive", "7z": "archive", rar: "archive",
  dll: "binary", exe: "binary", so: "binary", dylib: "binary", a: "binary",
  jar: "binary", aar: "binary", srcaar: "binary", wasm: "binary", bundle: "binary",
  pdf: "document", doc: "document", docx: "document", odt: "document", rtf: "document", ppt: "document", pptx: "document",
  unity: "scene", scene: "scene", tscn: "scene", prefab: "prefab",
  mat: "material", material: "material", shader: "shader", shadergraph: "shader",
  shadersubgraph: "shader", cginc: "shader", hlsl: "shader", glsl: "shader", vert: "shader", frag: "shader", compute: "shader",
  fbx: "model", obj: "model", gltf: "model", glb: "model", blend: "model",
  anim: "animation", controller: "animation", overridecontroller: "animation",
  meta: "metadata", asset: "metadata", res: "metadata", tres: "metadata",
  asmdef: "assembly", asmref: "assembly", csproj: "assembly", sln: "assembly", fsproj: "assembly",
  gradle: "build", pom: "build", bzl: "build", cmake: "build", lock: "config",
};

const names: Readonly<Record<string, ProjectFileIconKind>> = {
  ".gitignore": "git", ".gitattributes": "git", ".gitmodules": "git", ".gitkeep": "git",
  ".editorconfig": "config", ".npmrc": "config", ".nvmrc": "config",
  ".prettierignore": "config", ".eslintignore": "config", ".prettierrc": "config",
  ".eslintrc": "config", ".babelrc": "config", ".browserslistrc": "config",
  "dockerfile": "container", "containerfile": "container", ".dockerignore": "container",
  "makefile": "build", "gnumakefile": "build", "justfile": "build", "cmakelists.txt": "build",
};

/** Filename rules precede extension rules; classification never reads file contents. */
export function classifyProjectFileIcon(name: string): ProjectFileIconKind {
  const lower = name.toLowerCase();
  if (Object.hasOwn(names, lower)) return names[lower];
  if (/^readme(?:\.|$)/.test(lower)) return "readme";
  if (/^(?:licen[sc]e|unlicense|copying)(?:\.|$)/.test(lower)) return "license";
  if (lower === ".env" || lower.startsWith(".env.")) return "config";
  if (/^\.(?:prettierrc|eslintrc|babelrc)(?:\.|$)/.test(lower)) return "config";
  if (/^(?:dockerfile|containerfile)(?:\.|$)/.test(lower) || /^(?:docker-)?compose\.ya?ml$/.test(lower)) return "container";
  const extension = lower.slice(lower.lastIndexOf(".") + 1);
  return lower.includes(".") && Object.hasOwn(extensions, extension) ? extensions[extension] : "file";
}
