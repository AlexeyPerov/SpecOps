import { createContext } from "svelte";
import type { EditorWorkbenchRuntime } from "./editorWorkbenchRuntime";

export const [getEditorWorkbenchRuntime, setEditorWorkbenchRuntime] =
  createContext<EditorWorkbenchRuntime>();
