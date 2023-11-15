import { Handlers, PageProps } from "$fresh/server.ts";

export default function PostSendPage() {
  return (
    <div>
      <form method="POST" action="/tests/post-reception">
        <input type="text" name="userName" />
        <button type="submit">Submit</button>
      </form>
    </div>
  );
}