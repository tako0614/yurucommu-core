// routes/_app.tsx
import { useSignal } from "@preact/signals";
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
//import Button from '../components/Button.tsx'
import { useState, useEffect } from "preact/hooks";
import { JSX, h} from "preact";



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

        const data = {
            username: username,
            email: email,
        };

        fetch("/api/oumu", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        })
            .then((response) => response.json())
            .then((data) => {
                console.log(data);
            })
            .catch((error) => {
                // エラーハンドリング
            });
    };

    return (
        <form onSubmit={handleSubmit}>
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