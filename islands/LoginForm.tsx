import { useState,useEffect } from 'preact/hooks';
import { render } from "preact";
//import Button from '../components/Button.tsx'
import { JSX, h} from "preact";
//hover:bg-accent hover:text-accent-foreground h-11 px-4 py-2 bg-black border border-white text-white w-64
import { isMail, isUserDuplication, takojson } from "../util/takoFunction.ts"
export default function RegisterForm({ text,sitekey}: { text: string, sitekey: string;}) {
    const classs = "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-primary/90 h-11 px-4 py-2 bg-blue-600 text-white w-64 "
    const [showModal, setShowModal] = useState(false);
    const [showForm, setShowFrom] = useState(false);
    const handleButtonClick = () => {
      setShowModal(!showModal);
    }
    const [userName, setUserName] = useState("")
    const [password, setPassword] = useState("")
    const handleUserNameChange = (event: any) => {
        setUserName(event.currentTarget.value);
    };
    const handlePasswordChange = (event: any) => {
        setPassword(event.currentTarget.value);
    };
    const handleSubmit = async (event: any) => {
        event.preventDefault();
        const values = {
            userName,
            password,
            sitekey
        }
        if(values.userName === "" || values.password === ""){
            alert("全ての項目を入力してください")
            return
        }
        const res = await fetch("./api/logins/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(values)
        })
        const response = await res.json()
        if(response.status === true) {
            window.location.href = "/"
        } else {
            alert("ログインに失敗しました"+ response.status)
        }
        }
return <>
    <button class={classs} onClick={handleButtonClick}>
        {text}
    </button>
    {showModal && (
        <div className="fixed z-50 w-full h-full overflow-auto bg-[rgba(91,112,131,0.4)] left-0 top-0">
          <div className="bg-[#000000] lg:w-[35%] w-[90%] h-[90%] lg:h-[80%] mx-auto my-[15%] lg:my-[5%] p-5 rounded-xl">
            <div class="flex">
              <img src="./logo.webp" alt="logo" class="w-[120px] m-auto" />
              <span className="ml-0 text-3xl text-gray-400 font-[bold] no-underline cursor-pointer" onClick={handleButtonClick}>×</span>
            </div>
            <div class="w-4/5 mx-auto my-0">
              <div class="">
              <p class="text-white text-3xl mb-10 font-sans font-bold">ログイン</p>
                {showForm || (<form onSubmit={handleSubmit} class="">
                  <label>
                  <div class="text-2xl">ユーザーネーム</div>
                    <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" value={userName} onChange={handleUserNameChange} />
                  </label>
                  <label>
                  <div class="text-2xl">パスワード</div>
                    <input type="password" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" value={password} onChange={handlePasswordChange} />
                  </label>
                  <div>
                    <input type="submit" value="送信" class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded" />
                  </div>
                </form>)
                }
                {showForm && (
                  <div class="text-white text-3xl">メールアドレスに本登録用のurlを送信しました</div>
                )

                }
              </div>
            </div>
          </div>
        </div>
      )}
    </>
}