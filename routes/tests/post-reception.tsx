import { Handlers, PageProps } from "$fresh/server.ts";

interface Data {
  userName: string;
}

export const handler: Handlers<Data> = {
  async POST(req, ctx) {
    const formData = await req.formData();
    const userName = formData.get("userName")?.toString() || "";
    return ctx.render({ userName });
  },
};

export default function PostReceptionPage({ data }: PageProps<Data | null>) {
  if (!data?.userName) {
    return <h1>そんなユーザーはいないでござる</h1>;
  }

  return (
    <div>
      <h1>{data.userName} です </h1>
    </div>
  );
}
