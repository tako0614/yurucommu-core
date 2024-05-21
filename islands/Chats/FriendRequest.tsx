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
      const url = props.origin + data.addFriendKey
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
              <p>リクエスト</p>
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
                <p class="text-black hover:underline font-medium text-3xl mt-4 mb-5">
                  保留中
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
      const url = origin + data.addFriendKey
      setValue(url)
    }
    updateurl()
  }
  return (
    <>
      <div class="w-full text-gray-900 text-sm rounded-lg h-16">
        <VideoList></VideoList>
      </div>
    </>
  )
}
function User(props: any) {
  return (
    <>
      <li class="c-talk-rooms flex mb-2 bg-white border border-gray-300">
        <a>
          <div class="c-talk-rooms-icon">
            <img src={props.icon} />
          </div>
          <div class="c-talk-rooms-box">
            <div class="c-talk-rooms-name">
              <p>{props.userName}</p>
            </div>
            <div class="c-talk-rooms-msg">
              <p></p>
            </div>
          </div>
        </a>
        <div class="mt-auto mb-auto ml-auto flex">
          <div class="ml-2">
            <button class="w-1 h-1 bg-blue-400 text-lg text-white font-semibold rounded-full">
              ＋
            </button>
          </div>
          <div>
            <button class="w-1 h-1 bg-blue-400 text-lg text-white font-semibold rounded-full">
              －
            </button>
          </div>
        </div>
      </li>
      <hr />
    </>
  )
}
const VideoList = () => {
  const videos = [
    { title: "たこ", icon: "people.png" },
    { title: "たこ2", icon: "people.png" },
    { title: "たこ", icon: "people.png" },
    { title: "たこ2", icon: "people.png" },
    { title: "たこ", icon: "people.png" },
    { title: "たこ2", icon: "people.png" },
    { title: "たこ", icon: "people.png" },
    { title: "たこ2", icon: "people.png" },
    { title: "たこ", icon: "people.png" },
    { title: "たこ2", icon: "people.png" },
    { title: "たこ", icon: "people.png" },
    { title: "たこ2", icon: "people.png" },
    { title: "たこ", icon: "people.png" },
    { title: "たこ2", icon: "people.png" },
  ]
  useEffect(
    () => {
      async function getList() {
        const res = await fetch("./api/v1/friends/reqLists")
      }
      getList()
    },
    [],
  )

  return (
    <div className="container mx-auto mt-8">
      <div className="bg-white rounded-lg overflow-y-auto max-h-96 mx-auto">
        <ul className="space-y-2 p-4">
          {videos.map((video) => (
            /*<li
              key={video.id}
              className={`flex items-center p-2 rounded cursor-pointer ${
                selectedVideo === video.id ? 'bg-gray-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
              onClick={() => setSelectedVideo(video.id)}
            >
              <img src={video.thumbnail} alt={video.title} className="w-12 h-12 rounded" />
              <span className="ml-4">{video.title}</span>
            </li>*/
            <User
              icon={video.icon}
              userName={video.title}
            />
          ))}
        </ul>
      </div>
    </div>
  )
}
