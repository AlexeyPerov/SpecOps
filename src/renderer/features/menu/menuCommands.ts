import type { SpecOpsMenuCommand } from '../../../ipc/specOpsIpc'
import { SPEC_OPS_MENU_COMMANDS } from '../../../ipc/specOpsIpc'

export interface MenuCommandHandlers {
  openFile: () => void
  newUntitled: () => void
  save: () => void
  saveAs: () => void
  miscWorkspaceFolder: () => void
  miscNewMarkdown: () => void
  miscSeedDemos: () => void
  miscOpenFixture: () => void
  find: () => void
  findReplace: () => void
}

export function executeMenuCommand(cmd: SpecOpsMenuCommand, handlers: MenuCommandHandlers): void {
  switch (cmd) {
    case SPEC_OPS_MENU_COMMANDS.openFile:
      handlers.openFile()
      break
    case SPEC_OPS_MENU_COMMANDS.miscWorkspaceFolder:
      handlers.miscWorkspaceFolder()
      break
    case SPEC_OPS_MENU_COMMANDS.miscNewMarkdown:
      handlers.miscNewMarkdown()
      break
    case SPEC_OPS_MENU_COMMANDS.miscSeedDemos:
      handlers.miscSeedDemos()
      break
    case SPEC_OPS_MENU_COMMANDS.miscOpenFixture:
      handlers.miscOpenFixture()
      break
    case SPEC_OPS_MENU_COMMANDS.newUntitled:
      handlers.newUntitled()
      break
    case SPEC_OPS_MENU_COMMANDS.save:
      handlers.save()
      break
    case SPEC_OPS_MENU_COMMANDS.saveAs:
      handlers.saveAs()
      break
    case SPEC_OPS_MENU_COMMANDS.find:
      handlers.find()
      break
    case SPEC_OPS_MENU_COMMANDS.findReplace:
      handlers.findReplace()
      break
    default:
      break
  }
}
