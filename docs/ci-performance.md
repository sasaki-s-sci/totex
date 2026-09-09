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

- Frontend formatting, lint, tests and type checking run alongside Rust and
  release-policy checks. Native jobs also start immediately and use Tauri's
  normal frontend build hook. Sharing one frontend artifact was measured and
  reverted because waiting for its producer delayed the critical path.
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
  reports and installers are retained for seven days. A retry after artifact
  expiry requires rerunning its producer.
- Cargo builds/tests produce timing artifacts, including sidecar builds. The
  publisher downloads only `totex-*`, excluding timing artifacts.
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
for the final workflow yet.


## First measured iteration (2026-09-09)

| Measurement | Before | Shared-frontend iteration |
| --- | ---: | ---: |
| Main / same-commit warm validation | 7m10s | 7m55s |
| Check job | 2m31s | 1m17s |
| Linux job | 4m19s | 4m18s |
| Windows job | 4m36s | 5m17s |
| macOS job | 7m02s | 7m10s |
| Tag build and publication | 8m31s | 7m01s |

Sources: [before main](https://github.com/sasaki-s-sci/totex/actions/runs/34304635628),
[before tag](https://github.com/sasaki-s-sci/totex/actions/runs/34305105366),
[first run](https://github.com/sasaki-s-sci/totex/actions/runs/34305299254),
[same-commit warm run](https://github.com/sasaki-s-sci/totex/actions/runs/34305974280),
[after tag](https://github.com/sasaki-s-sci/totex/actions/runs/34305973722).
The first run after cache-key changes took 10m03s. Check's cache shrank from
1,554,215,809 to 547,119,029 bytes (65%). Warm Cargo tests reused 563 units and
rebuilt 13; the initial run rebuilt 217. Warm Linux app compilation took 65.5s,
while its combined installer step took 185s, leaving about two minutes outside
Cargo compilation.

Sharing the frontend delayed the native jobs by roughly 45s including runner
scheduling, without a corresponding reduction in native job duration. That
serialization has been removed. The tag run improved, but substantial macOS
variation means one pair is insufficient to attribute its 90s gain to these
changes. Check and cache size improved clearly; end-to-end speedup was not
established by this iteration.


## Runner toolchains caused unrelated cache misses

The [parallel-build rerun](https://github.com/sasaki-s-sci/totex/actions/runs/34306600684)
passed in 8m39s, with Check in 1m27s. Linux missed its Rust cache and rebuilt
542 units despite no dependency change. Its cache configuration included both
our pinned Rust 1.95.0 and the unused runner compiler, which changed from
1.98.0 to 1.98.1 between runs. That changed the environment key from `c2db2413`
to `92dce928`. The old 529 MiB cache was still present; this was key instability,
not eviction. Linux compilation returned from 65.5s to 255.3s.

Before restoring Rust caches, app and Setup jobs now remove unused Rust
installations from their disposable runners. The active toolchain must match
`RUST_VERSION` before removal. The cache retains its compiler, flags, platform
and dependency validation, but no longer varies with unused preinstalled Rust
versions. This change needs one cache warm-up under the new stable identity.
