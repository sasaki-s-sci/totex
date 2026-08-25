//! Every question this layer answers, and the one place they are answered.
//!
//! A table rather than a set of entry points, because there are two ways in and
//! they have to be the same way: the program above either links this crate and
//! calls [`answer`] on the spot, or it runs a copy of this layer as a program of
//! its own and sends it the same name and the same arguments down a pipe. One
//! table means those cannot drift — a command the downloaded layer would answer
//! differently from the built-in one is a command that is not in here twice.
//!
//! Arguments and answers are JSON for the same reason. What the window sends is
//! JSON already; keeping it that way as far as this table means the two paths
//! carry identical bytes, and the shape of every argument is written down once,
//! in the small structs below, rather than once per path.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::fs_browse;

/// What the two ends of the pipe have to agree on.
///
/// Not a version of the layer — a version of the conversation. It moves when a
/// command is added, removed, or has its arguments or its answer changed in a
/// way the other end would read wrongly, and it does not move for anything
/// else. A layer that announces a different number is one this program does not
/// know how to talk to, and it is left alone rather than run: what is served
/// instead is the copy the program carries, which is by definition the one it
/// agrees with.
///
/// Written in `package.json`, which is where `frontContract` is and for the
/// same reason: the release job has to write it into the document a release
/// publishes, so that a copy can tell what it would be downloading before it
/// downloads it. See `build.rs` beside this crate.
pub const PROTOCOL: u32 = match u32::from_str_radix(env!("LAYER_PROTOCOL"), 10) {
    Ok(spoken) => spoken,
    Err(_) => panic!("build.rs writes this out of package.json"),
};

/// Every question in the table, by name.
///
/// Said out loud, and not derived from the table below, because it is what a
/// downloaded layer announces about itself when it starts: a program above that
/// asks for a name this list does not carry is one asking an older layer for
/// something it was never taught, and the answer to that is the built-in copy
/// rather than an error.
pub const ANSWERS: &[&str] = &[
    "list_roots",
    "resolve_folder",
    "describe_folders",
    "read_directory",
    "read_file_head",
    "write_file",
    "fs_read_file",
    "fs_create_entry",
    "fs_duplicate_file",
    "fs_rename_file",
    "fs_delete_file",
];

/// Answers one question, or says that it is not one of this layer's.
///
/// `None` is the whole of the difference between "this went wrong" and "this is
/// not mine": the first is an answer the window is shown, and the second is the
/// program above asking somebody else — which is what happens when a layer
/// older than the program is standing in front of it.
pub fn answer(command: &str, with: Value) -> Option<Result<Value, String>> {
    Some(match command {
        "list_roots" => said(fs_browse::list_roots()),
        "resolve_folder" => {
            read::<Path>(with).and_then(|at| said(fs_browse::resolve_folder(&at.path)?))
        }
        "describe_folders" => {
            read::<Paths>(with).and_then(|at| said(fs_browse::describe_folders(&at.paths)))
        }
        "read_directory" => read::<Listing>(with)
            .and_then(|at| said(fs_browse::read_directory(&at.path, at.show_hidden)?)),
        "read_file_head" => {
            read::<Path>(with).and_then(|at| said(fs_browse::read_file_head(&at.path)?))
        }
        "write_file" => read::<Written>(with)
            .and_then(|at| said(fs_browse::write_file(&at.path, &at.text, at.expect_size)?)),
        "fs_read_file" => read::<Path>(with).and_then(|at| said(fs_browse::read_file(&at.path)?)),
        "fs_create_entry" => read::<Made>(with)
            .and_then(|at| said(fs_browse::create_entry(&at.parent, &at.name, at.directory)?)),
        "fs_duplicate_file" => {
            read::<Path>(with).and_then(|at| said(fs_browse::duplicate_file(&at.path)?))
        }
        "fs_rename_file" => {
            read::<Named>(with).and_then(|at| said(fs_browse::rename_file(&at.path, &at.name)?))
        }
        "fs_delete_file" => {
            read::<Path>(with).and_then(|at| said(fs_browse::delete_file(&at.path)?))
        }
        _ => return None,
    })
}

/// The arguments of one command, or the same complaint however they are wrong.
///
/// A layer is asked by the program that carries a copy of it, so arguments that
/// will not read are a disagreement between two builds rather than anything a
/// person did — which is exactly what [`PROTOCOL`] is for, and this is what it
/// looks like when that has been got wrong.
fn read<T: for<'a> Deserialize<'a>>(with: Value) -> Result<T, String> {
    serde_json::from_value(with).map_err(|error| format!("the layer was asked wrongly: {error}"))
}

/// One answer, on its way back as JSON.
fn said<T: serde::Serialize>(answer: T) -> Result<Value, String> {
    serde_json::to_value(answer).map_err(|error| format!("the layer cannot say that: {error}"))
}

#[derive(Deserialize)]
struct Path {
    path: String,
}

#[derive(Deserialize)]
struct Paths {
    paths: Vec<String>,
}

#[derive(Deserialize)]
struct Listing {
    path: String,
    show_hidden: bool,
}

#[derive(Deserialize)]
struct Written {
    path: String,
    text: String,
    expect_size: u64,
}

#[derive(Deserialize)]
struct Made {
    parent: String,
    name: String,
    directory: bool,
}

#[derive(Deserialize)]
struct Named {
    path: String,
    name: String,
}

/// What a layer says about itself the moment it starts.
///
/// Written by the program of its own and read by the program above it, which is
/// the only chance either has to find out that they do not agree — see
/// [`PROTOCOL`].
pub fn hello(version: &str) -> Value {
    json!({ "layer": { "version": version, "protocol": PROTOCOL, "answers": ANSWERS } })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_name_in_the_list_is_a_name_the_table_answers_to() {
        for command in ANSWERS {
            assert!(
                answer(command, json!({})).is_some(),
                "{command} is announced and not answered"
            );
        }
    }

    #[test]
    fn a_name_that_is_not_the_layers_is_not_an_error() {
        assert!(answer("pty_open", json!({})).is_none());
        assert!(answer("", json!({})).is_none());
    }

    #[test]
    fn a_question_asked_wrongly_comes_back_as_an_answer_rather_than_a_panic() {
        let wrong =
            answer("read_directory", json!({ "path": 7 })).expect("the layer answers to that name");
        assert!(wrong.is_err());
    }

    #[test]
    fn a_directory_is_read_through_the_table_the_way_it_is_read_directly() {
        let temp = std::env::temp_dir();
        let through = answer(
            "read_directory",
            json!({ "path": temp.to_string_lossy(), "show_hidden": false }),
        )
        .expect("the layer answers to that name")
        .expect("the temporary directory is readable");
        let directly = serde_json::to_value(
            fs_browse::read_directory(&temp.to_string_lossy(), false).expect("the same directory"),
        )
        .expect("a listing is JSON");
        // The names, not the whole of it: something else on this machine may
        // write into the temporary directory between the two readings.
        assert_eq!(through["path"], directly["path"]);
    }
}
