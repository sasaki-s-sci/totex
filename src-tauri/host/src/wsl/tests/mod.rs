//! Nothing here starts a distribution: the spelling and the list are what is
//! left in this module, and both can be checked without one. The round trips
//! through a held-open shell are `crate::remote`'s tests, which run over a
//! distribution when there is one to reach.

mod list;
mod paths;
