#![cfg(target_os = "macos")]

use cocoa::appkit::{NSApp, NSMenu, NSMenuItem};
use cocoa::base::{id, nil};
use cocoa::foundation::NSString;
use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

const DOCK_NEW_WINDOW_EVENT: &str = "spec-ops/dock/new-window";

static APP_HANDLE: Mutex<Option<AppHandle>> = Mutex::new(None);
static HANDLER_CLASS: OnceLock<&'static Class> = OnceLock::new();

extern "C" fn dock_new_window(_this: &Object, _sel: Sel, _sender: id) {
    if let Ok(guard) = APP_HANDLE.lock() {
        if let Some(app) = guard.as_ref() {
            let _ = app.emit(DOCK_NEW_WINDOW_EVENT, ());
        }
    }
}

fn handler_class() -> &'static Class {
    HANDLER_CLASS.get_or_init(|| {
        let mut decl = ClassDecl::new("SpecOpsDockMenuHandler", class!(NSObject))
            .expect("failed to declare SpecOpsDockMenuHandler");
        unsafe {
            decl.add_method(
                sel!(dockNewWindow:),
                dock_new_window as extern "C" fn(&Object, Sel, id),
            );
        }
        decl.register()
    })
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let mut guard = APP_HANDLE
        .lock()
        .map_err(|_| "dock menu app handle lock poisoned".to_string())?;
    *guard = Some(app.clone());
    drop(guard);

    unsafe {
        let handler: id = msg_send![handler_class(), new];
        let title = NSString::alloc(nil).init_str("New Window");
        let item = NSMenuItem::alloc(nil).initWithTitle_action_keyEquivalent_(
            title,
            sel!(dockNewWindow:),
            NSString::alloc(nil).init_str(""),
        );
        let _: () = msg_send![item, setTarget: handler];
        let menu = NSMenu::new(nil);
        menu.addItem_(item);
        let _: () = msg_send![NSApp(), setDockMenu: menu];
        std::mem::forget(handler);
    }

    Ok(())
}
