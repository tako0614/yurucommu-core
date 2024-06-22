import { useEffect, useState } from "preact/hooks"
import { h, JSX } from "preact"

interface LoginFormProps {
    onUserNameChange: (event: h.JSX.TargetedEvent<HTMLInputElement>) => void
    onPasswordChange: (event: h.JSX.TargetedEvent<HTMLInputElement>) => void
    userNameValue: string
    passwordValue: string
    onSubmit: (event: h.JSX.TargetedEvent<HTMLFormElement, Event>) => void
    showUserNameError: boolean
    userNameError: string
    showPasswordError: boolean
    passwordError: string
}

interface InputProps {
    showError: boolean
    errorMessage: string
    value: string
    onChange: (event: h.JSX.TargetedEvent<HTMLInputElement>) => void
    placeholder: string
    title: string
    type: string
}

export default function RegisterForm(
    { text, token }: { text: string; token: string },
) {
    const [showModal, setShowModal] = useState(false)
    const [showForm, setShowFrom] = useState(false)
    const handleButtonClick = () => {
        setShowModal(!showModal)
    }
    const [userName, setUserName] = useState("")
    const [password, setPassword] = useState("")
    const [showUserNameError, setShowUserNameError] = useState(false)
    const [showPasswordError, setShowPasswordError] = useState(false)
    const [userNameError, setUserNameError] = useState("")
    const [passwordError, setPasswordError] = useState("")

    const handleUserNameChange = (
        event: h.JSX.TargetedEvent<HTMLInputElement>,
    ) => {
        setUserName(event.currentTarget.value)
    }

    const handlePasswordChange = (
        event: h.JSX.TargetedEvent<HTMLInputElement>,
    ) => {
        setPassword(event.currentTarget.value)
    }
    const handleSubmit = async (
        event: h.JSX.TargetedEvent<HTMLFormElement, Event>,
    ) => {
        event.preventDefault()
        const values = {
            userName,
            password,
            sitekey: token,
        }

        if (values.userName === "" || values.password === "") {
            alert("全ての項目を入力してください")
            return
        }

        const res = await fetch("/api/v1/logins/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(values),
        })
        const response = await res.json()
        if (response.status === true) {
            window.location.href = "/"
        } else {
            switch (response.error) {
                case "input":
                    setUserNameError("ユーザーネームまたはパスワードが不正です")
                    setShowUserNameError(true)
                    setPasswordError("ユーザーネームまたはパスワードが不正です")
                    setShowPasswordError(true)
                    break
                case "userNotFound":
                    setUserNameError("ユーザーが見つかりません")
                    setShowUserNameError(true)
                    break
                case "password":
                    setPasswordError("パスワードが不正です")
                    setShowPasswordError(true)
                    break
                default:
                    setUserNameError("ユーザーネームまたはパスワードが不正です")
                    setShowUserNameError(true)
                    setPasswordError("ユーザーネームまたはパスワードが不正です")
                    setShowPasswordError(true)
                    break
            }
        }
    }

    return (
        <>
            <button
                class="mb-3 inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-primary/90 h-11 px-4 py-2 bg-blue-600 text-white w-64 hover:bg-blue-900"
                onClick={handleButtonClick}
            >
                {text}
            </button>
            {showModal && (
                <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(91,112,131,0.4)] left-0 top-0">
                    <div class="bg-[#010005] lg:w-1/3 w-full h-full lg:h-2/3 mx-auto lg:my-[7%] p-5 lg:rounded-xl">
                        <div class="flex justify-end">
                            <span
                                class="ml-0 text-3xl text-gray-400 font-[bold] no-underline cursor-pointer"
                                onClick={handleButtonClick}
                            >
                                ×
                            </span>
                        </div>
                        <div class="w-4/5 mx-auto my-0">
                            <div class="text-center text-sm">
                                <p class="text-white hover:underline font-medium text-3xl mt-8 mb-10">
                                    ログイン
                                </p>
                            </div>
                            <LoginForm
                                onUserNameChange={handleUserNameChange}
                                onPasswordChange={handlePasswordChange}
                                userNameValue={userName}
                                passwordValue={password}
                                onSubmit={handleSubmit}
                                showUserNameError={showUserNameError}
                                userNameError={userNameError}
                                showPasswordError={showPasswordError}
                                passwordError={passwordError}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

function Input({
    value,
    onChange,
    placeholder,
    title,
    type,
    showError,
    errorMessage,
}: InputProps) {
    return (
        <>
            <div class="mb-5">
                <label
                    for="email"
                    class="block mb-2 text-sm font-medium text-white dark:text-white "
                >
                    {title}
                </label>
                <input
                    onChange={onChange}
                    value={value}
                    type={type}
                    class="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                    placeholder={placeholder}
                    required
                />
            </div>
            {showError && <div class="text-red-500 text-xs">{errorMessage}</div>}
        </>
    )
}

function LoginForm({
    onUserNameChange,
    onPasswordChange,
    userNameValue,
    passwordValue,
    onSubmit,
    showUserNameError,
    userNameError,
    showPasswordError,
    passwordError,
}: LoginFormProps) {
    return (
        <>
            <form onSubmit={onSubmit} class="max-w-sm mx-auto">
                <Input
                    placeholder="tako"
                    onChange={onUserNameChange}
                    value={userNameValue}
                    title="ユーザーネーム"
                    type="text"
                    showError={showUserNameError}
                    errorMessage={userNameError}
                />
                <Input
                    placeholder=" "
                    onChange={onPasswordChange}
                    value={passwordValue}
                    title="パスワード"
                    type="password"
                    showError={showPasswordError}
                    errorMessage={passwordError}
                />
                <button
                    type="submit"
                    class="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                >
                    送信
                </button>
            </form>
        </>
    )
}
