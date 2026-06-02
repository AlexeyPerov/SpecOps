#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, Sel};
use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
use objc2_foundation::{ns_string, NSInteger, NSString};
use serde::Deserialize;
use std::cell::RefCell;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

const DOCK_NEW_WINDOW_EVENT: &str = "spec-ops/dock/new-window";
const DOCK_OPEN_RECENT_EVENT: &str = "spec-ops/dock/open-recent";
const DOCK_CLEAR_RECENT_EVENT: &str = "spec-ops/dock/clear-recent";

static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);
static RECENT_PATHS: Mutex<Vec<String>> = Mutex::new(Vec::new());

thread_local! {
    static DOCK_HANDLER: RefCell<Option<Retained<SpecOpsDockMenuHandler>>> = const { RefCell::new(None) };
    static DOCK_MENU: RefCell<Option<Retained<NSMenu>>> = const { RefCell::new(None) };
}

#[derive(Clone, Deserialize)]
pub struct DockRecentItem {
    path: String,
    label: String,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct SpecOpsDockMenuHandler;

    impl SpecOpsDockMenuHandler {
        #[unsafe(method(dockNewWindow:))]
        fn dock_new_window(&self, _sender: Option<&AnyObject>) {
            emit_dock_event(DOCK_NEW_WINDOW_EVENT, ());
        }

        #[unsafe(method(dockOpenRecent:))]
        fn dock_open_recent(&self, sender: Option<&AnyObject>) {
            let Some(sender) = sender else {
                return;
            };
            let Some(item) = sender.downcast_ref::<NSMenuItem>() else {
                return;
            };
            let index = item.tag();
            if index < 0 {
                return;
            }
            let path = RECENT_PATHS
                .lock()
                .ok()
                .and_then(|paths| paths.get(index as usize).cloned());
            if let Some(path) = path {
                emit_dock_event(DOCK_OPEN_RECENT_EVENT, path);
            }
        }

        #[unsafe(method(dockClearRecent:))]
        fn dock_clear_recent(&self, _sender: Option<&AnyObject>) {
            emit_dock_event(DOCK_CLEAR_RECENT_EVENT, ());
        }
    }
);

impl SpecOpsDockMenuHandler {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

fn emit_dock_event<T: serde::Serialize + Clone>(event: &str, payload: T) {
    if let Ok(guard) = APP_HANDLE.lock() {
        if let Some(app) = guard.as_ref() {
            let _ = app.emit(event, payload);
        }
    }
}

fn make_action_item(
    mtm: MainThreadMarker,
    handler: &SpecOpsDockMenuHandler,
    title: &NSString,
    action: Sel,
    tag: NSInteger,
    enabled: bool,
) -> Retained<NSMenuItem> {
    let item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            title,
            Some(action),
            ns_string!(""),
        )
    };
    unsafe {
        item.setTarget(Some(handler));
    }
    item.setTag(tag);
    item.setEnabled(enabled);
    item
}

fn rebuild_menu(mtm: MainThreadMarker, recent_items: &[DockRecentItem]) {
    if let Ok(mut paths) = RECENT_PATHS.lock() {
        *paths = recent_items.iter().map(|item| item.path.clone()).collect();
    }

    DOCK_MENU.with(|menu_cell| {
        DOCK_HANDLER.with(|handler_cell| {
            let menu_borrow = menu_cell.borrow();
            let handler_borrow = handler_cell.borrow();
            let Some(menu) = menu_borrow.as_ref() else {
                return;
            };
            let Some(handler) = handler_borrow.as_ref() else {
                return;
            };

            menu.removeAllItems();

            let new_window = make_action_item(
                mtm,
                handler,
                ns_string!("New Window"),
                objc2::sel!(dockNewWindow:),
                -1,
                true,
            );
            menu.addItem(&new_window);
            menu.addItem(&NSMenuItem::separatorItem(mtm));

            for (index, recent) in recent_items.iter().enumerate() {
                let title = NSString::from_str(&recent.label);
                let item = make_action_item(
                    mtm,
                    handler,
                    &title,
                    objc2::sel!(dockOpenRecent:),
                    index as NSInteger,
                    true,
                );
                menu.addItem(&item);
            }

            menu.addItem(&NSMenuItem::separatorItem(mtm));

            let clear_recent = make_action_item(
                mtm,
                handler,
                ns_string!("Clear Recent"),
                objc2::sel!(dockClearRecent:),
                -1,
                !recent_items.is_empty(),
            );
            menu.addItem(&clear_recent);
        });
    });
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("dock menu requires the main thread")?;

    let mut app_guard = APP_HANDLE
        .lock()
        .map_err(|_| "dock menu app handle lock poisoned".to_string())?;
    *app_guard = Some(app.clone());
    drop(app_guard);

    let handler = SpecOpsDockMenuHandler::new(mtm);
    let menu = NSMenu::new(mtm);

    DOCK_HANDLER.with(|handler_cell| {
        *handler_cell.borrow_mut() = Some(handler);
    });
    DOCK_MENU.with(|menu_cell| {
        *menu_cell.borrow_mut() = Some(menu.clone());
    });

    rebuild_menu(mtm, &[]);

    let ns_app = NSApplication::sharedApplication(mtm);
    unsafe {
        let _: () = msg_send![&*ns_app, setDockMenu: &*menu];
    }

    Ok(())
}

pub fn refresh(items: Vec<DockRecentItem>) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("dock menu requires the main thread")?;
    rebuild_menu(mtm, &items);
    Ok(())
}

#[tauri::command]
pub fn refresh_dock_menu(app: AppHandle, items: Vec<DockRecentItem>) -> Result<(), String> {
    app.run_on_main_thread(move || {
        if let Err(error) = refresh(items) {
            eprintln!("failed to refresh dock menu: {error}");
        }
    })
    .map_err(|error| error.to_string())?;
    Ok(())
}
