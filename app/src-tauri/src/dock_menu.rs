#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::runtime::NSObject;
use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
use objc2_foundation::ns_string;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

const DOCK_NEW_WINDOW_EVENT: &str = "spec-ops/dock/new-window";

static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);
define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    struct SpecOpsDockMenuHandler;

    impl SpecOpsDockMenuHandler {
        #[unsafe(method(dockNewWindow:))]
        fn dock_new_window(&self, _sender: Option<&NSObject>) {
            if let Ok(guard) = APP_HANDLE.lock() {
                if let Some(app) = guard.as_ref() {
                    let _ = app.emit(DOCK_NEW_WINDOW_EVENT, ());
                }
            }
        }
    }
);

impl SpecOpsDockMenuHandler {
    fn new(mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("dock menu requires the main thread")?;

    let mut guard = APP_HANDLE
        .lock()
        .map_err(|_| "dock menu app handle lock poisoned".to_string())?;
    *guard = Some(app.clone());
    drop(guard);

    let handler = SpecOpsDockMenuHandler::new(mtm);
    let item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            ns_string!("New Window"),
            Some(objc2::sel!(dockNewWindow:)),
            ns_string!(""),
        )
    };
    unsafe {
        item.setTarget(Some(&*handler));
    }

    let menu = NSMenu::new(mtm);
    menu.addItem(&item);

    let ns_app = NSApplication::sharedApplication(mtm);
    unsafe {
        let _: () = msg_send![&*ns_app, setDockMenu: &*menu];
    }

    Ok(())
}
