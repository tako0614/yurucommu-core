import type { Plugin } from "vite";

export interface TakosPluginOptions {
  // TODO: define options
}

export function takosPlugin(options?: TakosPluginOptions): Plugin {
  return {
    name: "vite-plugin-takos",
    // TODO: implement plugin behavior
  };
}
