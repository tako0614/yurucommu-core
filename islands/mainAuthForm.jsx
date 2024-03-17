import { useState,useEffect } from 'preact/hooks';
const css = {
    "input": "block "
}
export function MainAuthForm({ sitekey, token }) {
    const [rechapchaToken, setRecaptchaToken] = useState("");
    const [recaptchaLoaded, setRecaptchaLoaded] = useState(false);
    useEffect(() => {
        const script = document.createElement("script");
        script.src = "https://www.google.com/recaptcha/api.js?render=" + sitekey;
        script.async = true;
        script.onload = () => {
          setRecaptchaLoaded(true);
        };
        document.body.appendChild(script);
      }, [sitekey]);
      useEffect(() => {
        if (recaptchaLoaded) {
          window.grecaptcha.ready(() => {
            window.grecaptcha.execute(sitekey, { action: "homepage" }).then((token) => {
              setRecaptchaToken(token);
            });
          });
        }
      }, [recaptchaLoaded, sitekey]);
    const [showForm, setShowForm] = useState(false);
    const [userName, setUserName] = useState('');
    const [password, setPassword] = useState('');
    const [age, setAge] = useState();
    const [isagreement, setIsAgreement] = useState(false);
    const handleUserNameChange = (event) => {
        setUserName(event.currentTarget.value);
    };
    const handlePasswordChange = (event) => {
        setPassword(event.currentTarget.value);
    };
    const handleAgeChange = (event) => {
        setAge(event.currentTarget.value);
    };
    const handleAgreementChange = (event) => {
        setIsAgreement(!isagreement);
    };
    const handleSubmit = async (event) => {
        event.preventDefault();
        const values = {
            userName,
            password,
            age,
            isagreement,
            token,
            rechapchaToken
        }
        if(values.isagreement === false){
            alert("利用規約に同意してください")
            return
        }
        if(values.userName === "" || values.password === "" || values.age === ""){
            alert("全ての項目を入力してください")
            return
        }
        if(values.password.length < 8){
            alert("パスワードは8文字以上で入力してください")
            return
        }
        if(values.age < 0){
            alert("年齢は0以上で入力してください")
            return
        }
        if(values.age > 120){
            alert("年齢は120以下で入力してください")
            return
        }
        if(isNaN(values.age)){
            alert("年齢は数字で入力してください")
            return
        }
        console.log(values)
        const body = JSON.stringify(values)
        const result = await fetch('./api/logins/mainRgsiter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body,
        });
        const response = await result.json()
        console.log(response)
        if (result.status === 200) {
            setShowForm(true);
        } else {
            switch(result.why){
                case "user already exists":
                    alert("ユーザーは既に存在しています")
                    break;
                case "key is not found":
                    alert("keyが見つかりませんでした")
                    break;
                default:
                    alert("エラーが発生しました")
                    break;
            }
        }
    };
    return (
        <>{showForm || (
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
                <div class="flex sm:items-center mb-6noyotei flex-col sm:flex-row">
                <label
                    class="block w-full sm:w-1/3 font-bold sm:text-right mb-1 pr-4"
                    for="address"
                    >年齢</label
                ><input
                    class="block w-full sm:w-2/3 bg-[#0D1117] py-2 px-3 text-white border border-color rounded focus:outline-none focus:bg-white"
                    type="number"
                    value={age} onChange={handleAgeChange}
                />
                </div>
                <div class="sm:items-center mb-6noyotei flex-col sm:flex-row">
                    <input id="default-checkbox" type="checkbox" value="" class="check box" onChange={handleAgreementChange} checked={isagreement}/>
                    <label for="default-checkbox" class="ms-2 text-sm font-medium text-gray-900 dark:text-gray-300"><a href="https://takos.jp/privacypolicy">利用規約</a>に同意します</label>
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
        {showForm && (
            <div>
                <h1 class="text-5xl text-white m-auto">
                    登録完了
                </h1>
            </div>
        )
        }

        </>
    )

}