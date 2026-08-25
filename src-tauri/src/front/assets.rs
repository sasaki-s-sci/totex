//! Standing in front of the pages the binary was built with.

use std::borrow::Cow;
use std::sync::Arc;

use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Runtime};

use super::serving::read_under;
use super::{Behind, Serving};

/// The front built into the binary, with whatever has been taken since in
/// front of it.
pub struct Front<R: Runtime> {
    serving: Arc<Serving>,
    built_in: Box<dyn Assets<R>>,
}

impl<R: Runtime> Front<R> {
    pub fn new(serving: Arc<Serving>, built_in: Box<dyn Assets<R>>) -> Self {
        Self { serving, built_in }
    }
}

impl<R: Runtime> Assets<R> for Front<R> {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let held = self.serving.held();
        let Some(at) = held.at else {
            return self.built_in.get(key);
        };
        if let Some(bytes) = read_under(&at.dir, key) {
            return Some(Cow::Owned(bytes));
        }
        match held.behind {
            Behind::Nothing => None,
            Behind::BuiltIn => self.built_in.get(key),
            Behind::Taken(dir) => read_under(&dir, key).map(Cow::Owned),
        }
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        // What shipped inside the binary, whichever front is being served.
        // This is a list of what was built, nothing in the app asks for it,
        // and walking a directory on every call would be a worse answer to a
        // question nobody has.
        self.built_in.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        match self.serving.at() {
            // These are hashes of the scripts written inside a page, which the
            // policy is then widened by exactly enough to allow. They are read
            // off the page at build time, and a page from a later release is
            // one this build has never read: none is the only honest answer,
            // and it is the right one — the page this app builds carries a
            // stylesheet the config already allows and no script of its own.
            Some(_) => Box::new(std::iter::empty()),
            None => self.built_in.csp_hashes(html_path),
        }
    }
}

/// No pages at all, for the one moment the context is holding none.
///
/// [`tauri::Context::set_assets`] hands back what it replaced, which is the
/// only way to take the built-in front out of a context by value — and the
/// thing that stands in front of it cannot be built until it has it. So the
/// swap is done twice: this goes in, the built-in comes out, and what is meant
/// to be there goes in after it. Nothing is ever loaded while it is in place.
pub struct Nothing;

impl<R: Runtime> Assets<R> for Nothing {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
