import { Handlers, PageProps } from "$fresh/server.ts"

export default function GetSendPage() {
  return (
    <div>
      <form method="GET" action="/register">
        <input type="text" name="userName" />
        <button type="submit">Submit</button>
      </form>
    </div>
  )
}
