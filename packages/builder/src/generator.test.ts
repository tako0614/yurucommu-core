import { VirtualEntryGenerator } from "./generator.ts";
import type { ModuleAnalysis } from "./types.ts";

Deno.test("export wrappers use method name", () => {
  const analysis: ModuleAnalysis = {
    filePath: "mod.ts",
    exports: [
      {
        name: "ApiServer",
        type: "const",
        isDefault: false,
        line: 1,
        column: 0,
        instanceOf: "ServerExtension",
      },
    ],
    imports: [],
    decorators: [],
    jsDocTags: [
      {
        tag: "event",
        value: '"runServerTests", {"source": "ui"}',
        targetFunction: "onRunServerTests",
        targetClass: "ApiServer",
        line: 2,
      },
    ],
  };

  const gen = new VirtualEntryGenerator();
  const entry = gen.generateServerEntry([analysis]);
  if (!entry.content.includes("export const onRunServerTests")) {
    throw new Error("wrapper name mismatch");
  }
});
