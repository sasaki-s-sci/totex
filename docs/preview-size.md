# Preview build size comparison

Measured on Linux x86_64 using Rust 1.95.0, Node 24.13.0 and pnpm 10.28.2.
The baseline is commit `9f9412ae8118f8b65fd32367fc622ec29e0d27f1`, before this
preview expansion. The final working tree includes media, HTML, CSV/TSV, models
and EPUB. Office, ZIP and the excluded legacy/professional formats are unchanged.

| Artifact | Before (bytes) | After (bytes) | Increase (bytes) | Increase |
| --- | ---: | ---: | ---: | ---: |
| Linux release executable | 24,595,368 | 24,751,952 | +156,584 | +0.64% |
| Frontend assets (sum of file sizes) | 9,655,475 | 10,234,295 | +578,820 | +5.99% |
| Frontend assets (sum of individual gzip sizes) | 3,794,287 | 3,965,470 | +171,183 | +4.51% |

The main executable grew from 23.46 MiB to 23.61 MiB: 152.91 KiB (+0.64%).
Its frontend assets are already embedded; the asset rows must not be added to
the executable row. Individual gzip sizes indicate compressibility, not an
installer or archive download size.

## Method

Both builds used the same source directory, target directory, toolchain and
release configuration. The baseline was extracted using `git archive HEAD`.
After preserving its executable, the final modified/new source files and lockfile
were copied into that directory. Changed Rust sources were touched so Cargo
recompiled them despite preserved copy timestamps. Both builds completed with:

```sh
CARGO_TARGET_DIR=/tmp/totex-previewer-size/target pnpm tauri build --no-bundle --ci -- --offline
```

`beforeBuildCommand` ran the TypeScript check and Vite production build. File
sizes were measured directly, without stripping or changing release optimization.
This comparison covers the main Linux executable, not Windows/macOS builds,
installers, or the separate persistent sidecar. Existing dependencies were kept
at their locked versions; Three.js is shared with the DXF viewer.

Artifacts from this run:

- `/tmp/totex-previewer-size/totex-before`
- `/tmp/totex-previewer-size/totex-after`
- `/tmp/totex-previewer-size/sizes.json`

## Validation

- Release native builds before and after: passed.
- Frontend tests: 54 passed.
- Biome and Rust formatting: passed.
- Browser tests: media, HTML, table sorting/filtering/pagination, four model
  formats with controls/adjacent resources, EPUB navigation/CSS/images/recovery.
- Bounded host file reads: 11 focused Rust tests passed.

See [supported formats and limits](file-previews.md) for viewer behavior.
