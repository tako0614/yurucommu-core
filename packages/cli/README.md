# Takopack CLI 3.0

Command line interface for the next generation Takopack extension build tool.

## Installation

### Deno (Recommended)

```bash
# Direct execution (no installation needed)
deno run -A https://deno.land/x/takopack/cli.ts build

# Install globally
deno install -A --name takopack https://deno.land/x/takopack/cli.ts
```

### npm (Coming Soon)

```bash
npm install -g @takopack/cli
```

### Binary Download

Download pre-compiled binaries from
[GitHub Releases](https://github.com/takos/takopack/releases):

- Linux: `takopack-linux`
- Windows: `takopack.exe`
- macOS: `takopack-macos`

## Usage

```bash
# Build extension
takopack build

# Development mode (watch + hot reload)
takopack dev

# Watch mode only
takopack watch

# Initialize new project
takopack init my-extension

# Help
takopack help
```

## Features

- 🚀 **Zero toString dependency** - Static imports preserved
- 🔍 **AST-based analysis** - Intelligent function extraction
- 📦 **Virtual entrypoints** - No manual export management
- ⚡ **esbuild powered** - Lightning fast bundling
- 🔧 **Hot reload** - Instant development feedback
- 📱 **Single binary** - No runtime dependencies

## Configuration

Create `takopack.config.ts`:

```typescript
import { defineConfig } from "@takopack/builder";

export default defineConfig({
  manifest: {
    name: "My Extension",
    identifier: "com.example.myext",
    version: "1.0.0",
    permissions: ["kv:read", "kv:write"],
  },
  entries: {
    server: ["src/server/main.ts"],
    client: ["src/client/background.ts"],
    ui: ["src/ui/index.html"],
  },
  build: {
    target: "es2022",
    dev: false,
  },
});
```

## Project Structure

```
my-extension/
├─ takopack.config.ts
├─ src/
│  ├─ server/
│  │   └─ main.ts        # export functions, @activity decorators
│  ├─ client/  
│  │   └─ background.ts  # export functions, @event handlers
│  └─ ui/
│      └─ index.html     # Static UI files
└─ dist/
   └─ myext.takopack     # Generated package
```

## Decorators & Tags

### ActivityPub Hooks

```typescript
// Using decorators

export function onReceiveNote(ctx: string, note: Note) {
  return { processed: true };
}

// Using JSDoc
/** @activity("Like") */
export function onReceiveLike(ctx: string, like: Like) {
  return like;
}
```

### Event Handlers

```typescript
// Using decorators

export function onUserClick(data: ClickData): void {
  console.log("User clicked:", data);
}

// Using JSDoc
/** @event("dataSync", { source: "server", target: "client" }) */
export function onDataSync(payload: SyncData): void {
  // Handle sync
}
```

## Migration from Builder 2.0

Builder 3.0 is designed to be mostly compatible with existing projects. Key
changes:

1. **Configuration**: `takopack.config.ts` instead of programmatic API
2. **File organization**: Source files in `src/` directories
3. **No toString()**: Functions are detected via AST analysis
4. **Virtual entries**: No need to manually manage exports

See [Migration Guide](../docs/migration-v3.md) for detailed instructions.

## Comparison

| Feature            | Builder 2.0 | Builder 3.0         |
| ------------------ | ----------- | ------------------- |
| Configuration      | Fluent API  | Config file         |
| Import handling    | toString()  | Static preservation |
| Function detection | Manual      | AST analysis        |
| Bundle size        | Larger      | Smaller             |
| Build speed        | Slower      | Faster              |
| Dependencies       | Many        | Minimal             |

## License

MIT License - see LICENSE file for details.
