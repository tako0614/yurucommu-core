import { createSignal } from "solid-js";

export default function ExtensionUpload() {
  const [message, setMessage] = createSignal("");

  const handleChange = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files || !files[0]) return;
    const buf = await files[0].arrayBuffer();
    const bin = new Uint8Array(buf);
    const base64 = btoa(String.fromCharCode(...bin));
    const body = {
      events: [
        {
          identifier: "takos",
          eventId: "extensions:upload",
          payload: { data: base64 },
        },
      ],
    };
    const res = await fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) setMessage("Uploaded");
    else setMessage("Failed");
  };

  return (
    <div>
      <h3 class="text-lg mb-2">Upload Extension</h3>
      <input type="file" onChange={handleChange} />
      <p>{message()}</p>
    </div>
  );
}
