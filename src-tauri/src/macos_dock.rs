//! Native macOS pointer tracking for the always-on-top Dock.
//!
//! WKWebView suppresses DOM hover events while its window is inactive. An
//! `NSTrackingArea` with `ActiveAlways` keeps pointer delivery event-driven,
//! avoiding a permanent frontend-to-native polling loop.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSEvent, NSEventMask, NSEventType, NSTrackingArea, NSTrackingAreaOptions, NSView, NSWindow,
};
use objc2_foundation::{MainThreadMarker, NSObject, NSObjectProtocol, NSRect};
use serde::Serialize;
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Debug)]
struct DockTrackingIvars {
    app: tauri::AppHandle,
    view: NonNull<NSView>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements. The instance is bound
    // to the AppKit main thread and does not implement Drop.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = DockTrackingIvars]
    struct DockTrackingOwner;

    // SAFETY: NSObjectProtocol has no additional invariants.
    unsafe impl NSObjectProtocol for DockTrackingOwner {}

    impl DockTrackingOwner {
        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, event: &NSEvent) {
            self.emit_pointer("enter", event);
        }

        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, event: &NSEvent) {
            self.emit_pointer("move", event);
        }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, event: &NSEvent) {
            self.emit_pointer("leave", event);
        }
    }
);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DockNativePointerEvent {
    phase: &'static str,
    x: f64,
    y: f64,
    primary_pressed: bool,
}

#[derive(Clone)]
struct DockClickMonitor {
    app: tauri::AppHandle,
    view: NonNull<NSView>,
    window: NonNull<NSWindow>,
}

impl DockClickMonitor {
    fn emit(&self, phase: &'static str) {
        // SAFETY: Both pointers belong to the process-lifetime Dock WebView.
        let window = unsafe { self.window.as_ref() };
        let view = unsafe { self.view.as_ref() };
        if !window.isVisible() {
            return;
        }
        let window_point = window.convertPointFromScreen(NSEvent::mouseLocation());
        let point = view.convertPoint_fromView(window_point, None);
        let bounds = view.bounds();
        if point.x < 0.0
            || point.y < 0.0
            || point.x >= bounds.size.width
            || point.y >= bounds.size.height
        {
            return;
        }
        let payload = DockNativePointerEvent {
            phase,
            x: point.x,
            y: if view.isFlipped() {
                point.y
            } else {
                bounds.size.height - point.y
            },
            primary_pressed: phase == "down",
        };
        let _ = self.app.emit_to("dock", "dock:native-pointer", payload);
    }
}

impl DockTrackingOwner {
    fn new(mtm: MainThreadMarker, app: tauri::AppHandle, view: NonNull<NSView>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(DockTrackingIvars { app, view });
        // SAFETY: This invokes NSObject's designated initializer.
        unsafe { msg_send![super(this), init] }
    }

    fn emit_pointer(&self, phase: &'static str, event: &NSEvent) {
        // SAFETY: The tracking owner is retained for exactly the lifetime of
        // the WebView, so the non-owning NSView pointer remains valid here.
        let view = unsafe { self.ivars().view.as_ref() };
        let point = view.convertPoint_fromView(event.locationInWindow(), None);
        let bounds = view.bounds();
        let payload = DockNativePointerEvent {
            phase,
            x: point.x,
            y: if view.isFlipped() {
                point.y
            } else {
                bounds.size.height - point.y
            },
            primary_pressed: NSEvent::pressedMouseButtons() & 1 != 0,
        };
        let _ = self
            .ivars()
            .app
            .emit_to("dock", "dock:native-pointer", payload);
    }
}

/// Install once during application setup. `InVisibleRect` keeps the tracking
/// area synchronized with Dock resizes without rebuilding it.
pub fn install(window: &WebviewWindow) -> tauri::Result<()> {
    let app = window.app_handle().clone();
    window.with_webview(move |webview| {
        let mtm = MainThreadMarker::new().expect("WebView callback must run on the main thread");
        let view_ptr = NonNull::new(webview.inner().cast::<NSView>())
            .expect("Dock WKWebView pointer must not be null");
        // SAFETY: Tauri supplies live WKWebView and NSWindow pointers in this
        // main-thread callback; WKWebView inherits from NSView.
        let view = unsafe { view_ptr.as_ref() };
        let window_ptr = NonNull::new(webview.ns_window().cast::<NSWindow>())
            .expect("Dock NSWindow pointer must not be null");
        let window = unsafe { window_ptr.as_ref() };
        window.setAcceptsMouseMovedEvents(true);

        let owner = DockTrackingOwner::new(mtm, app.clone(), view_ptr);
        let options = NSTrackingAreaOptions::MouseEnteredAndExited
            | NSTrackingAreaOptions::MouseMoved
            | NSTrackingAreaOptions::ActiveAlways
            | NSTrackingAreaOptions::InVisibleRect
            | NSTrackingAreaOptions::EnabledDuringMouseDrag;
        // SAFETY: Owner and view are valid AppKit objects, userInfo is nil, and
        // InVisibleRect instructs AppKit to derive the effective rectangle.
        let area = unsafe {
            NSTrackingArea::initWithRect_options_owner_userInfo(
                NSTrackingArea::alloc(),
                NSRect::ZERO,
                options,
                Some(&owner as &AnyObject),
                None,
            )
        };
        view.addTrackingArea(&area);

        // NSTrackingArea does not retain its owner. Tie the owner to the
        // process-lifetime Dock WebView; AppKit owns the tracking area itself.
        let _ = Retained::into_raw(owner);

        // The local monitor observes the activating click before WebKit can
        // consume it. It returns the original event unchanged and therefore
        // does not alter normal AppKit or Windows interaction behavior.
        let monitor = DockClickMonitor {
            app,
            view: view_ptr,
            window: window_ptr,
        };
        let mask = NSEventMask::LeftMouseDown | NSEventMask::LeftMouseUp;
        let local_block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
            let phase = if unsafe { event.as_ref() }.r#type() == NSEventType::LeftMouseDown {
                "down"
            } else {
                "up"
            };
            monitor.emit(phase);
            event.as_ptr()
        });
        // SAFETY: The local monitor returns the original event unchanged.
        if let Some(token) =
            unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local_block) }
        {
            let _ = Retained::into_raw(token);
        }
    })
}
