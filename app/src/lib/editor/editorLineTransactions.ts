/**
 * Transaction-based line operations.
 *
 * Unlike the former full-document rewrite path, these emit mapped ChangeSpecs
 * against only the affected regions, preserve every selection range, and
 * collapse into one undoable transaction.
 */
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type Text,
} from "@codemirror/state";

export type LineOpKind = "moveUp" | "moveDown" | "duplicate" | "join";

export type LineOpTransaction = {
  changes: ChangeSpec[];
  selection: EditorSelection;
  message?: string;
};

type LineBlock = {
  /** Start of first line in the block. */
  from: number;
  /** End of last line content (CodeMirror line.to — excludes trailing newline). */
  to: number;
};

type MoveUpSpec = LineBlock & {
  prevFrom: number;
  prevTo: number;
};

type MoveDownSpec = LineBlock & {
  nextFrom: number;
  nextTo: number;
};

/** Line span covering a selection range (multi-line selections expand to full lines). */
export function lineBlockForRange(doc: Text, range: SelectionRange): LineBlock {
  const anchor = range.from;
  const head = range.to > range.from ? range.to - 1 : range.to;
  const startLine = doc.lineAt(anchor);
  const endLine = doc.lineAt(Math.max(anchor, head));
  return { from: startLine.from, to: endLine.to };
}

/**
 * Merge overlapping or adjacent line blocks (adjacent = sharing a newline
 * boundary) so each physical line is transformed at most once.
 */
