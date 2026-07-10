import type { AppCommandId, AppDomainState } from "../../domain/contracts";
import type { EditorCommandRunner } from "../../types/editor";

export type CommandContext = {
  notify: (message: string) => void;
  getState: () => AppDomainState;
  getWindowId: () => string;
  /** Promise-based confirm (in-app dialog; M3). Resolves true on confirm. */
  confirm: (message: string) => Promise<boolean>;
  getEditorRunner: () => EditorCommandRunner | null;
  /** Opens (or focuses) the Find-in-Project panel. No-op when not registered. */
  openProjectSearch?: (focusReplace: boolean) => void;
};

export type CommandHandler = (
  context: CommandContext,
  payload?: unknown,
) => Promise<void> | void;

export type CommandHandlerMap = Partial<Record<AppCommandId, CommandHandler>>;
