//! Pixels from the existing webview, so miniature pages never run a second copy of an app.

use std::sync::mpsc::{Sender, channel};
use std::time::Duration;

#[tauri::command(async)]
pub fn canvas_snapshot(webview: tauri::Webview) -> Result<String, String> {
    let (send, receive) = channel();
    webview
        .with_webview(move |view| capture(view, send))
        .map_err(|error| error.to_string())?;
    receive
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Canvas preview timed out".to_string())?
}

#[cfg(target_os = "linux")]
fn capture(view: tauri::webview::PlatformWebview, send: Sender<Result<String, String>>) {
    use base64::Engine;
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt, gio};

    view.inner().snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::NONE,
        None::<&gio::Cancellable>,
        move |result| {
            let result = result
                .map_err(|error| error.to_string())
                .and_then(|surface| {
                    let mut png = Vec::new();
                    surface
                        .write_to_png(&mut png)
                        .map_err(|error| error.to_string())?;
                    Ok(base64::engine::general_purpose::STANDARD.encode(png))
                });
            let _ = send.send(result);
        },
    );
}

#[cfg(windows)]
fn capture(view: tauri::webview::PlatformWebview, send: Sender<Result<String, String>>) {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::w;

    let completed = send.clone();
    let callback =
        CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, json| {
            let result = status.map_err(|error| error.to_string()).and_then(|()| {
                serde_json::from_str::<serde_json::Value>(&json)
                    .map_err(|error| error.to_string())?
                    .get("data")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| "Canvas preview has no image".to_string())
            });
            let _ = completed.send(result);
            Ok(())
        }));
    // The controller and callback are used on the webview's UI thread.
    let result = unsafe {
        view.controller().CoreWebView2().and_then(|view| {
            view.CallDevToolsProtocolMethod(
                w!("Page.captureScreenshot"),
                w!(r#"{"format":"png","captureBeyondViewport":false}"#),
                &callback,
            )
        })
    };
    if let Err(error) = result {
        let _ = send.send(Err(error.to_string()));
    }
}

#[cfg(target_os = "macos")]
fn capture(view: tauri::webview::PlatformWebview, send: Sender<Result<String, String>>) {
    use base64::Engine;
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;

    let callback = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        // WebKit owns these objects for the duration of its completion callback.
        let result = unsafe {
            if let Some(error) = error.as_ref() {
                Err(error.localizedDescription().to_string())
            } else {
                image
                    .as_ref()
                    .and_then(NSImage::TIFFRepresentation)
                    .and_then(|data| NSBitmapImageRep::imageRepWithData(&data))
                    .and_then(|bitmap| {
                        bitmap.representationUsingType_properties(
                            NSBitmapImageFileType::PNG,
                            &NSDictionary::new(),
                        )
                    })
                    .map(|data| base64::engine::general_purpose::STANDARD.encode(data.to_vec()))
                    .ok_or_else(|| "Canvas preview has no image".to_string())
            }
        };
        let _ = send.send(result);
    });
    // Tauri hands out its live WKWebView only on the UI thread.
    unsafe {
        let view = &*view.inner().cast::<WKWebView>();
        view.takeSnapshotWithConfiguration_completionHandler(None, &callback);
    }
}
