import { createContext } from "svelte";
import type { EditorDocumentSessionCache } from "./editorDocumentSessionCache";

export const [getEditorDocumentSessionCache, setEditorDocumentSessionCache] =
  createContext<EditorDocumentSessionCache>();
