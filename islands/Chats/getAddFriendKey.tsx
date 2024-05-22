import { useEffect, useState } from "preact/hooks"
interface InputProps {
  value: string
  setValue: (value: string) => void
  origin: string
}

export default function RegisterForm(props: any) {
  const [showModal, setShowModal] = useState(false)
  const [value, setValue] = useState("")
  const handleButtonClick = () => {
    setShowModal(!showModal)
  }
  useEffect(() => {
    const fetchData = async () => {
      const resp = await fetch("./api/v1/chats/friendkey?reload=false")
      const data = await resp.json()
      if (data.status === false) {
        console.log("error")
        return
      }
      const origin = window.location.protocol + "//" + window.location.host
      const url = origin +"/?key="+ data.addFriendKey
      setValue(url)
    }
    fetchData()
  }, [showModal])
  return (
    <>
      <li class="c-talk-rooms">
        <a
          onClick={() => {
            setShowModal(!showModal)
          }}
        >
          <div class="c-talk-rooms-icon">
            <img src="./people.png" alt="" />
          </div>
          <div class="c-talk-rooms-box">
            <div class="c-talk-rooms-name">
              <p>招待urlを作成</p>
            </div>
            <div class="c-talk-rooms-msg">
              <p></p>
            </div>
          </div>
        </a>
      </li>
      {showModal && (
        <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(75,92,108,0.4)] left-0 top-0">
          <div class="bg-[#f0f0f5] lg:w-1/3 w-full h-full lg:h-4/6 mx-auto lg:my-[6.5%] p-5 lg:rounded-xl">
            <div class="flex justify-end">
              <span
                class="ml-0 text-3xl text-black font-[bold] no-underline cursor-pointer"
                onClick={handleButtonClick}
              >
                ×
              </span>
            </div>
            <div class="w-4/5 mx-auto my-0">
              <div class="text-center text-sm">
                <p class="text-black hover:underline font-medium text-3xl mt-8 mb-10">
                  友達追加用URLを作成
                </p>
              </div>
              <div>
                <Input
                  value={value}
                  setValue={setValue}
                  origin={props.origin}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    alert("urlをコピーしました！")
  } catch (err) {
    alert("Failed to copy!")
  }
}
function Input({
  value,
  setValue,
  origin,
}: InputProps) {
  const handleChangeUrl = (event: any) => {
    event.preventDefault()
    const updateurl = async () => {
      const resp = await fetch("./api/v1/chats/friendkey?reload=true")
      const data = await resp.json()
      if (data.status === false) {
        console.log("error")
        return
      }
      const origin = window.location.protocol + "//" + window.location.host + "/?key="
      const url = origin + data.addFriendKey
      setValue(url)
    }
    updateurl()
  }
  return (
    <>
      <label
        for="email"
        class="block mb-2 text-sm font-medium text-black"
      >
        友達登録用URL
      </label>
      <div class="w-full">
        <input
          value={value}
          class="bg-white border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
          readonly
        />
      </div>
      <div class="flex w-full">
        <div class="1/2">
          <button
            onClick={handleChangeUrl}
            type="submit"
            class="text-white h-10 bg-blue-700 hover:bg-blue-800 focus:ring-4 p-2.5 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
          >
            urlを変更
          </button>
        </div>
        <div class="1/2">
          <button
            onClick={() => {
              copyToClipboard(value)
            }}
            type="submit"
            class="text-white h-10 bg-blue-700 hover:bg-blue-800 focus:ring-4 p-2.5 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
          >
            コピー
          </button>
        </div>
      </div>
    </>
  )
}
