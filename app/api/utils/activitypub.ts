export async function sendActivityPubObject(
  inboxUrl: string,
  object: unknown,
): Promise<Response> {
  const body = JSON.stringify(object);
  const headers = new Headers({
    "content-type": "application/activity+json",
  });
  try {
    return await fetch(inboxUrl, {
      method: "POST",
      headers,
      body,
    });
  } catch (err) {
    console.error(`Failed to send ActivityPub object to ${inboxUrl}:`, err);
    throw err;
  }
}

export async function deliverActivityPubObject(
  inboxes: string[],
  object: unknown,
): Promise<void> {
  for (const inbox of inboxes) {
    if (inbox.startsWith("http")) {
      try {
        await sendActivityPubObject(inbox, object);
      } catch (_) {
        /* ignore individual errors */
      }
    }
  }
}
