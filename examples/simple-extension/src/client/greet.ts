// Client background functions
export function greet(): void {
  console.log("Hello from client background!");
}

/** @event("userClick", { source: "ui", target: "background" }) */
export function onUserClick(data: { x: number; y: number; timestamp: number }): void {
  console.log("User clicked at:", data);
  
  // Forward to server if needed
  if (globalThis.takos?.events) {
    globalThis.takos.events.publish("userInteraction", {
      type: "click",
      position: { x: data.x, y: data.y },
      timestamp: data.timestamp
    });
  }
}

/** @event("backgroundTask", { source: "server", target: "client" }) */
export function onBackgroundTask(task: { id: string; action: string }): void {
  console.log("Received background task:", task);
  
  // Process background task
  switch (task.action) {
    case "refresh":
      console.log("Refreshing client data...");
      break;
    case "notify":
      console.log("Showing notification...");
      // Could trigger UI notification
      if (globalThis.takos?.events) {

      }
      break;
    default:
      console.log("Unknown task action:", task.action);
  }
}
