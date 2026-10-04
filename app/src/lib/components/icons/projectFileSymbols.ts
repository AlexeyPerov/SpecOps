import type { ProjectFileIconKind } from "../../services/projectFileIcon";

type Color = "neutral" | "blue" | "yellow" | "orange" | "purple" | "green" | "red";
interface SymbolPath { d: string; solid?: boolean }
interface FileSymbol { color: Color; paths: SymbolPath[]; label?: string }
const line = (d: string): SymbolPath => ({ d });
const solid = (d: string): SymbolPath => ({ d, solid: true });
const symbol = (color: Color, ...paths: SymbolPath[]): FileSymbol => ({ color, paths });
const letter = (color: Color, label: string): FileSymbol => ({ color, paths: [], label });
const paper = "M3.5 1.5H9l3.5 3.5v9.5h-9zM9 1.5V5h3.5";
const cube = "M8 1.5 14 5v7L8 15l-6-3V5zM2 5l6 3.5L14 5M8 8.5V15";

/** Original 16-unit vector symbols, shared by every project file row. */
export const projectFileSymbols = {
  file: symbol("neutral", line(paper)),
  text: symbol("neutral", line(paper), line("M6 8h4M6 11h4")),
  markdown: symbol("blue", solid("M4 2 8 5 12 2v6h3l-7 7-7-7h3Z")),
  readme: symbol("blue", line("M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0ZM8 7v5"), solid("M8 3.7a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6")),
  license: symbol("yellow", line("M8 1.5 13 3v5c0 3-3 5.5-5 6.5C6 13.5 3 11 3 8V3zM5.5 8l1.7 1.7L11 6")),
  git: symbol("neutral", solid("M8 1 15 8 8 15 1 8ZM4.2 4.2h1.6v1.2l4 4H11v1.6H9.4V9.8L7.6 8v2.2H8V12H6v-1.8h.4V6.8L5 5.8h-.8Z")),
  config: symbol("neutral", solid("m6.4 1 .4 1.8h2.4L9.6 1l2 1-.7 1.7 1.5 1.5 1.6-.7 1 2-1.8.4v2.3l1.8.4-1 2-1.6-.7-1.5 1.5.7 1.6-2 1-.4-1.8H6.8L6.4 15l-2-1 .7-1.6-1.5-1.5-1.6.7-1-2 1.8-.4V6.8L1 6.4l1-2 1.6.7 1.5-1.5L4.4 2ZM8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6")),
  json: symbol("yellow", line("M5.5 2H4c-.6 0-1 .5-1 1v3c0 1-.5 2-1.5 2C2.5 8 3 9 3 10v3c0 .5.4 1 1 1h1.5M10.5 2H12c.6 0 1 .5 1 1v3c0 1 .5 2 1.5 2-1 0-1.5 1-1.5 2v3c0 .5-.4 1-1 1h-1.5")),
  yaml: symbol("purple", line("M2 3h2M7 3h7M4 8h2M9 8h5M2 13h2M7 13h7")),
  xml: symbol("orange", line("M5 4 1.5 8 5 12M11 4l3.5 4-3.5 4M9 2 7 14")),
  typescript: symbol("blue", line("M1.5 4H8M4.75 4v8M14 4h-3a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4H9")),
  javascript: symbol("yellow", line("M6 4v6a2 2 0 0 1-4 0M14 4h-3a2 2 0 0 0 0 4h1a2 2 0 0 1 0 4H9")),
  svelte: symbol("orange", line("m11.8 2-6.6 4a3.5 3.5 0 0 0 3.6 6l2-1.2M4.2 14l6.6-4a3.5 3.5 0 0 0-3.6-6l-2 1.2")),
  react: symbol("blue", line("M14 8a6 2.5 0 1 1-12 0 6 2.5 0 0 1 12 0ZM11 2.8a2.5 6 30 1 1-6 10.4 2.5 6 30 0 1 6-10.4ZM5 2.8a2.5 6-30 1 1 6 10.4 2.5 6-30 0 1-6-10.4Z"), solid("M8 7a1 1 0 1 0 0 2 1 1 0 0 0 0-2")),
  vue: symbol("green", solid("M1 3h3l4 7 4-7h3L8 15zM5 3h2l1 2 1-2h2L8 8z")),
  astro: symbol("orange", solid("M8 1 14 12h-3L8 5l-3 7H2z"), line("M6 13q2 3 4 0")),
  html: symbol("orange", line("M5 3 1 8l4 5M11 3l4 5-4 5")),
  css: symbol("purple", line("M5 3 2 8l3 5M11 3l3 5-3 5M9 3 7 13")),
  csharp: letter("purple", "C#"), python: letter("yellow", "Py"),
  rust: letter("orange", "Rs"), go: letter("blue", "Go"), native: letter("blue", "C"),
  java: symbol("orange", line("M4 7h7v4a3.5 3.5 0 0 1-7 0ZM11 8h1a2 2 0 0 1 0 4h-1M6 5c-3-2 3-2 0-4M9 5c-3-2 3-2 0-4M3 15h10")),
  swift: symbol("orange", solid("M2 3 9 7 6 2c6 3 7 6 7 9l2 3-4-1C6 15 2 12 1 9l6 2z")),
  shell: symbol("green", line("M2 4l4 4-4 4M8 12h6")),
  database: symbol("purple", line("M13 4a5 2 0 1 1-10 0 5 2 0 0 1 10 0ZM3 4v8c0 3 10 3 10 0V4M3 8c0 3 10 3 10 0")),
  table: symbol("green", line("M2 2h12v12H2zM2 6h12M2 10h12M6 2v12")),
  image: symbol("green", line("M2 3h12v10H2zM2 11l4-4 3 3 2-2 3 3"), solid("M11 4.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2")),
  audio: symbol("purple", line("M6 11V3l7-1v8M6 5l7-1M6 11a2 1.5 0 1 1-4 0 2 1.5 0 0 1 4 0ZM13 10a2 1.5 0 1 1-4 0 2 1.5 0 0 1 4 0Z")),
  video: symbol("red", line("M2 3h12v10H2z"), solid("M6 5.5 11 8l-5 2.5Z")),
  font: symbol("red", line("M2 13 6 3l4 10M3.5 9h5M10 13l2.5-7L15 13M11 11h3")),
  archive: symbol("orange", line(paper), line("M7 2v1M7 5v1M7 8v1M6 11h2v2H6z")),
  binary: symbol("neutral", line("M4 4h8v8H4zM6 1v3M10 1v3M6 12v3M10 12v3M1 6h3M1 10h3M12 6h3M12 10h3M6 6h4v4H6z")),
  document: symbol("red", line(paper), line("M6 8h4M6 10h4M6 12h2")),
  scene: symbol("blue", line("M8 2v5M3 11V7h10v4M8 7v4M1.5 11h3v3h-3zM6.5 11h3v3h-3zM11.5 11h3v3h-3zM6.5 1h3v3h-3z")),
  prefab: symbol("blue", line(cube)),
  material: symbol("orange", line("M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0Z"), solid("M8 2a6 6 0 0 1 0 12Z")),
  shader: symbol("purple", solid("M9 1 2 9h5l-1 6 8-9H9Z")),
  model: symbol("green", line(cube), line("M2 5l6 10 6-10M8 1.5v7")),
  animation: symbol("orange", line("M3 2v12M13 2v12M1 4h4M1 8h4M1 12h4M11 4h4M11 8h4M11 12h4"), solid("M6 5 10 8l-4 3Z")),
  metadata: symbol("neutral", line("M2 2h7l5 5-7 7-5-5z"), line("M5 4.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z")),
  assembly: symbol("purple", line("M1.5 1.5h5v5h-5zM9.5 1.5h5v5h-5zM1.5 9.5h5v5h-5zM9.5 9.5h5v5h-5zM6.5 4h3M4 6.5v3M12 6.5v3M6.5 12h3")),
  container: symbol("blue", line("M1.5 6h13v7h-13zM5.5 6v7M10 6v7M5.5 2h5v4M2 9h12")),
  build: symbol("orange", line("m3 13 7-7M8 2l2-1 5 5-2 2-5-5zM2 12l2 2M7 4l-2 2")),
} satisfies Record<ProjectFileIconKind, FileSymbol>;
