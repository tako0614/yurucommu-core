### /api/extensions/:id/ui

GET request to retrieve the HTML UI for the specified extension. The response
body contains the HTML with a helper script that exposes the parent window's
`takos` API. Intended for loading the UI within a sandboxed `<iframe>`.
