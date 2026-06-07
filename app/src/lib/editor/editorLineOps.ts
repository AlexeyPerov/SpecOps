export function lineRange(
  text: string,
  from: number,
  to: number,
): { start: number; end: number } {
  const lineStart = text.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const afterTo = to === text.length ? text.length : to + 1;
  const nextBreak = text.indexOf("\n", afterTo);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  return { start: lineStart, end: lineEnd };
}

export type LineTransformResult = {
  text: string;
  from: number;
  to: number;
  message?: string;
};

export function moveLineUp(
  text: string,
  from: number,
  to: number,
): LineTransformResult {
  const current = lineRange(text, from, to);
  const currentLine = text.slice(current.start, current.end);
  if (current.start === 0) {
    return { text, from, to, message: "Already at first line" };
  }
  const prevEnd = current.start - 1;
  const prevStart = text.lastIndexOf("\n", Math.max(0, prevEnd - 1)) + 1;
  const previous = text.slice(prevStart, prevEnd);
  const rebuilt = `${text.slice(0, prevStart)}${currentLine}\n${previous}${text.slice(current.end)}`;
  return {
    text: rebuilt,
    from: from - (previous.length + 1),
    to: to - (previous.length + 1),
    message: "Moved line up",
  };
}

export function moveLineDown(
  text: string,
  from: number,
  to: number,
): LineTransformResult {
  const current = lineRange(text, from, to);
  const currentLine = text.slice(current.start, current.end);
  if (current.end === text.length) {
    return { text, from, to, message: "Already at last line" };
  }
  const nextStart = current.end + 1;
  const nextEndRaw = text.indexOf("\n", nextStart);
  const nextEnd = nextEndRaw === -1 ? text.length : nextEndRaw;
  const nextLine = text.slice(nextStart, nextEnd);
  const rebuilt = `${text.slice(0, current.start)}${nextLine}\n${currentLine}${text.slice(nextEnd)}`;
  return {
    text: rebuilt,
    from: from + (nextLine.length + 1),
    to: to + (nextLine.length + 1),
    message: "Moved line down",
  };
}

export function duplicateLineText(
  text: string,
  from: number,
  to: number,
): LineTransformResult {
  const current = lineRange(text, from, to);
  const currentLine = text.slice(current.start, current.end);
  const insertAt = current.end;
  const separator = insertAt === text.length ? "\n" : "";
  const rebuilt = `${text.slice(0, insertAt)}\n${currentLine}${separator}${text.slice(insertAt)}`;
  return {
    text: rebuilt,
    from,
    to,
    message: "Duplicated line",
  };
}

export function joinLinesText(
  text: string,
  from: number,
  to: number,
): LineTransformResult {
  const current = lineRange(text, from, to);
  const nextBreak = text.indexOf("\n", current.end + 1);
  if (current.end >= text.length || nextBreak === -1) {
    return { text, from, to, message: "Nothing to join" };
  }
  const rebuilt = `${text.slice(0, current.end)} ${text.slice(current.end + 1)}`;
  return {
    text: rebuilt,
    from,
    to,
    message: "Joined lines",
  };
}
