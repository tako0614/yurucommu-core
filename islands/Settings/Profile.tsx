import { useEffect, useState } from "preact/hooks"

export default function RegisterForm(props) {
  const [value, setValue] = useState("")
  const [userName, setUserName] = useState("")
  const [nickName, setNickName] = useState("")
  const [icon, setIcon] = useState(`/api/v1/users/info/icon`)
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
                <div class="lg:w-1/2 m-auto text-black lg:flex">
                  <img src={icon} alt="" class="rounded-full w-1/3" />
                  <div class="m-auto">
                    <div class="mb-4">
                      <label class="block text-sm font-medium text-gray-700">
                        ニックネーム
                      </label>
                      <input
                        type="text"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                        placeholder="ニックネームを入力してください"
                      />
                    </div>
                    <div class="mb-4">
                      <label class="block text-sm font-medium text-gray-700">
                        アイコン
                      </label>
                      <input
                        type="file"
                        class="mt-1 focus:ring-indigo-500 focus:border-indigo-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div class="text-center">
                <button
                  class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
