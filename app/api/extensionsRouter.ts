import { Hono } from "hono";
import { Extension } from "./models/extension.ts";
import type { Env } from "./index.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/extensions/:id/ui", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.ui) return c.notFound();
  c.header("Content-Type", "text/html; charset=utf-8");
  const eventDefs = JSON.stringify(ext.manifest?.eventDefinitions || {});  const script =
    `<script>
    (function() {
      try {
        const extensionId = "${id}";
        
        // Create a proper takos object for this extension UI
        window.takos = {
          extensions: {
            all: [{
              identifier: extensionId,
              version: "1.0.0",
              isActive: true,
              activate: () => {
                return Promise.resolve({                  publish: async (name, payload) => {
                    try {
                      console.log('Publishing event:', name, 'with payload:', payload);
                      const response = await fetch('/api/event', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                          events: [{
                            identifier: extensionId,
                            eventId: name,
                            payload: payload
                          }]
                        })
                      });
                      
                      if (response.ok) {
                        const result = await response.json();
                        console.log('Event response:', result);
                        if (result[0]?.success) {
                          return result[0].result;
                        } else {
                          console.error('Event failed:', result[0]);
                          throw new Error(result[0]?.error || 'Event processing failed');
                        }
                      } else {
                        const error = await response.text();
                        console.error('Event request failed:', response.status, error);
                        throw new Error(\`HTTP \${response.status}: \${error}\`);
                      }
                    } catch (error) {
                      console.error('Failed to publish event:', error);
                      throw error;
                    }
                  }
                });
              }
            }],
            get: (extId) => {
              console.log('Getting extension:', extId, 'looking for:', extensionId);
              return extId === extensionId ? window.takos.extensions.all[0] : undefined;
            },
            invoke: async (extId, fn, args) => {
              try {
                console.log('Invoking extension function:', extId, fn, args);
                const response = await fetch('/api/event', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    events: [{
                      identifier: "takos",
                      eventId: "extensions:invoke",
                      payload: { id: extId, fn: fn, args: args || [] }
                    }]
                  })
                });
                
                if (response.ok) {
                  const result = await response.json();
                  console.log('Invoke response:', result);
                  return result[0]?.result;
                } else {
                  const error = await response.text();
                  console.error('Invoke request failed:', response.status, error);
                  throw new Error(\`HTTP \${response.status}: \${error}\`);
                }
              } catch (error) {
                console.error('Failed to invoke extension function:', error);
                throw error;
              }
            }
          },
          events: {
            publish: async (name, payload, options) => {
              try {
                console.log('Publishing global event:', name, payload);
                const response = await fetch('/api/event', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    events: [{
                      identifier: extensionId,
                      eventId: name,
                      payload: payload
                    }]
                  })
                });
                
                if (response.ok) {
                  const result = await response.json();
                  console.log('Global event response:', result);
                  return result[0]?.result;
                } else {
                  const error = await response.text();
                  console.error('Global event request failed:', response.status, error);
                }
              } catch (error) {
                console.error('Failed to publish global event:', error);
              }
              return Promise.resolve();
            }
          }
        };
        
        console.log('Takos object initialized for extension:', extensionId);
        
      } catch(e) {
        console.error('Failed to initialize takos object:', e);
        // Fallback basic takos object
        window.takos = {
          extensions: {
            all: [],
            get: () => {
              console.error('Extension system not available');
              return undefined;
            },
            invoke: () => Promise.reject(new Error('Extension system not available'))
          },
          events: {
            publish: () => {
              console.error('Event system not available');
              return Promise.resolve();
            }
          }
        };
      }
      
      window.__takosEventDefs = window.__takosEventDefs || {};
      window.__takosEventDefs["${id}"] = ${eventDefs};
    })();
    </script>`;
  const html = ext.ui.includes("</head>")
    ? ext.ui.replace("</head>", script + "</head>")
    : script + ext.ui;
  return c.html(html);
});

app.get("/api/extensions/:id/client.js", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.client) return c.notFound();
  c.header("Content-Type", "application/javascript; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return c.body(ext.client);
});

app.get("/api/extensions/:id/manifest.json", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.manifest) return c.notFound();
  c.header("Content-Type", "application/json; charset=utf-8");
  return c.json(ext.manifest);
});

app.get("/api/extensions/:id/sw.js", async (c) => {
  const id = c.req.param("id");
  const ext = await Extension.findOne({ identifier: id });
  if (!ext || !ext.client) return c.notFound();
  const tpl = await Deno.readTextFile(
    new URL("./sw_extension_template.js", import.meta.url),
  );
  const code = tpl.replace(
    "__CLIENT_PATH__",
    `/api/extensions/${id}/client.js`,
  );
  c.header("Content-Type", "application/javascript; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return c.body(code);
});

export default app;
