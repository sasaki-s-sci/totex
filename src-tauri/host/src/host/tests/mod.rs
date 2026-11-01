//! Every far machine there is to try things on, or none to try them on at all.
//!
//! A distribution is real or absent: every machine the CI builds on has none,
//! and the tests over one skip rather than fail there. The ssh host is a fake
//! on every Linux build — an `ssh` that runs the command it was handed on this
//! machine instead of anywhere — so the whole remote layer is exercised on CI
//! through exactly the command lines the real `ssh` would be given.

mod parse;
mod paths;
mod remote;

mod support;
pub(crate) use support::*;
