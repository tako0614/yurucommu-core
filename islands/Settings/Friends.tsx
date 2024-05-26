export default function Profile() {
  return (
    <>
      <div class="p-2 w-full h-full">
        <div class="w-full">
          <div class="lg:w-1/3 w-2/3 m-auto">
            <h1 class="text-3xl font-medium pb-[8vh]">
              プロフィールを編集
            </h1>
            <div>
              <form onSubmit={() => {}}>
                <div class="pb-4">
                  <label>ユーザー名</label>
                  <input
                    type="text"
                    class="rounded-md border"
                  />
                </div>
                <div class="pb-2">
                  <label class="block">自己紹介</label>
                  <textarea
                    name=""
                    id=""
                    class="rounded-md border"
                  >
                  </textarea>
                </div>
                <div>
                  <label htmlFor=""></label>
                </div>
              </form>
            </div>
          </div>
          <div class="2/3">
          </div>
        </div>
      </div>
    </>
  )
}
