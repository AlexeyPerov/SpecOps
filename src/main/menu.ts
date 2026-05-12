import type { App } from 'electron'
import { BrowserWindow, Menu } from 'electron'

export interface ApplicationMenuHandlers {
  readonly openSettings: () => void
}

/** Desktop menu wiring for FR-49 / AC-32 (command surfaces). */
export function createApplicationMenu(app: App, handlers: ApplicationMenuHandlers): Menu {
  const send = (commandId: string): void => {
    const w = BrowserWindow.getFocusedWindow()
    w?.webContents.send('specops:menu-command', commandId)
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
          click: () => send('open-file')
        },
        { type: 'separator' },
        {
          label: 'New untitled',
          accelerator: 'CmdOrCtrl+N',
          click: () => send('new-untitled')
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('save')
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('save-as')
        },
        { type: 'separator' },
        {
          label: 'Misc',
          submenu: [
            {
              label: 'Workspace folder…',
              click: () => send('misc-workspace-folder')
            },
            {
              label: 'New markdown in workspace…',
              click: () => send('misc-new-markdown')
            },
            {
              label: 'Seed demo documents',
              click: () => send('misc-seed-demos')
            },
            {
              label: 'Open fixture sample',
              click: () => send('misc-open-fixture')
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
          click: () => send('find')
        },
        {
          label: 'Replace…',
          accelerator: 'CmdOrCtrl+H',
          click: () => send('find-replace')
        }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
