import mongoose from "mongoose";

export async function connectDatabase(env: Record<string, string>) {
  const uri = env["MONGO_URI"];
  await mongoose.connect(uri)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err: Error) => console.error("MongoDB connection error:", err));
}
