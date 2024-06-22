import RegisterForm from "../islands/RegisterForm.tsx"
import LoginForm from "../islands/LoginForm.tsx"
import { useEffect, useState } from "preact/hooks"
import Footer from "../components/Footer.tsx"
import ChatOtherMessage from "../components/Chats/ChatOtherMessageWelcome.jsx"
import ChatSendMessage from "../components/Chats/ChatSendMessage.jsx"
declare global {
    interface Window {
        grecaptcha: {
            ready: (callback: () => void) => void
            execute: (
                siteKey: string,
                options: { action: string },
            ) => Promise<string>
        }
    }
}
const ChatDataDefo = [
    {
        isSend: false,
        message: "最近どんなプログラミング言語に興味がありますか？",
        time: "2021-10-11T14:25:00Z",
        sender: "tako@takos.jp",
        senderNickName: "tako",
        isPrimary: true,
    },
    {
        isSend: true,
        message: "最近はPythonにハマっています。シンプルで強力な言語ですね。",
        time: "2021-10-11T14:27:00Z",
        isRead: true,
        isPrimary: true,
    },
    {
        isSend: false,
        message: "Pythonはデータ分析や機械学習にも使われていて便利ですよね。",
        time: "2021-10-11T14:30:00Z",
        sender: "tako@takos.jp",
        senderNickName: "tako",
        isPrimary: true,
    },
    {
        isSend: true,
        message: "そうですね。あなたはどのプログラミング言語が好きですか？",
        time: "2021-10-11T14:32:00Z",
        isRead: true,
        isPrimary: true,
    },
    {
        isSend: false,
        message: "私はJavaScriptが好きです。ウェブ開発に欠かせない言語ですから。",
        time: "2021-10-11T14:35:00Z",
        sender: "tako@takos.jp",
        senderNickName: "tako",
        isPrimary: true,
    },
    {
        isSend: true,
        message: "JavaScriptはフロントエンドでもバックエンドでも使えますよね。",
        time: "2021-10-11T14:37:00Z",
        isRead: true,
        isPrimary: true,
    },
    {
        isSend: false,
        message: "そうなんです。Node.jsを使ってサーバーサイドも書けるのが魅力です。",
        time: "2021-10-11T14:40:00Z",
        sender: "tako@takos.jp",
        senderNickName: "tako",
        isPrimary: true,
    },
    {
        isSend: true,
        message: "最近はTypeScriptも人気ですね。JavaScriptに型の安全性を追加したものです。",
        time: "2021-10-11T14:42:00Z",
        isRead: true,
        isPrimary: true,
    },
    {
        isSend: false,
        message: "TypeScriptも試してみましたが、型があると安心感がありますね。",
        time: "2021-10-11T14:45:00Z",
        sender: "tako@takos.jp",
        senderNickName: "tako",
        isPrimary: true,
    },
    {
        isSend: true,
        message: "他にもRustやGoも注目されていますね。どちらも高速で安全性が高い言語です。",
        time: "2021-10-11T14:47:00Z",
        isRead: true,
        isPrimary: true,
    },
    {
        isSend: false,
        message: "Rustはシステムプログラミングに適していて、メモリ管理が特徴的です。",
        time: "2021-10-11T14:50:00Z",
        sender: "tako@takos.jp",
        senderNickName: "tako",
        isPrimary: true,
    },
    {
        isSend: true,
        message: "Goは並行処理が得意で、サーバーサイド開発によく使われます。",
        time: "2021-10-11T14:52:00Z",
        isRead: true,
        isPrimary: true,
    },
    {
        isSend: false,
        message: "Goのシンプルな文法と高速なコンパイルが気に入っています。",
        time: "2021-10-11T14:55:00Z",
        sender: "tako@takos.jp",
        senderNickName: "tako",
        isPrimary: true,
    },
    {
        isSend: true,
        message: "C++も強力な言語ですが、複雑でエラーが出やすいですね。",
        time: "2021-10-11T14:57:00Z",
        isRead: true,
        isPrimary: true,
    },
    {
        isSend: false,
        message: "そうですね。でもC++の性能と柔軟性は他にない魅力です。",
        time: "2021-10-11T15:00:00Z",
        sender: "tako@takos.jp",
        senderNickName: "tako",
        isPrimary: true,
    },
    {
        isSend: true,
        message: "確かに。結局、使い方次第ですね。",
        time: "2021-10-11T15:02:00Z",
        isRead: true,
        isPrimary: true,
    },
    {
        isSend: false,
        message: "はい、プロジェクトや目的に応じて最適な言語を選ぶのが一番ですね。",
        time: "2021-10-11T15:05:00Z",
        sender: "tako@takos.jp",
        senderNickName: "tako",
        isPrimary: true,
    }
];
const ChatResponse = [
    {
        isSend: false,
        message: "うにゃぁぁぁあぁぁｌ",
        time: "2021-10-10T10:10:10Z",
        sender: "takoserver",
        senderNickName: "takoserver",
        isPrimary: true,
    },
    {
        isSend: false,
        message: "うへうへへへへ",
        time: "2021-10-10T10:10:10Z",
        sender: "takoserver",
        senderNickName: "takoserver",
        isPrimary: true,
    },
    {
        isSend: false,
        message: "ぶしゃぁぁぁぁぁぁぁぁ",
        time: "2021-10-10T10:10:10Z",
        sender: "takoserver",
        senderNickName: "takoserver",
        isPrimary: true,
    },
    {
        isSend: false,
        message: "うにょおおおおおおおお",
        time: "2021-10-10T10:10:10Z",
        sender: "takoserver",
        senderNickName: "takoserver",
        isPrimary: true,
    },
    {
        isSend: false,
        message: "たこたこびーーーむ！！",
        time: "2021-10-10T10:10:10Z",
        sender: "takoserver",
        senderNickName: "takoserver",
        isPrimary: true,
    },
]



