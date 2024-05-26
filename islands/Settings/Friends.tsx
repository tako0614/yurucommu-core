import { useEffect, useState } from "preact/hooks"

export default function RegisterForm(props) {
  const [value, setValue] = useState("")
  return (
    <>
      {props.isShow && (
        <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(75,92,108,0.4)] left-0 top-0">
          <div class="bg-[#f0f0f5] w-full h-full mx-auto p-5 lg:rounded-xl">
            <div class="flex justify-end">
              <span
                class="ml-0 text-3xl text-black font-[bold] no-underline cursor-pointer"
                onClick={() => {
                  props.setSettingPage("")
                }}
              >
                ×
              </span>
            </div>
            <div class="w-4/5 mx-auto my-0">
              <div class="text-center text-sm">
                <p class="text-black hover:underline font-medium text-3xl mt-4 mb-5">
                  プロフィールの設定
                </p>
              </div>
              <div>
                <div class="lg:w-1/2 m-auto text-black">
                  <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700">ユーザーネーム</label>
                    <input
                      type="text"
                      class="mt-1 focus:ring-indigo-500 focus:border-indigo-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      placeholder="ユーザーネームを入力してください"
                    />
                  </div>
                  <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700">アイコン</label>
                    <input
                      type="file"
                      class="mt-1 focus:ring-indigo-500 focus:border-indigo-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                    />
                  </div>
                  <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-700">にっくネーム</label>
                    <input
                      type="text"
                      class="mt-1 focus:ring-indigo-500 focus:border-indigo-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      placeholder="にっくネームを入力してください"
                    />
                  </div>
                </div>
              </div>
              <div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}