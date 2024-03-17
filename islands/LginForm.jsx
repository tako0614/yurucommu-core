import {useState, useEffect} from "preact/hooks"
function LginForm() {
    const [userName, setUserName] = useState("")
    const [password, setPassword] = useState("")
    const handleUserNameChange = (event) => {
        setUserName(event.currentTarget.value);
    };
    const handlePasswordChange = (event) => {
        setUserName(event.currentTarget.value);
    };
    const handleSubmit = async (event) => {
        event.preventDefault();
        const values = {
            userName,
            password
        }
        if(values.userName === "" || values.password === ""){
            alert("全ての項目を入力してください")
            return
        }
        const response = await fetch("https://takoserver.com/api/v1/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(values)
        })
        }
        const response = await result.json()
    }
  return (
    <section class="text-gray-600 flex flex-col items-center px-2">
        <h1 class="text-3xl font-bold mt-10noyotei">takoserverアカウント登録</h1>
        <div class="w-2/3 m-auto">
        <form class="shadow-md rounded-md w-full max-w-2xl p-10" onSubmit={handleSubmit}>
            <div class="flex sm:items-center mb-6noyotei flex-col sm:flex-row">
            <label
                class="block sm:w-1/3 font-bold sm:text-right mb-1 pr-4"
                for="name"
                >ユーザーネーム <span class="text-red-600"> * </span></label
            ><input
                class="block w-full sm:w-2/3 bg-[#0D1117] py-2 px-3 text-white border border-color rounded focus:outline-none focus:bg-white"
                id="name"
                type="text"
                value={userName} onChange={handleUserNameChange}
            />
            </div>
            <div class="flex sm:items-center mb-6noyotei flex-col sm:flex-row">
            <label
                class="block sm:w-1/3 font-bold sm:text-right mb-1 pr-4"
                >パスワード</label
            ><input
                class="block w-24 bg-[#0D1117] py-2 px-3 text-white border border-color rounded focus:outline-none focus:bg-white"
                type="password"
                value={password} onChange={handlePasswordChange}
            />
            </div>
            <div class="flex justify-center">
            <button
                class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded fucus:outline-none focus:shadow-outline mt-3"
            >
                確認
            </button>
            </div>
        </form>
        </div>
    </section>
  )
}

export default LginForm