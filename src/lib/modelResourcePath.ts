/** Resolve a glTF resource inside the model's directory, without URL fetching. */
export function modelResourcePath(modelPath: string, uri: string): string {
  if (/[?#]/.test(uri)) throw new Error("modelExternalResources");
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    throw new Error("modelExternalResources");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control bytes in untrusted resource paths.
  if (!decoded || /^[\\/]/.test(decoded) || /[:\u0000-\u001f]/.test(decoded)) {
    throw new Error("modelExternalResources");
  }
  const segments: string[] = [];
  for (const part of decoded.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) throw new Error("modelExternalResources");
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  const cut = Math.max(modelPath.lastIndexOf("/"), modelPath.lastIndexOf("\\"));
  if (cut < 0 || segments.length === 0) throw new Error("modelExternalResources");
  const separator = modelPath[cut];
  return modelPath.slice(0, cut + 1) + segments.join(separator);
}
