// routes/_app.tsx
import { render } from "preact";
//import Button from '../components/Button.tsx'
import { useState, useEffect } from "preact/hooks";
import { JSX, h} from "preact";
import { isMail, isUserDuplication, takojson } from "../util/takoFunction.ts"
const SuccessPage = () => 
<div>
    <h1 class="text-white">登録完了</h1>
    <p class="text-white">登録が完了しました。メールを確認してください。</p>
    <a href="/">トップページへ</a>
</div>;
export default function RegisterForm() {
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
        
        const data: takojson = {
            status: "",
            password: "",
            requirements: "temp_register",
            userName: username,
            mail: email,
        };
        const response = fetch("/api/tako", {
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
                    const container = document.getElementById("register-form");
                    if (container) {
                        
                        render(SuccessPage(), container);
                    } else {
                        console.error("Container element not found");
                    }
                } else if (data.status === "error") {
                    switch (data.error) {
                        case "mail":
                            alert("メールアドレスが不正です。");
                            break;
                        case "user":
                            alert("ユーザー名が不正です。");
                            break;
                        case "user_duplication":
                            alert("ユーザー名が重複しています。");
                            break;
                        case "mail_duplication":
                            alert("メールアドレスが重複しています。");
                            break;
                        default:
                            alert("不明なエラーが発生しました。");
                            break;
                    }
                }
            })
            .catch((error) => {
                // エラーハンドリング
            });
    };

    return (
        <form onSubmit={handleSubmit} id="register-form">
            <label>
                <p class="text-white">Username:</p>
                <input type="text" value={username} onChange={handleUsernameChange} />
            </label>
            <br />
            <label>
                <p class="text-white">Email:</p>
                <input type="email" value={email} onChange={handleEmailChange} />
            </label>
            <br />
            <button type="submit" class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded text-white">Submit</button>
        </form>
    );
}