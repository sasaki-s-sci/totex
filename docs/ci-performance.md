# CI build performance

## Baseline

The successful [main run on 2026-09-08](https://github.com/sasaki-s-sci/totex/actions/runs/34282412026)
took 9m29s from creation to completion, including scheduling. Its subsequent
[v0.4.2 run](https://github.com/sasaki-s-sci/totex/actions/runs/34283262548)
took 6m35s. These are observations, not cold-cache benchmarks.

Selected main-run step durations from the Actions jobs API:

| Step | Linux | macOS | Windows |
| --- | ---: | ---: | ---: |
| Install npm dependencies | <10s | 27s | 29s |
| Build persistent sidecar | 46s | 81s | 23s |
| Build installers, including frontend | 348s | 270s | 178s |

Rust-cache restoration took 24s on macOS, 21s on Windows and 29s in Check.
The Check command itself took 46s. The installer step combines frontend work,
Rust compilation, linking and packaging; its duration does not establish that
linking is the bottleneck.

## Changes

- Frontend formatting, lint, tests and the production build run in one job,
  alongside Rust and release-policy checks. All three platform builds consume
  that run's `frontend-dist` artifact and disable Tauri's build hook. They wait
  for Frontend, so compare total elapsed time as well as saved runner time.
- The pnpm content-addressed store is cached by OS, architecture, tool pins and
  lockfile, with a fallback for lockfile changes. Installation still uses the
  frozen lockfile; downloaded packages are preferred when already available.
- Rust dependency caches remain separate for Check and each release target.
  Only main saves them. PRs and tags restore main's caches, avoiding repeated
  large uploads into scopes that future main runs cannot read. The existing
  rust-cache toolchain, environment and manifest invalidation remains enabled.
- CI disables incremental compilation and dev/test debug information. This
  reduces temporary output, linker input and debug cache transfer; release
  optimization and local developer profiles are unchanged.
- New branch builds cancel superseded branch runs. Tag builds finish normally.
- Compressed installers are uploaded without another compression pass. Timing
  reports and installers are retained for seven days, frontend transfer data
  for one day. A retry after artifact expiry requires rerunning its producer.
- Cargo builds/tests produce timing artifacts, including sidecar builds. The
  publisher downloads only `totex-*`, excluding frontend and timing artifacts.
- Setup also uses smaller debug artifacts, main-only cache writes and locked
  dependency resolution. Tool-pin changes now trigger its validation.

## Linker and further work

Rust 1.95 already defaults to LLD for this CI's x86-64 Linux target; the
[switch happened in Rust 1.90](https://blog.rust-lang.org/2025/09/01/rust-lld-on-1.90.0-stable/).
Installing mold without measurement would add another tool and invalidate
compiler caches. Windows and macOS retain their platform linkers.

The [Rust cache action](https://github.com/Swatinem/rust-cache) caches dependency
artifacts by default, not workspace crates. Merely enabling workspace caching
does not guarantee reuse: checkout timestamps and embedded frontend/version
changes can require recompilation. `sccache` is a candidate if the new Cargo
reports show repeated cacheable compilation dominates; evaluate its hit rate
and remote transfer overhead before adding a second large cache. It cannot
remove final executable linking or installer packaging.

Main still validates all three installers before the release planner runs, and
the versioned tag is checked and built again before publication. Removing that
second build would require a release-flow redesign: embedded versions and
signatures prevent simply publishing the preceding main artifacts.

Compare at least one cold run and several warm main/tag pairs after merging.
Record cache restore/save time, sidecar and app compilation, installer time,
queue time and total publication latency. The first run changes Rust cache
keys because the CI profile environment changed. No speedup has been measured
for the new workflow yet.
