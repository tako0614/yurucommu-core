declare module "../../../schemas/ui-contract.json" {
  import type { UiContract } from "@takos/platform/app";
  const value: UiContract;
  export default value;
}

declare module "../../../app/manifest.json" {
  const value: Record<string, unknown>;
  export default value;
}
