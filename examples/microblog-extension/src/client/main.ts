import { ClientExtension } from "@takopack/builder/src/classes.ts";
import { getTakosClientAPI } from "@takopack/builder/src/api-helpers.ts";

export const MicroblogClient = new ClientExtension();

/** @event("timelineUpdated", { source: "server" }) */
MicroblogClient.onTimelineUpdated = (payload: { posts: unknown[] }): void => {
  globalThis.dispatchEvent(new CustomEvent("timelineUpdate", { detail: payload }));
};

MicroblogClient.addPost = (text: string): void => {
  const api = getTakosClientAPI();
  api?.events.publish("addPost", { text });
};

MicroblogClient.fetchTimeline = async (): Promise<void> => {
  const api = getTakosClientAPI();
  const res = await api?.events.publish("getTimeline", {});
  if (Array.isArray(res)) {
    const [, body] = res as [number, { posts: unknown[] }];
    globalThis.dispatchEvent(new CustomEvent("timelineUpdate", { detail: body }));
  }
};
