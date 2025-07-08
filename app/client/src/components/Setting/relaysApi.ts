import { apiFetch } from "../../utils/config.ts";

export interface Relay {
  id: string;
  inboxUrl: string;
}

export const fetchRelays = async (): Promise<Relay[]> => {
  try {
    const res = await apiFetch("/api/relays");
    if (!res.ok) throw new Error("Failed to fetch relays");
    const data = await res.json();
    return Array.isArray(data.relays) ? data.relays : [];
  } catch (err) {
    console.error("Error fetching relays:", err);
    return [];
  }
};

export const addRelay = async (inboxUrl: string): Promise<Relay | null> => {
  try {
    const res = await apiFetch("/api/relays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboxUrl }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error adding relay:", err);
    return null;
  }
};

export const deleteRelay = async (id: string): Promise<boolean> => {
  try {
    const res = await apiFetch(`/api/relays/${id}`, { method: "DELETE" });
    return res.ok;
  } catch (err) {
    console.error("Error deleting relay:", err);
    return false;
  }
};
