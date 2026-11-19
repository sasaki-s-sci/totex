use std::fs::{self, File};
use std::path::Path;

use tauri::Manager;
use tauri::test::{MockRuntime, mock_builder, mock_context, noop_assets};

use super::super::{MAX_FILE_DATA, read_file_data};
use super::temp_dir;

fn app() -> tauri::App<MockRuntime> {
    let config: tauri::utils::config::Config =
        serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
    assert!(config.app.security.asset_protocol.enable);
    assert!(
        config
            .app
            .security
            .asset_protocol
            .scope
            .allowed_paths()
            .is_empty()
    );
    let mut context = mock_context(noop_assets());
    context.config_mut().app.security.asset_protocol = config.app.security.asset_protocol;
    mock_builder().build(context).unwrap()
}

#[test]
fn large_media_grants_only_the_exact_canonical_file() {
    let app = app();
    let scope = app.asset_protocol_scope();
    let dir = temp_dir("media-source-large");
    let video = dir.join("take[1].MP4");
    let sibling = dir.join("take1.MP4");
    // A sparse file exceeds the old payload limit without allocating its contents in this test.
    File::create(&video)
        .unwrap()
        .set_len(MAX_FILE_DATA * 2 + 1)
        .unwrap();
    fs::write(&sibling, []).unwrap();
    assert!(!scope.is_allowed(&video));
    assert!(
        read_file_data(video.to_str().unwrap())
            .unwrap()
            .data
            .is_none()
    );

    let selected = dir.join(".").join("take[1].MP4");
    let source = crate::media_file(
        selected.to_string_lossy().into_owned(),
        app.handle().clone(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(Path::new(&source), video.canonicalize().unwrap());
    assert_eq!(fs::metadata(&source).unwrap().len(), MAX_FILE_DATA * 2 + 1);
    assert!(scope.is_allowed(&video));
    assert!(
        !scope.is_allowed(&sibling),
        "Filename glob characters are literal"
    );
    assert!(
        !scope.is_allowed(&dir),
        "Selecting a file does not grant its directory"
    );
    assert!(!scope.is_allowed(dir.join("unselected.wav")));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn missing_directories_and_non_media_never_extend_the_scope() {
    let app = app();
    let scope = app.asset_protocol_scope();
    let dir = temp_dir("media-source-invalid");
    let folder = dir.join("folder.mp4");
    let document = dir.join("page.html");
    let disguised = dir.join("movie.mp4.html");
    fs::create_dir(&folder).unwrap();
    fs::write(&document, "<script>window.example = true</script>").unwrap();
    fs::write(&disguised, "<!doctype html>").unwrap();
    for (path, error) in [
        (dir.join("missing.mp4"), "no-such-file"),
        (folder, "is-a-directory"),
        (document, "unsupported-media-type"),
        (disguised, "unsupported-media-type"),
    ] {
        assert_eq!(
            crate::media_file(path.to_string_lossy().into_owned(), app.handle().clone())
                .unwrap_err(),
            error
        );
        assert!(!scope.is_allowed(path));
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn remote_media_without_an_os_path_uses_the_bounded_reader() {
    let app = app();
    assert_eq!(
        crate::media_file(
            "ssh://no-connection-needed/tmp/movie.mp4".into(),
            app.handle().clone()
        ),
        Ok(None)
    );
    #[cfg(not(windows))]
    assert_eq!(
        crate::media_file(
            r"\\wsl.localhost\NoDistributionNeeded\tmp\sound.ogg".into(),
            app.handle().clone()
        ),
        Ok(None)
    );
}

#[cfg(unix)]
#[test]
fn a_media_symlink_grants_its_target_without_granting_future_targets() {
    use std::os::unix::fs::symlink;

    let app = app();
    let scope = app.asset_protocol_scope();
    let dir = temp_dir("media-source-symlink");
    let selected = dir.join("selected.mp4");
    let target = dir.join("video.mp4");
    let other = dir.join("other.mp4");
    let document = dir.join("page.html");
    fs::write(&target, []).unwrap();
    fs::write(&other, []).unwrap();
    fs::write(&document, "<!doctype html>").unwrap();
    symlink(&target, &selected).unwrap();
    let source = crate::media_file(
        selected.to_string_lossy().into_owned(),
        app.handle().clone(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(Path::new(&source), target.canonicalize().unwrap());
    fs::remove_file(&selected).unwrap();
    symlink(&other, &selected).unwrap();
    assert!(scope.is_allowed(&target));
    assert!(!scope.is_allowed(&selected));
    assert!(!scope.is_allowed(&other));

    fs::remove_file(&selected).unwrap();
    symlink(&document, &selected).unwrap();
    assert_eq!(
        crate::media_file(
            selected.to_string_lossy().into_owned(),
            app.handle().clone()
        )
        .unwrap_err(),
        "unsupported-media-type"
    );
    assert!(!scope.is_allowed(&document));
    fs::remove_dir_all(dir).unwrap();
}
