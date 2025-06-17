# API Test Extension

This example extension provides a quick way to verify each Takopack runtime API.
The UI page lists buttons for the APIs exposed to the server, client and UI
layers individually. Click a button to run that API call and see the returned
value in the output panel. ActivityPub and CDN features are server-only, so
tests for those APIs run only on the server layer.

Use the provided build task to generate a `.takopack` archive:

```bash
deno task build
```
