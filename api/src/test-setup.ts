process.on("uncaughtException", (error) => {
  console.error("[vitest] uncaughtException", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[vitest] unhandledRejection", reason);
});
