import type { App } from 'electron'
import { BrowserWindow, Menu } from 'electron'
import { SPEC_OPS_IPC, SPEC_OPS_MENU_COMMANDS, type SpecOpsMenuCommand } from '../ipc/specOpsIpc'

export interface ApplicationMenuHandlers {
  readonly openSettings: () => void
}

/** Desktop menu wiring for FR-49 / AC-32 (command surfaces). */
export function createApplicationMenu(app: App, handlers: ApplicationMenuHandlers): Menu {
  const send = (commandId: SpecOpsMenuCommand): void => {
    const w = BrowserWindow.getFocusedWindow()
    w?.webContents.send(SPEC_OPS_IPC.menuCommand, commandId)
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => handlers.openSettings()
              },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as const)
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send(SPEC_OPS_MENU_COMMANDS.openFile)
        },
        { type: 'separator' },
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => send(SPEC_OPS_MENU_COMMANDS.newUntitled)
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send(SPEC_OPS_MENU_COMMANDS.save)
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send(SPEC_OPS_MENU_COMMANDS.saveAs)
        },
        { type: 'separator' },
        {
          label: 'Misc',
          submenu: [
            {
              label: 'Workspace folder…',
              click: () => send(SPEC_OPS_MENU_COMMANDS.miscWorkspaceFolder)
            },
            {
              label: 'New markdown in workspace…',
              click: () => send(SPEC_OPS_MENU_COMMANDS.miscNewMarkdown)
            },
            {
              label: 'Seed demo documents',
              click: () => send(SPEC_OPS_MENU_COMMANDS.miscSeedDemos)
            },
            {
              label: 'Open fixture sample',
              click: () => send(SPEC_OPS_MENU_COMMANDS.miscOpenFixture)
            }
          ]
        },
        ...(process.platform === 'darwin'
          ? []
          : ([
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => handlers.openSettings()
              },
              { type: 'separator' },
              { role: 'quit' }
            ] as const))
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        {
          label: 'Find…',
          accelerator: 'CmdOrCtrl+F',
          click: () => send(SPEC_OPS_MENU_COMMANDS.find)
        },
        {
          label: 'Replace…',
          accelerator: 'CmdOrCtrl+H',
          click: () => send(SPEC_OPS_MENU_COMMANDS.findReplace)
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
