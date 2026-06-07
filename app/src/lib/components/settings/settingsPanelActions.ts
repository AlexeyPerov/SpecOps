import { normalizeMaxBinaryOpenAsTextBytes } from "../../services/binaryFileOpen";
import { normalizeMaxOpenWithoutConfirmBytes } from "../../services/largeFileOpen";

export function parseExternalFilesKbInput(rawValue: string): number | null {
  const parsedKb = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedKb)) {
    return null;
  }
  return parsedKb;
}

export function normalizeMaxBinaryOpenAsTextFromKb(rawValue: string): number | null {
  const parsedKb = parseExternalFilesKbInput(rawValue);
  if (parsedKb === null) {
    return null;
  }
  return normalizeMaxBinaryOpenAsTextBytes(parsedKb * 1024);
}

export function normalizeMaxOpenWithoutConfirmFromKb(rawValue: string): number | null {
  const parsedKb = parseExternalFilesKbInput(rawValue);
  if (parsedKb === null) {
    return null;
  }
  return normalizeMaxOpenWithoutConfirmBytes(parsedKb * 1024);
}

export function resolveSelectedListItemId(
  selectedId: string | null,
  itemIds: readonly string[],
  preferredDefaultId?: string | null,
): string | null {
  const ids = new Set(itemIds);
  if (selectedId && ids.has(selectedId)) {
    return selectedId;
  }
  if (preferredDefaultId && ids.has(preferredDefaultId)) {
    return preferredDefaultId;
  }
  return itemIds[0] ?? null;
}

export function resolveSelectedListItem<T extends { id: string }>(
  selectedId: string | null,
  items: readonly T[],
  preferredDefaultId?: string | null,
): T | null {
  if (!selectedId) {
    return items[0] ?? null;
  }
  return items.find((item) => item.id === selectedId) ?? items[0] ?? null;
}

export function nextSelectedIdAfterRemoval(
  removedId: string,
  currentSelectedId: string | null,
  remainingItemIds: readonly string[],
): string | null {
  if (currentSelectedId !== removedId) {
    return currentSelectedId;
  }
  return remainingItemIds[0] ?? null;
}

export function reorderRequiredSections(
  sections: readonly string[],
  sectionIndex: number,
  offset: -1 | 1,
): string[] | null {
  const targetIndex = sectionIndex + offset;
  if (targetIndex < 0 || targetIndex >= sections.length) {
    return null;
  }
  const reordered = [...sections];
  const [section] = reordered.splice(sectionIndex, 1);
  if (!section) {
    return null;
  }
  reordered.splice(targetIndex, 0, section);
  return reordered;
}

export function addRequiredSection(sections: readonly string[]): string[] {
  return [...sections, `Section ${sections.length + 1}`];
}

export function updateRequiredSection(
  sections: readonly string[],
  sectionIndex: number,
  value: string,
): string[] {
  return sections.map((section, index) => (index === sectionIndex ? value : section));
}

export function removeRequiredSection(
  sections: readonly string[],
  sectionIndex: number,
): string[] {
  return sections.filter((_, index) => index !== sectionIndex);
}
