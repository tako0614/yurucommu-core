import { useState } from 'preact/hooks';
import { render } from "preact";
//import Button from '../components/Button.tsx'
import { JSX, h} from "preact";
import { isMail, isUserDuplication, takojson } from "../util/takoFunction.ts"
export default function RegisterForm({ text, color,tako }: { text: string, color: string; tako: string;}) {
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
        event.preventDefault();
        const uri = new URL(window.location.href);
        const token = await fetch(`${uri.protocol}//${uri.hostname}/api/token?origin=${uri.protocol}//${uri.hostname}`)
        const csrftoken = await token.json();
        const data = {
          requirements: "temp_register",
          mail: email,
          csrftoken: csrftoken.csrftoken
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
return <>
    <button class={classs} onClick={handleButtonClick}>
        {text}
    </button>
    {showModal && (
        <div className="fixed z-[999999999] w-full h-full overflow-auto bg-[rgba(91,112,131,0.4)] left-0 top-0">
          <div className="bg-[#000000] lg:w-[35%] w-[90%] h-[90%] lg:h-[80%] mx-auto my-[15%] lg:my-[5%] p-5 rounded-xl">
            <div class="flex">
              <img src="./logo.webp" alt="logo" class="w-[120px] m-auto" />
              <span className="text-[#aaa] ml-0 text-[28px] font-[bold] no-underline cursor-pointer" onClick={handleButtonClick}>×</span>
            </div>
            <div class="w-[80%] mx-auto my-0">
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
                  <div class="text-white text-3xl">送信されたで!本登録してや！</div>
                )

                }
              </div>
            </div>
          </div>
        </div>
      )}
    </>
}