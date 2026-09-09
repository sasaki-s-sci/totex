# File previews

File cards choose their initial view by extension. Markdown, SVG and HTML open
in Native; use Preview in the header or Ctrl/Cmd+Shift+V to render them.
CSV/TSV and supported binary formats open rendered.

| Formats | Preview |
| --- | --- |
| PNG/APNG, JPEG/JFIF, GIF, WebP, BMP, ICO, AVIF | Webview image decoder |
| SVG | Image preview beside editable source |
| Markdown (`md`, `markdown`, `mdx`) | Sanitized Markdown; MDX components are not executed |
| PDF | PDF.js |
| DXF | dxf-viewer |
| MP4/M4V, MOV, WebM | Native video controls |
| MP3, M4A, AAC, OGG/OGA/Opus, WAV, FLAC | Native audio controls |
| HTML/HTM | Sandboxed document, retaining embedded CSS and data images |
| CSV/TSV | Read-only table with sorting, filtering and pagination |
| glTF/GLB, STL, OBJ | Three.js with rotation, zoom, pan and fit |
| EPUB | epub.js with table of contents and page navigation |

Media playback depends on the codecs available in the operating system/webview.
Recognizing a container does not guarantee that every codec within it can play.
Playback never starts automatically and stops when its preview unmounts.

Binary previews are limited to 16 MiB per file. Larger files are refused rather
than streamed. Reads remain bounded if a file grows while opening. Text previews
use the first 64 KiB and show a truncation notice when incomplete.

HTML previews retain inline styling but do not execute scripts, submit forms,
navigate links, or load external resources (including adjacent CSS and images).
They are isolated from the application in a sandboxed iframe. Use embedded styles
and data images for a self-contained page.

## Tables

CSV/TSV open as tables; Native still exposes the source text. Column headings
cycle through ascending, descending and original order. Numeric cells sort
numerically and text uses natural ordering; empty cells stay last. The first
row can be toggled between headings and data. Filtering searches all loaded
cells, and pagination shows 100 rows at a time. Neither operation changes the file.

The text read limit still applies: sorting and filtering cover only the loaded
64 KiB. Additional parser limits are 10,001 records, 100 columns and 20,000
characters per cell. A notice identifies partial or malformed input.

## Models

GLB and glTF 2.0 support embedded resources and adjacent `.bin`/image files inside
the model directory. Host reads resolve Unix, Windows and WSL paths without
network requests. Resources outside that directory and remote URLs are refused.
OBJ shows geometry without external MTL materials. Draco, meshopt and Basis
compression decoders are not included. Models are static; animations are not
played. The viewer bounds input, resource count, geometry and allocation sizes.

## Books

EPUB uses the book's styles and internal resources. It provides a table of
contents and previous/next controls. Scripts, remote resources and navigation
outside the book are blocked. Encrypted/DRM books are unsupported. ZIP processing
limits each entry to 8 MiB, total expansion to 64 MiB, and entries to 2,048.

## Excluded formats

Office, ZIP browsing, HEIC/HEIF, TIFF, RAW, PSD/AI, DWG/STEP and legacy formats such
as EPS/RAR are out of scope for this expansion.
