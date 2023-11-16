import { Handlers, PageProps } from "$fresh/server.ts";

export default function PostSendPage() {
  return (
    <div>
      <form method="POST" action="/api/oumu">
        <input type="text" name="userName" />
        <input type="text" name="tako" />
        <button type="submit">Submit</button>
      </form>
    </div>
  );
}