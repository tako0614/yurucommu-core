import { Navigate, useParams } from "@solidjs/router";

export default function DMRoom() {
  const params = useParams();
  // Redirect to unified chat UI with this DM selected
  return <Navigate href={`/chat/dm/${encodeURIComponent(params.id)}`} />;
}