export function mergeLineBlocks(blocks: LineBlock[]): LineBlock[] {
  if (blocks.length === 0) {
    return [];
  }
  const sorted = [...blocks].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: LineBlock[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    const last = merged[merged.length - 1]!;
    // Same block, overlapping, or adjacent across a single newline.
    if (next.from <= last.to + 1) {
      last.to = Math.max(last.to, next.to);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

function collectMergedBlocks(state: EditorState): LineBlock[] {
  const blocks = state.selection.ranges.map((range) =>
    lineBlockForRange(state.doc, range),
  );
  return mergeLineBlocks(blocks);
}

function mapRange(
  range: SelectionRange,
  mapPos: (pos: number) => number,
): SelectionRange {
  const from = mapPos(range.from);
  const to = mapPos(range.to);
  return range.empty
    ? EditorSelection.cursor(from, range.assoc, range.bidiLevel ?? undefined)
    : EditorSelection.range(from, to, range.goalColumn);
}

function remapSelection(
  state: EditorState,
  mapPos: (pos: number) => number,
): EditorSelection {
  return EditorSelection.create(
    state.selection.ranges.map((range) => mapRange(range, mapPos)),
    state.selection.mainIndex,
  );
}

function mapPosMoveUp(pos: number, spec: MoveUpSpec): number {
  const prevLen = spec.prevTo - spec.prevFrom;
  const blockLen = spec.to - spec.from;
  if (pos < spec.prevFrom || pos > spec.to) {
    return pos;
  }
  // Positions in the moving block shift up past the previous line + newline.
  if (pos >= spec.from) {
    return pos - (prevLen + 1);
  }
  // Previous line content moves below the block.
  if (pos <= spec.prevTo) {
    return pos + (blockLen + 1);
  }
  // Newline between prev and block becomes the newline after the block.
  return spec.prevFrom + blockLen;
}

function mapPosMoveDown(pos: number, spec: MoveDownSpec): number {
  const nextLen = spec.nextTo - spec.nextFrom;
  const blockLen = spec.to - spec.from;
  if (pos < spec.from || pos > spec.nextTo) {
    return pos;
  }
  // Next line moves above the block.
  if (pos >= spec.nextFrom) {
    return pos - (blockLen + 1);
  }
  // Block content shifts down past the next line + newline.
  if (pos <= spec.to) {
    return pos + (nextLen + 1);
  }
  // Newline between block and next becomes the newline after the next line.
  return spec.from + nextLen;
}

function buildMoveUp(state: EditorState, blocks: LineBlock[]): LineOpTransaction {
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  const specs: MoveUpSpec[] = [];
  let moved = 0;
  let blocked = 0;

  for (const block of blocks) {
    if (block.from === 0) {
      blocked += 1;
      continue;
    }
    const prevLine = doc.lineAt(block.from - 1);
    const prevText = doc.sliceString(prevLine.from, prevLine.to);
    const blockText = doc.sliceString(block.from, block.to);
    const spec: MoveUpSpec = {
      ...block,
      prevFrom: prevLine.from,
      prevTo: prevLine.to,
    };
    specs.push(spec);
    changes.push({
      from: prevLine.from,
      to: block.to,
      insert: `${blockText}\n${prevText}`,
    });
    moved += 1;
  }

  if (changes.length === 0) {
    return {
      changes: [],
      selection: state.selection,
      message: blocked > 0 ? "Already at first line" : undefined,
    };
  }

  return {
    changes,
    selection: remapSelection(state, (pos) => {
      let next = pos;
      for (const spec of specs) {
        next = mapPosMoveUp(next, spec);
      }
      return next;
    }),
    message: moved > 0 ? "Moved line up" : undefined,
  };
}

function buildMoveDown(state: EditorState, blocks: LineBlock[]): LineOpTransaction {
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  const specs: MoveDownSpec[] = [];
  let moved = 0;
  let blocked = 0;

  for (const block of blocks) {
    if (block.to >= doc.length) {
      blocked += 1;
      continue;
    }
    const nextLine = doc.lineAt(block.to + 1);
    const nextText = doc.sliceString(nextLine.from, nextLine.to);
    const blockText = doc.sliceString(block.from, block.to);
    const spec: MoveDownSpec = {
      ...block,
      nextFrom: nextLine.from,
      nextTo: nextLine.to,
    };
    specs.push(spec);
    changes.push({
      from: block.from,
      to: nextLine.to,
      insert: `${nextText}\n${blockText}`,
    });
    moved += 1;
  }

  if (changes.length === 0) {
    return {
      changes: [],
      selection: state.selection,
      message: blocked > 0 ? "Already at last line" : undefined,
    };
  }

  return {
    changes,
    selection: remapSelection(state, (pos) => {
      let next = pos;
      // Apply bottom-up so earlier (higher) specs see already-adjusted positions
      // when multiple non-overlapping blocks move independently.
      for (let i = specs.length - 1; i >= 0; i--) {
        next = mapPosMoveDown(next, specs[i]!);
      }
      return next;
    }),
    message: moved > 0 ? "Moved line down" : undefined,
  };
}

function buildDuplicate(
  state: EditorState,
  blocks: LineBlock[],
): LineOpTransaction {
  const doc = state.doc;
  const changes: ChangeSpec[] = [];

  for (const block of blocks) {
    const blockText = doc.sliceString(block.from, block.to);
    const atEof = block.to === doc.length;
    const insert = atEof ? `\n${blockText}\n` : `\n${blockText}`;
    changes.push({
      from: block.to,
      to: block.to,
      insert,
    });
  }

  // Insertions sit at/after block ends; keep cursors inside the original block.
  const insertOffsets = blocks.map((block) => {
    const blockText = doc.sliceString(block.from, block.to);
    const atEof = block.to === doc.length;
    return {
      at: block.to,
      length: (atEof ? `\n${blockText}\n` : `\n${blockText}`).length,
    };
  });

  return {
    changes,
    selection: remapSelection(state, (pos) => {
      let delta = 0;
      for (const ins of insertOffsets) {
        if (pos > ins.at) {
          delta += ins.length;
        }
      }
      return pos + delta;
    }),
    message: "Duplicated line",
  };
}

function buildJoin(state: EditorState, blocks: LineBlock[]): LineOpTransaction {
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  const joinAts: number[] = [];
  let joined = 0;
  let blocked = 0;

  for (const block of blocks) {
    if (block.to >= doc.length) {
      blocked += 1;
      continue;
    }
    // Replace the newline after the block's last line with a space.
    changes.push({
      from: block.to,
      to: block.to + 1,
      insert: " ",
    });
    joinAts.push(block.to);
    joined += 1;
  }

  if (changes.length === 0) {
    return {
      changes: [],
      selection: state.selection,
      message: blocked > 0 ? "Nothing to join" : undefined,
    };
  }

  // Same-length replace (newline → space); positions after the join point stay put.
  return {
    changes,
    selection: state.selection,
    message: joined > 0 ? "Joined lines" : undefined,
  };
}

/**
 * Build a line-op transaction for the current selection.
 */
export function buildLineOpTransaction(
  state: EditorState,
  kind: LineOpKind,
): LineOpTransaction {
  const blocks = collectMergedBlocks(state);

  switch (kind) {
    case "moveUp":
      return buildMoveUp(state, blocks);
    case "moveDown":
      return buildMoveDown(state, blocks);
    case "duplicate":
      return buildDuplicate(state, blocks);
    case "join":
      return buildJoin(state, blocks);
  }
}
