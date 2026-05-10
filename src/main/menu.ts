import type { App } from 'electron'
import { BrowserWindow, Menu } from 'electron'

/** Desktop menu wiring for FR-49 / AC-32 (command surfaces). */
export function createApplicationMenu(app: App): Menu {
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
        {
          label: 'Workspace folder…',
          click: () => send('open-workspace-folder')
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
        ...(process.platform === 'darwin'
          ? []
          : ([{ type: 'separator' }, { role: 'quit' }] as const))
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