export default function Welcome({ sitekey }: { sitekey: string }) {
    const [recaptchaToken, setRecaptchaToken] = useState("")
    const [recaptchaLoaded, setRecaptchaLoaded] = useState(false)
    const [ChatData, setChatData] = useState(ChatDataDefo)
    const [message, setMessage] = useState("")
    useEffect(() => {
        const script = document.createElement("script")
        script.src = "https://www.google.com/recaptcha/api.js?render=" + sitekey
        script.async = true
        script.onload = () => {
            setRecaptchaLoaded(true)
        }
        document.body.appendChild(script)
    }, [sitekey])

    useEffect(() => {
        if (recaptchaLoaded) {
            window.grecaptcha.ready(() => {
                window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
                    (token) => {
                        setRecaptchaToken(token)
                    },
                )
            })
        }
    }, [recaptchaLoaded, sitekey])
    return (
        <>
            <div class="flex w-full h-screen overflow-hidden">
                <div class="relative lg:w-1/3 w-full ml-16 mr-16 px-0 py-[50px]">
                    <div class="w-full bg-white text-black rounded-lg shadow-[0_12px_32px_#00000040] p-5">
                        <div class="lg:flex">
                            <div class="lg:w-2/3">
                                <div class="flex items-center mb-4">
                                    <img
                                        src="./logo-mine.jpg"
                                        alt="logo"
                                        class="w-20 h-20 rounded-lg shadow-md"
                                    />
                                    <h1 class="text-3xl font-bold ml-4">
                                        takos.jp
                                    </h1>
                                </div>
                                <div class="text-base text-gray-700 mb-6">
                                    takos.jpは、次世代の分散型チャットサービスを提供する日本発のプロジェクトです。このサービスは、ユーザーの意見を反映したサーバーに登録や移行が可能で、無駄な機能を排除し、本当に必要な機能のみを実装することを目指しています。
                                </div>
                            </div>
                            <div class="lg:w-1/3">
                                <div class="space-y-3 mb-6">
                                    <RegisterForm
                                    token={recaptchaToken}
                                    sitekey={sitekey}
                                    />
                                    <button 
                                    onClick={
                                        () => {
                                            alert("まだ実装してない！！！")
                                        }
                                    }
                                    class="bg-[#192320] text-white rounded-3xl py-2 px-4 hover:bg-[#192320] border w-full mt-5">
                                        他のサーバーを探す
                                    </button>
                                    <LoginForm
                                    token={recaptchaToken}
                                    >

                                    </LoginForm>
                                </div>
                            </div>
                        </div>
                        <div class="flex w-full space-x-4 mb-6">
                            <div class="w-1/2 bg-gray-200 text-center py-4 rounded-lg shadow-inner">
                                <p class="text-sm text-gray-700">ユーザー</p>
                                <p class="text-xl font-semibold">10,001</p>
                            </div>
                            <div class="w-1/2 bg-gray-200 text-center py-4 rounded-lg shadow-inner">
                                <p class="text-sm text-gray-700">
                                    接続サーバー
                                </p>
                                <p class="text-xl font-semibold">2</p>
                            </div>
                        </div>
                        <div class="w-full bg-gray-200 text-center py-4 rounded-lg shadow-inner mb-6">
                            <p class="text-sm text-gray-700">version</p>
                            <p class="text-lg font-semibold">takos v0.1</p>
                        </div>
                        <div>
                            <img
                                src="https://quickchart.io/chart?w=350&h=150&c={type:'line',data:{labels:['1月','2月', '3月','4月', '5月','6月','7月','8月','9月','10月','11月','12月'], datasets:[{label:'メッセージ数', data: [-5,-2,1,7,9], fill:false,borderColor:'black'}]}}"
                                class="mx-auto"
                                alt=""
                            />
                        </div>
                        <div class="w-full bg-gray-200 text-center py-4 rounded-lg shadow-inner">
                            <p class="text-sm text-gray-700">© 2024 Tomiyama Shota.</p>
                            <p class="text-base text-gray-600">
                                Powered By takoserver
                            </p>

                            <p class="text-sm text-gray-700">
                            This site is protected by reCAPTCHA and the Google
                                <a href="https://policies.google.com/privacy">Privacy Policy</a> and
                                <a href="https://policies.google.com/terms">Terms of Service</a> apply.
                            </p>
                            <div class="flex justify-between w-2/3 mx-auto">
                                <p >
                                    <a href="https://www.takos.jp/privacypolicy">
                                        プライバシーポリシー
                                    </a>
                                </p>
                                <p class="ml-4">
                                    <a href="https://www.takos.jp/terms">
                                        利用規約
                                    </a>
                                </p>
                                <p class="ml-4">
                                    <a href="https://x.com/takoserver_com">
                                        SNS
                                    </a>
                                </p>
                                <p class="ml-4">
                                    <a href="https://line.me/ti/g2/Q0c8YJlkh5f_hkDuODxp39XF9A7BOCFqezaAHA?utm_source=invitation&utm_medium=link_copy&utm_campaign=default">
                                        コミュニティー
                                    </a>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
                {/*右側 */}
                <div class="w-1/3 ml-auto h-full bg-[#00000031] rounded-lg my-2 hidden lg:block">
                    <h1
                    class="text-white text-3xl font-bold text-center mt-4"
                    >チャット体験コーナー</h1>
                    <div class="p-talk-chat-main p-2">
                    {ChatData.map((data) => {
                        if (data.isSend) {
                            return (
                                <ChatSendMessage
                                    message={data.message}
                                    time={data.time}
                                    isRead={data.isRead}
                                    isPrimary={data.isPrimary}
                                />
                            )
                        }
                        return (
                            <ChatOtherMessage
                                message={data.message}
                                time={data.time}
                                sender={data.sender}
                                senderNickName={data.senderNickName}
                                isPrimary={data.isPrimary}
                            />
                        )
                    })}
                    </div>
                    <div class="p-talk-chat-send">
                        <form class="p-talk-chat-send__form">
                            <div class="p-talk-chat-send__msg">
                                <div
                                    class="p-talk-chat-send__dummy"
                                    aria-hidden="true"
                                >
                                </div>
                                <label>
                                    <textarea
                                        class="p-talk-chat-send__textarea"
                                        placeholder="メッセージを入力"
                                        value={message}
                                        onChange={(e) =>
                                            setMessage((e.target as HTMLTextAreaElement)?.value)
                                        }
                                    >
                                    </textarea>
                                </label>
                            </div>
                            <div
                                class="p-talk-chat-send__file"
                                onClick={() => {
                                    if(!message) return
                                    setChatData(
                                        ChatData.concat({
                                            isSend: true,
                                            message: message,
                                            time: new Date().toISOString(),
                                            isRead: false,
                                            isPrimary: true,
                                        }),
                                    )
                                    const newChatData = ChatData.concat({
                                        isSend: true,
                                        message: message,
                                        time: new Date().toISOString(),
                                        isRead: false,
                                        isPrimary: true,
                                    })
                                    //0から4までのランダムな数値を生成
                                    const random = Math.floor(Math.random() * 5)
                                    setTimeout(() => {
                                        setChatData(
                                            newChatData.concat({
                                                isSend: false,
                                                message: ChatResponse[random].message,
                                                time: new Date().toISOString(),
                                                sender: ChatResponse[random].sender,
                                                senderNickName: ChatResponse[random].senderNickName,
                                                isPrimary: true,
                                            }),
                                        )
                                    }, 1000)
                                    setMessage("")
                                }}
                            >
                                <img
                                    src="/ei-send.svg"
                                    alt="file"
                                />
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </>
    )
}
