export type EditorCommandRunner = {
  undo: () => void;
  redo: () => void;
  indent: () => void;
  outdent: () => void;
  moveLineUp: () => void;
  moveLineDown: () => void;
  duplicateLine: () => void;
  joinLines: () => void;
  setWrap: (value: boolean) => void;
  setZoom: (zoom: number) => void;
  findNext: (query: string, caseSensitive: boolean) => boolean;
  replaceCurrent: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => boolean;
  replaceAll: (
    query: string,
    replacement: string,
    caseSensitive: boolean,
  ) => number;
  goToLine: (line: number) => boolean;
};
