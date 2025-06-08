import { ClientExtension } from "@takopack/builder/src/classes.ts";
import { getTakosClientAPI } from "@takopack/builder/src/api-helpers.ts";

export const GreetClient = new ClientExtension();

GreetClient.greet = (): void => {
  console.log("Hello from client background!");
};

/** @event("userClick", { source: "ui", target: "background" }) */
GreetClient.onUserClick = (
  data: { x: number; y: number; timestamp: number },
): void => {
  console.log("User clicked at:", data);
  const takosAPI = getTakosClientAPI();
  if (takosAPI?.events) {
    takosAPI.events.publish("userInteraction", {
      type: "click",
      position: { x: data.x, y: data.y },
      timestamp: data.timestamp,
    });
  }
};

/** @event("backgroundTask", { source: "server", target: "client" }) */
GreetClient.onBackgroundTask = (task: { id: string; action: string }): void => {
  console.log("Received background task:", task);
  const takosAPI = getTakosClientAPI();
  switch (task.action) {
    case "refresh":
      console.log("Refreshing client data...");
      break;
    case "notify":
      console.log("Showing notification...");
      if (takosAPI?.events) {
        // Maybe trigger UI notification here
      }
      break;
    default:
      console.log("Unknown task action:", task.action);
  }
};
