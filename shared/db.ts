import mongoose from "mongoose";

let currentUri = "";

export async function connectDatabase(env: Record<string, string>) {
  const uri = env["MONGO_URI"];
  if (mongoose.connection.readyState === 1 && currentUri === uri) {
    return;
  }
  currentUri = uri;
  await mongoose.connect(uri)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err: Error) => console.error("MongoDB connection error:", err));
}
