import type { AppCommandId, AppDomainState } from "../../domain/contracts";
import type { EditorCommandRunner } from "../../types/editor";
import type { EditorToolController } from "../../editor/editorToolController";

export type CommandContext = {
  notify: (message: string) => void;
  getState: () => AppDomainState;
  getWindowId: () => string;
  /** Promise-based confirm (in-app dialog; M3). Resolves true on confirm. */
  confirm: (message: string) => Promise<boolean>;
  getEditorRunner: () => EditorCommandRunner | null;
  /** Window-local editor chrome tools (find/replace, go-to). */
  getEditorTools: () => EditorToolController;
  /** Opens (or focuses) the Find-in-Project panel. No-op when not registered. */
  openProjectSearch?: (focusReplace: boolean) => void;
  /** Opens (or focuses) the Quick Open file picker. No-op when not registered. */
  openQuickOpen?: () => void;
  /** Sets console panel visibility. No-op when not registered. */
  setConsoleOpen?: (open: boolean) => void;
};

export type CommandHandler = (
  context: CommandContext,
  payload?: unknown,
) => Promise<void> | void;

export type CommandHandlerMap = Partial<Record<AppCommandId, CommandHandler>>;
