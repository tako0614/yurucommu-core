import {
  configure,
  TextWriter,
  Uint8ArrayReader,
  ZipReader,
  BlobWriter,
} from "jsr:@zip-js/zip-js@^2.7.62";

// Configure to disable workers to prevent timer leaks in tests
configure({
  useWebWorkers: false,
});

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function mimeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "svg":
      return "image/svg+xml";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "png":
    default:
      return "image/png";
  }
}

function toDataUrl(bytes: Uint8Array, path: string): string {
  const mime = mimeFromPath(path);
  const base64 = uint8ToBase64(bytes);
  return `data:${mime};base64,${base64}`;
}

export interface TakoUnpackResult {
  manifest: string;
  server?: string;
  client?: string;
  index?: string;
  /** Icon file content if present */
  icon?: string;
}

/**
 * Unpack a `.takopack` archive and return its core files as strings.
 *
 * @param input - Path to the .takopack file or its binary contents
 * @throws if manifest.json is missing or invalid
 */
export async function unpackTakoPack(
  input: string | Uint8Array | ArrayBuffer,
): Promise<TakoUnpackResult> {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    bytes = await Deno.readFile(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else {
    bytes = new Uint8Array(input);
  }

  // first extract manifest to determine icon path
  let reader = new ZipReader(new Uint8ArrayReader(bytes));
  const entries = await reader.getEntries();
  let manifest = "";
  for (const entry of entries) {
    if (!entry.directory && entry.filename === "takos/manifest.json") {
      manifest = await entry.getData!(new TextWriter());
      break;
    }
  }
  await reader.close();

  if (!manifest) {
    throw new Error("manifest.json not found in package");
  }

  let manifestObj: any;
  try {
    manifestObj = JSON.parse(manifest);
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }

  const iconPath = manifestObj.icon
    ? `takos/${manifestObj.icon.replace(/^\.\/?/, "")}`
    : undefined;

  // gather needed files
  reader = new ZipReader(new Uint8ArrayReader(bytes));
  const entries2 = await reader.getEntries();
  let server: string | undefined;
  let client: string | undefined;
  let index: string | undefined;
  let icon: string | undefined;

  for (const entry of entries2) {
    if (entry.directory) continue;
    if (entry.filename === "takos/server.js") {
      server = await entry.getData!(new TextWriter());
    } else if (entry.filename === "takos/client.js") {
      client = await entry.getData!(new TextWriter());
    } else if (entry.filename === "takos/index.html") {
      index = await entry.getData!(new TextWriter());
    } else if (iconPath && entry.filename === iconPath) {
      const blob = await entry.getData!(new BlobWriter());
      const buf = new Uint8Array(await blob.arrayBuffer());
      icon = toDataUrl(buf, iconPath);
    }
  }
  await reader.close();

  return { manifest, server, client, index, icon };
}
