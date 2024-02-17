import { useState } from 'preact/hooks';
import { render } from "preact";
//import Button from '../components/Button.tsx'
import { JSX, h} from "preact";
import { isMail, isUserDuplication, takojson } from "../util/takoFunction.ts"
export default function RegisterForm({ text, color,tako }: { text: string, color: string; tako: string;}) {
    const classs = "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" + color 

    const [showModal, setShowModal] = useState(false);

    const handleButtonClick = () => {
      setShowModal(!showModal);
    }
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const handleUsernameChange = (event: h.JSX.TargetedEvent<HTMLInputElement>) => {
        setUsername(event.currentTarget.value);
    };
    const handleEmailChange = (event: h.JSX.TargetedEvent<HTMLInputElement>) => {
        setEmail(event.currentTarget.value);
    };
    const handleSubmit = (event: JSX.TargetedEvent<HTMLFormElement, Event>) => {
        event.preventDefault();
        alert(email)
        const data = {
            requirements: "temp_register",
            userName: username,
            mail: email,
        };
        const response = fetch("/api/logins/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        })
            .then((response) => response.json())
            .then((data) => {
                console.log(data.status);
                if (data.status === "success") {
                  alert("成功")
                    //const container = document.getElementById("register-form");
                    /*
                    if (container) {
                      //
                    } else {
                        console.error("Container element not found");
                    }*/
                } else if (data.status === "error") {
                  alert("error")
                } else {
                  alert("error")
                }
            })
            .catch((error) => {
                alert("error")
            });
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
                <form onSubmit={handleSubmit} class="">
                  <label class="mb-5">
                    <div>ユーザーネーム</div>
                    <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" placeholder="Username" value={username} onChange={handleUsernameChange} />
                  </label>
                  <label>
                  <div>Email</div>
                    <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" placeholder="Username"  value={email} onChange={handleEmailChange} />
                  </label>
                  <div>
                    <input type="submit" value="Submit" class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded" />
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
}