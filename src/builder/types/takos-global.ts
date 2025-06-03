/**
 * Takos Global Types
 * globalThis.takos APIの型定義
 */

import { TakosAPI } from "./takos-api.ts";

declare global {
  interface Window {
    takos: TakosAPI;
  }

  namespace globalThis {
    var takos: TakosAPI;
  }
}

export {};
