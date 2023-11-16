import { Handlers, PageProps } from "$fresh/server.ts";

interface Data {
  userName: string;
}

export const handler: Handlers<Data> = {
  async POST(req, ctx) {
    const formData = await req.formData();
    const request = await req;
    //console.log(request);
    const userName = formData.get("userName")?.toString() || "";
    const tako = formData.get("tako")?.toString() || "";
    return ctx.render({ userName, tako });
  },
};
export default function PostReceptionPage({ data }: PageProps<Data | null>) {
  if (!data?.userName) {
    return <h1 class="font-size-xl3">死ねかす</h1>;
  }
  return (
    <div>
      <h1>{data.userName} です </h1>
        <h1>{data.tako} です </h1>
    </div>
  )
}
