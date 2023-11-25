// routes/_app.tsx
import { useSignal } from "@preact/signals";
import Header from '../components/Header.tsx'
import Footer from '../components/Footer.tsx'
import Button from '../components/Button.tsx'
import { useState, useEffect } from "preact/hooks";


export default function RegisterForm() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const handleSubmit = (e) => {
        e.preventDefault();
        const data = {
            email: email,
            password: password,
        };
        fetch("/api/tako", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        })
            .then((response) => response.json())
            .then((data) => {
                // Handle the response from the server
                console.log(data);
            })
            .catch((error) => {
                // Handle any errors
                console.error(error);
            });
    };
    return (
        <div>
            <form onSubmit={handleSubmit}>
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
                <button type="submit">Submit</button>
            </form>
        </div>
    );
}