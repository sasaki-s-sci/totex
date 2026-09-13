import DOMPurify from "dompurify";
import JSZip from "jszip";

const MAX_ENTRIES = 2_048;
const MAX_ENTRY = 8 * 1024 * 1024;
const MAX_EXPANDED = 64 * 1024 * 1024;
export const EPUB_POLICY =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; media-src blob: data:; base-uri 'none'; form-action 'none'";

/** Reject ZIP64, split archives, excessive entries and declared expansion before loading. */
export function validateEpubZip(bytes: Uint8Array): void {
  if (bytes.length > 16 * 1024 * 1024) throw new Error("epub-too-large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65_557); end--) {
    if (
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    )
      break;
  }
  if (end < Math.max(0, bytes.length - 65_557)) throw new Error("invalid-epub");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (
    view.getUint32(end + 4, true) !== 0 ||
    count === 0 ||
    count > MAX_ENTRIES ||
    view.getUint16(end + 8, true) !== count
  )
    throw new Error("unsupported-epub");
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("invalid-epub");
    const size = view.getUint32(offset + 24, true);
    total += size;
    if (size > MAX_ENTRY || total > MAX_EXPANDED || view.getUint16(offset + 8, true) & 1)
      throw new Error("epub-too-large");
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  if (offset !== end) throw new Error("unsupported-epub");
}

/** Only relative book references survive preprocessing; the renderer creates its own blobs. */
export function internalEpubLink(value: string): boolean {
  return (
    ![...value].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    !/^(?:[a-z][a-z\d+.-]*:|[/\\]{2})/i.test(value.trim()) &&
    !value.includes("\\")
  );
}

export function cleanEpubDocument(text: string, chapter: boolean, generated = false): string {
  if (!chapter) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("invalid-epub");
    for (const element of xml.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) {
        if (
          ["href", "src", "full-path"].includes(attribute.localName) &&
          !internalEpubLink(attribute.value)
        )
          element.removeAttributeNode(attribute);
      }
    }
    return new XMLSerializer().serializeToString(xml);
  }
  const page = DOMPurify.sanitize(text, {
    ALLOWED_URI_REGEXP: /^(?:(?:blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    ADD_TAGS: ["link"],
    ADD_ATTR: ["epub:type", "xmlns:epub"],
    FORBID_TAGS: [
      "script",
      "noscript",
      "iframe",
      "frame",
      "frameset",
      "object",
      "embed",
      "base",
      "meta",
      "form",
      "foreignObject",
      "animate",
      "animateMotion",
      "animateTransform",
      "set",
      "discard",
    ],
    FORBID_ATTR: [
      "target",
      "ping",
      "download",
      "srcset",
      "action",
      "formaction",
      "autoplay",
      "autofocus",
      "contenteditable",
    ],
  }) as HTMLElement;
  for (const element of page.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (
        ["href", "src", "poster", "background"].includes(attribute.localName) &&
        !internalEpubLink(attribute.value) &&
        !(generated && /^(?:blob:|data:)/i.test(attribute.value))
      )
        element.removeAttributeNode(attribute);
    }
  }
  page.setAttribute("xmlns:epub", "http://www.idpf.org/2007/ops");
  const head =
    page.querySelector("head") ??
    page.insertBefore(document.createElement("head"), page.firstChild);
  const policy = document.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", EPUB_POLICY);
  head.prepend(policy);
  return new XMLSerializer().serializeToString(page);
}

/** Stream each inflation so dishonest ZIP sizes cannot allocate an unlimited buffer. */
function readEntry(file: JSZip.JSZipObject, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const stream = (
    file as JSZip.JSZipObject & {
      internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
    }
  ).internalStream("uint8array");
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const fail = (error: unknown) => {
      stream.pause();
      signal.removeEventListener("abort", abort);
      reject(error);
    };
    const abort = () => fail(new Error("aborted"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    stream
      .on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_ENTRY) {
          fail(new Error("epub-too-large"));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", fail)
      .on("end", () => {
        signal.removeEventListener("abort", abort);
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        resolve(bytes);
      })
      .resume();
  });
}

export async function prepareEpub(bytes: Uint8Array, signal: AbortSignal): Promise<ArrayBuffer> {
  validateEpubZip(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const result = new JSZip();
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (signal.aborted) throw new Error("aborted");
    if (entry.dir) continue;
    if (
      entry.unsafeOriginalName !== entry.name ||
      entry.name.startsWith("/") ||
      entry.name.includes("\\")
    )
      throw new Error("invalid-epub-path");
    const data = await readEntry(entry, signal);
    total += data.length;
    if (total > MAX_EXPANDED) throw new Error("epub-too-large");
    if (/\.(?:xhtml|html|htm|xml|opf|ncx)$/i.test(entry.name)) {
      result.file(
        entry.name,
        cleanEpubDocument(
          new TextDecoder().decode(data),
          /\.(?:xhtml|html|htm)$/i.test(entry.name),
        ),
      );
    } else {
      result.file(entry.name, data);
    }
  }
  if (!result.file("META-INF/container.xml")) throw new Error("invalid-epub");
  return result.generateAsync({ type: "arraybuffer", compression: "STORE" });
}
