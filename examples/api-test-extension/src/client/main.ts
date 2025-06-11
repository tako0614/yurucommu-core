import { ClientExtension } from "@takopack/builder/src/classes.ts";
import { getTakosClientAPI } from "@takopack/builder/src/api-helpers.ts";

export const ApiClient = new ClientExtension();

/** @event("clientNotify", { source: "server" }) */
ApiClient.onClientNotify = (payload: { message: string }): void => {
  console.log("notify:", payload.message);
};

ApiClient.requestTests = (): void => {
  const api = getTakosClientAPI();
  api?.events.publish("runServerTests", {});
};
