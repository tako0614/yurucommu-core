import { Navigate } from "@solidjs/router";

export default function DMList() {
  // Redirect to unified chat UI
  return <Navigate href="/chat" />;
}
