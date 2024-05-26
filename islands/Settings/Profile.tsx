import { useEffect, useState } from "preact/hooks"
import { h, JSX } from "preact"
export default function RegisterForm(props: any) {
  const [value, setValue] = useState("")
  const [nickName, setNickName] = useState("")
  const [icon, setIcon] = useState(`/api/v1/users/info/icon`)
  const handleChangeNickName = (
    event: h.JSX.TargetedEvent<HTMLInputElement>,
  ) => {
    setNickName(event.currentTarget.value)
  }
  const handleChnageIcon = (event: h.JSX.TargetedEvent<HTMLInputElement>) => {
    setIcon(event.currentTarget.value)
  }
  const handleSubmit = async (event: h.JSX.TargetedEvent<any>) => {
    const values = {
      nickName,
      icon,
    }
    if (nickName === "" && icon === "") {
      return
    }
    if (/^[ぁ-んァ-ン一-龥a-zA-Z0-9]{1,20}$/.test(values.nickName) === false) {
      values.nickName = ""
    }
    console.log(values.icon)
    const origin = window.location.origin
    const csrftokenRes = await fetch("/api/v1/csrftoken?origin=" +origin, {
      method: "GET",
    })
    const csrftoken = await csrftokenRes.json()
    const resp = await fetch("/api/v1/users/info", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        csrftoken: csrftoken.csrftoken,
        nickName: values.nickName,
        icon: values.icon,
        updateItem: {
          nickName: values.nickName == "" ? false : true,
          icon: values.icon == "" ? false : true,
        },
      }),
    })
    const response = await resp.json()
    if (response.status === true) {
      alert("保存に成功しました")
      props.setSettingPage("")
    } else {
      alert("保存に失敗しました")
    }
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
