# Takopack Unpack

Utility module to extract the contents of a `.takopack` archive.

```
import { unpackTakoPack } from "@takopack/unpack";
const result = await unpackTakoPack("my-extension.takopack");
```

`result` contains the `manifest.json`, `server.js`, `client.js` and `index.html`
as strings. The manifest is validated to be a valid JSON file.
