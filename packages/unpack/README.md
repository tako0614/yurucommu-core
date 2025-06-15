# Takopack Unpack

Utility module to extract the contents of a `.takopack` archive.

```
import { unpackTakoPack } from "@takopack/unpack";
const result = await unpackTakoPack("my-extension.takopack");
```

`result` contains the parsed `manifest.json` object as well as the contents of
the server script, background script and UI HTML if they exist. The manifest is
validated to be valid JSON.
