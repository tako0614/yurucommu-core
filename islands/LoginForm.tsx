import { useState,useEffect } from 'preact/hooks';
import { render } from "preact";
//import Button from '../components/Button.tsx'
import { JSX, h} from "preact";
import { isMail, isUserDuplication, takojson } from "../util/takoFunction.ts"
export default function RegisterForm({ text, color,tako,key}: { text: string, color: string; tako: string; key: string;}) {
    const classs = "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" + color
    const [showModal, setShowModal] = useState(false);
    const [showForm, setShowFrom] = useState(false);
    const handleButtonClick = () => {
      setShowModal(!showModal);
    }
    //const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const handleEmailChange = (event: h.JSX.TargetedEvent<HTMLInputElement>) => {
        setEmail(event.currentTarget.value);
    };
    const handleSubmit = async (event: JSX.TargetedEvent<HTMLFormElement, Event>) => {
        // TODO token を用いた処理

        event.preventDefault();
        const data = {
          requirements: "temp_register",
          mail: email,
        };
        const res = await fetch("/api/logins/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        })
        const response = await res.json()
        if(response.status == true) {
          setShowFrom(!showForm)
        } else {
          alert("takotako")
          console.log(response)
        }
    };
    //rechapcha
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
              <p class="text-white text-3xl mb-10 font-sans font-bold">アカウントを作成</p>
                {showForm || (<form onSubmit={handleSubmit} class="">
                  <label>
                  <div class="text-2xl">メールアドレス</div>
                    <input type="email" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" placeholder="Username"  value={email} onChange={handleEmailChange} />
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