import { ClientExtension } from "@takopack/builder";

export const GreetClient = new ClientExtension();

GreetClient.greet = (): void => {
  console.log("Hello from client background!");
};

/** @event("userClick", { source: "ui", target: "background" }) */
GreetClient.onUserClick = (
  data: { x: number; y: number; timestamp: number },
): void => {
  console.log("User clicked at:", data);
  if (globalThis.takos?.events) {
    globalThis.takos.events.publish("userInteraction", {
      type: "click",
      position: { x: data.x, y: data.y },
      timestamp: data.timestamp,
    });
  }
};

/** @event("backgroundTask", { source: "server", target: "client" }) */
GreetClient.onBackgroundTask = (task: { id: string; action: string }): void => {
  console.log("Received background task:", task);
  switch (task.action) {
    case "refresh":
      console.log("Refreshing client data...");
      break;
    case "notify":
      console.log("Showing notification...");
      if (globalThis.takos?.events) {
        // Maybe trigger UI notification here
      }
      break;
    default:
      console.log("Unknown task action:", task.action);
  }
};

export { GreetClient };
