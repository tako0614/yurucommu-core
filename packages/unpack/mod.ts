import {
  BlobWriter,
  configure,
  TextWriter,
  Uint8ArrayReader,
  ZipReader,
} from "jsr:@zip-js/zip-js@^2.7.62";

// Configure to disable workers to prevent timer leaks in tests
configure({
  useWebWorkers: false,
});

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

export interface TakoUnpackResult {
  manifest: Record<string, unknown>;
  server?: string;
  client?: string;
  ui?: string;
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
  let manifestText = "";
  for (const entry of entries) {
    if (!entry.directory && entry.filename === "takos/manifest.json") {
      manifestText = await entry.getData!(new TextWriter());
      break;
    }
  }
  await reader.close();

  if (!manifestText) {
    throw new Error("manifest.json not found in package");
  }

  let manifestObj: any;
  try {
    manifestObj = JSON.parse(manifestText);
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }

  const serverEntry = manifestObj?.server?.entry?.replace(/^\.\/?/, "") ||
    "server.js";
  const bgEntry = manifestObj?.client?.entryBackground?.replace(/^\.\/?/, "") ||
    "client.js";
  const uiEntry = manifestObj?.client?.entryUI?.replace(/^\.\/?/, "") ||
    "index.html";

  const iconPath = manifestObj.icon
    ? `takos/${manifestObj.icon.replace(/^\.\/?/, "")}`
    : undefined;

  // gather needed files
  reader = new ZipReader(new Uint8ArrayReader(bytes));
  const entries2 = await reader.getEntries();
  let server: string | undefined;
  let client: string | undefined;
  let ui: string | undefined;
  let icon: string | undefined;

  for (const entry of entries2) {
    if (entry.directory) continue;
    if (entry.filename === `takos/${serverEntry}`) {
      server = await entry.getData!(new TextWriter());
    } else if (entry.filename === `takos/${bgEntry}`) {
      client = await entry.getData!(new TextWriter());
    } else if (entry.filename === `takos/${uiEntry}`) {
      ui = await entry.getData!(new TextWriter());
    } else if (iconPath && entry.filename === iconPath) {
      const mimeType = mimeFromPath(iconPath);
      const blob = await entry.getData!(new BlobWriter(mimeType));
      // Use FileReader to convert blob to data URL
      icon = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }
  }
  await reader.close();

  return { manifest: manifestObj, server, client, ui, icon };
}
