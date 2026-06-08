import type { AppCommandId, AppDomainState } from "../../domain/contracts";
import type { EditorCommandRunner } from "../../types/editor";

export type CommandContext = {
  setThemePaneOpen: (next: boolean) => void;
  isThemePaneOpen: () => boolean;
  setSettingsDialogOpen: (next: boolean) => void;
  isSettingsDialogOpen: () => boolean;
  notify: (message: string) => void;
  getState: () => AppDomainState;
  getWindowId: () => string;
  confirm: (message: string) => boolean;
  getEditorRunner: () => EditorCommandRunner | null;
};

export type CommandHandler = (
  context: CommandContext,
  payload?: unknown,
) => Promise<void> | void;

export type CommandHandlerMap = Partial<Record<AppCommandId, CommandHandler>>;
