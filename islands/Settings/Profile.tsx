import { useEffect, useState } from "preact/hooks"
import { h, JSX } from "preact"
export default function RegisterForm(props: any) {
  const [value, setValue] = useState("")
  const [nickName, setNickName] = useState("")
  const [icon, setIcon] = useState<File | null | Uint8Array>(null)

  const handleChnageIcon = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0] // 最初のファイルを取得します
      const fileReader = new FileReader()
      fileReader.onload = function webViewerChangeFileReaderOnload(evt) {
        if (evt.target) {
          const buffer = evt.target.result
          if (buffer instanceof ArrayBuffer) {
            const uint8Array = new Uint8Array(buffer)
            // 生成したUint8Arrayをコンソールに表示
            console.log(uint8Array)
            setIcon(uint8Array)
          }
        }
      }
      fileReader.readAsArrayBuffer(file)
    }
  }
  const handleChangeNickName = (
    event: h.JSX.TargetedEvent<HTMLInputElement>,
  ) => {
    setNickName(event.currentTarget.value)
  }
  const handleSubmit = async (event: h.JSX.TargetedEvent<any>) => {
    event.preventDefault()
    /* 画像ファイルをBase64に変更してNickNameと一緒に送信
    {
      nickName: nickName,
      icon: icon,
    }
    の形のjsonで送信する
    */
    const csrftoken = await fetch(
      "/api/v1/csrftoken?origin=" + window.location.origin,
    )
    const token = await csrftoken.json()
    const csrftokenValue = token.csrftoken
    const formData = new FormData()
    formData.append("icon", icon)
    formData.append("csrftoken", csrftokenValue)
    formData.append("nickName", nickName)
    const resp = await fetch("/api/v1/setting", {
      method: "POST",
      body: formData,
    })
    const data = await resp.json()
    console.log(data)
    if (data.status === false) {
      return
    }
    props.setSettingPage("")
  }
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
                  <img
                    src="/api/v1/users/info/icon"
                    alt=""
                    class="rounded-full lg:w-1/3 w-2/3 m-auto"
                  />
                  <div class="m-auto">
                    <div class="mb-4">
                      <label class="block text-sm font-medium text-gray-700">
                        ニックネーム
                      </label>
                      <input
                        type="text"
                        class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                        placeholder="ニックネームを入力してください"
                        value={nickName}
                        onChange={handleChangeNickName}
                        multiple
                      />
                    </div>
                    <div class="mb-4">
                      <label class="block text-sm font-medium text-gray-700">
                        アイコン
                      </label>
                      <input
                        type="file"
                        class="mt-1 focus:ring-indigo-500 focus:border-indigo-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                        onChange={handleChnageIcon}
                        accept="image/*"
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div class="text-center">
                <button
                  class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                  onClick={handleSubmit}
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
