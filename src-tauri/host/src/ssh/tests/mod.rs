//! Nothing here opens a connection: the spelling, the command line, the
//! config, the askpass's answer and the reading of a failure are all things
//! that can be checked without an `ssh` at all.

mod askpass;
mod config;
mod paths;
mod probe;
mod secrets;
mod shell;
mod target;
