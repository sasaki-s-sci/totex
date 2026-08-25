//! The application layer as a program of its own.
//!
//! What a release of this layer ships and what the app downloads. It is the
//! same code the app already carries — see `lib.rs` — standing beside it as
//! something that can be replaced without the app being replaced, which is the
//! whole of why it is built twice.
//!
//! It reads questions on its standard input and writes answers on its standard
//! output, so there is no address, no port and nothing for anything else on the
//! machine to find: the only thing that can ask it anything is whatever started
//! it holding the other end of those two pipes.

fn main() {
    totex_layer::serve(
        env!("CARGO_PKG_VERSION"),
        std::io::stdin().lock(),
        std::io::stdout(),
    );
}
