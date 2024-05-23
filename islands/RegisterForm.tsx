import { useEffect, useState } from "preact/hooks"
//import Button from '../components/Button.tsx'
import { h, JSX } from "preact"
import { useForm } from "react-hook-form"

function isMail(mail: string) {
  const emailPattern = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/
  return emailPattern.test(mail)
}
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

export default function RegisterForm(
  { text, token, sitekey }: { text: string; token: string; sitekey: string },
) {
  const [showModal, setShowModal] = useState(false)
  const [showForm, setShowFrom] = useState("closed")
  const [showError, setShowError] = useState(false)
  const [errorMessages, setErrorMessages] = useState("")
  const [userName, setUserName] = useState("")
  const [nickName, setNickName] = useState("")
  const [password, setPassword] = useState("")
  const [age, setAge] = useState()
  const [mailToken, setMailToken] = useState("")
  const [isagreement, setIsAgreement] = useState(false)
  const [checkCode, setcheckCode] = useState("")
  const [recaptchaToken, setRecaptchaToken] = useState("")
  //errors
  const [userNameErrorMessages, setUserNameErrorMessages] = useState("")
  const [showUserNameError, setShowUserNameError] = useState(false)
  const [passwordErrorMessages, setPasswordErrorMessages] = useState("")
  const [showPasswordError, setShowPasswordError] = useState(false)
  const [emailErrorMessages, setEmailErrorMessages] = useState("")
  const [showEmailError, setShowEmailError] = useState(false)
  const [ageErrorMessages, setAgeErrorMessages] = useState("")
  const [showAgeError, setShowAgeError] = useState(false)
  const [nickNameErrorMessages, setNickNameErrorMessages] = useState("")
  const [showNickNameError, setShowNickNameError] = useState(false)
  const [isagreementErrorMessages, setIsAgreementErrorMessages] = useState("")
  const [showIsAgreementError, setShowIsAgreementError] = useState(false)
  const [checkCodeErrorMessages, setCheckCodeErrorMessages] = useState("")
  const [showCheckCodeError, setShowCheckCodeError] = useState(false)
  //errors end
  const handleCheckCodeChange = (
    event: h.JSX.TargetedEvent<HTMLInputElement>,
  ) => {
    setcheckCode(event.currentTarget.value)
  }
  const handleNickNameChange = (
    event: h.JSX.TargetedEvent<HTMLInputElement>,
  ) => {
    setNickName(event.currentTarget.value)
  }
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
  const handleAgeChange = (event: any) => {
    setAge(event.currentTarget.value)
  }
  const handleAgreementChange = (
    event: h.JSX.TargetedEvent<HTMLInputElement>,
  ) => {
    setIsAgreement(!isagreement)
  }
  const handleButtonClick = () => {
    setShowModal(!showModal)
  }
  const [email, setEmail] = useState("")
  const handleEmailChange = (
    event: h.JSX.TargetedEvent<HTMLInputElement>,
  ) => {
    const value = event.currentTarget.value
    setEmail(value)
  }
  const handleSubmit = async (
    event: JSX.TargetedEvent<HTMLFormElement, Event>,
  ) => {
    event.preventDefault()
    const data = {
      email,
      rechapchaToken: token,
      requirments: "register",
    }
    if (!isMail(data.email)) {
      setShowEmailError(true)
      setEmailErrorMessages("メールアドレスが不正です")
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
      return
    }
    setShowError(false)
    const res = await fetch("/api/v1/logins/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })
    const response = await res.json()
    if (response.status !== true) {
      console.log(response.error)
      setShowEmailError(true)
      switch (response.error) {
        case "mail":
          //setErrorMessages("メールアドレスが不正です")
          setEmailErrorMessages("メールアドレスが不正です")
          break
        case "mailDuplication":
          //setErrorMessages("メールアドレスが重複しています")
          setEmailErrorMessages("メールアドレスが重複しています")
          break
        case "recaptcha":
          //setErrorMessages("reCAPTCHAが正しくありません")
          setEmailErrorMessages("reCAPTCHAが正しくありません")
          break
        case "input":
          //setErrorMessages("入力が不正です")
          setEmailErrorMessages("入力が不正です")
          break
        default:
          //setErrorMessages("不明なエラーが発生しました")
          setEmailErrorMessages("不明なエラーが発生しました")
          break
      }
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
          console.log("recaptcha token is updated")
        },
      )
    } else {
      setMailToken(response.mailToken)
      setShowFrom("checkMail")
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
    }
  }
  const mailCkeckHandleSubmit = async (
    event: JSX.TargetedEvent<HTMLFormElement, Event>,
  ) => {
    event.preventDefault()
    const data = {
      requirments: "checkMail",
      mailToken,
      rechapchaToken: recaptchaToken,
      checkCode: checkCode,
    }
    if (data.mailToken === undefined || data.mailToken === "") {
      setShowCheckCodeError(true)
      setCheckCodeErrorMessages("トークンが不正です")
      return
    }
    setShowError(false)
    const res = await fetch("/api/v1/logins/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })
    const response = await res.json()
    if (response.status !== true) {
      setShowCheckCodeError(true)
      setCheckCodeErrorMessages("トークンが不正です")
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
    } else {
      setShowFrom("registering")
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
    }
  }
  const registerHandleSubmit = async (
    event: JSX.TargetedEvent<HTMLFormElement, Event>,
  ) => {
    event.preventDefault()
    console.log()
    const data = {
      requirments: "mainRegister",
      userName,
      nickName,
      password,
      age,
      rechapchaToken: recaptchaToken,
      mailToken,
      isagreement,
    }
    if (
      data.userName === undefined || data.nickName === undefined ||
      data.password === undefined || data.age === undefined ||
      data.userName === "" || data.nickName === "" ||
      data.password === "" ||
      data.age === ""
    ) {
      setShowError(true)
      setErrorMessages("全ての項目を入力してください")
      return
    }
    //ユーザーネーム検証
    if (/^[a-zA-Z0-9-_]{4,16}$/.test(data.userName) === false) {
      setShowUserNameError(true)
      setUserNameErrorMessages("ユーザーネームが不正です")
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
      return
    }
    //パスワード検証
    if (
      /^(?=.*?[a-z])(?=.*?\d)[a-z\d]{8,}$/i.test(data.password) === false
    ) {
      setShowPasswordError(true)
      setPasswordErrorMessages("パスワードが不正です")
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
      return
    }
    if (data.age < 1 || data.age > 120) {
      setShowAgeError(true)
      setAgeErrorMessages("年齢が不正です")
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
      return
    }
    if (/^[ぁ-んァ-ン一-龥a-zA-Z0-9]{1,20}$/.test(nickName) === false) {
      setShowNickNameError(true)
      setNickNameErrorMessages("ニックネームが不正です")
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
      return
    }
    if (isagreement === false) {
      setShowIsAgreementError(true)
      setIsAgreementErrorMessages("利用規約に同意してください")
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
      return
    }
    setShowError(false)
    const res = await fetch("/api/v1/logins/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })
    const response = await res.json()
    if (response.status !== true) {
      setShowError(true)
      switch (response.error) {
        case "userName":
          setShowUserNameError(true)
          setUserNameErrorMessages("ユーザーネームが重複しています")
          break
        case "nickName":
          setShowNickNameError(true)
          setNickNameErrorMessages("ニックネームが重複しています")
          break
        case "input":
          alert("入力が不正です")
          break
        case "recaptcha":
          alert("reCAPTCHAが正しくありません")
          break
        default:
          alert("不明なエラーが発生しました" + response.error)
          break
      }
      window.grecaptcha.execute(sitekey, { action: "homepage" }).then(
        (token) => {
          setRecaptchaToken(token)
        },
      )
    } else {
      setShowFrom("finished")
    }
  }
  return (
    <>
      <button
        class="mb-3 inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-11 px-4 py-2 bg-black border border-white text-white w-64 hover:bg-gray-900"
        onClick={handleButtonClick}
      >
        {text}
      </button>
      {showModal && (
        <div class="fixed z-50 w-full h-full overflow-hidden bg-[rgba(75,92,108,0.4)] left-0 top-0 text-black">
        <div class="bg-[#f0f0f5] dark:bg-black lg:w-1/3 w-full h-full lg:h-4/6 mx-auto lg:my-[6.5%] p-5 lg:rounded-xl">
            <div class="flex float-right">
              <span
                className="text-[#aaa] text-[28px] font-[bold] no-underline cursor-pointer"
                onClick={handleButtonClick}
              >
                ×
              </span>
            </div>
            <div class="w-4/5 mx-auto my-0">
              <div class="">
                <div class="text-center text-sm">
                  <p class="dark:text-white text-black hover:underline font-medium text-3xl mt-16 mb-10">
                    アカウント作成
                  </p>
                </div>
                {showForm == "closed" && (
                  <>
                    <EmailForm
                      onSubmit={handleSubmit}
                      showError={showEmailError}
                      errorMessages={emailErrorMessages}
                      onChange={handleEmailChange}
                      value={email}
                    />
                  </>
                )}
                {showForm == "checkMail" && (
                  <>
                    <CheckEmailForm
                      onChange={handleCheckCodeChange}
                      value={checkCode}
                      onSubmit={mailCkeckHandleSubmit}
                      showError={showCheckCodeError}
                      errorMessages={checkCodeErrorMessages}
                    />
                  </>
                )}
                {showForm == "registering" && (
                  <>
                    <MainRegisterForm
                      userNameOnChange={handleUserNameChange}
                      nickNameOnChnage={handleNickNameChange}
                      passwordOnChange={handlePasswordChange}
                      ageOnChange={handleAgeChange}
                      agreementOnChange={handleAgreementChange}
                      onSubmit={registerHandleSubmit}
                      userName={userName}
                      nickName={nickName}
                      password={password}
                      age={age}
                      isagreement={isagreement}
                      errorMessages={errorMessages}
                      showUsernameError={showUserNameError}
                      showNickNameError={showNickNameError}
                      showPasswordError={showPasswordError}
                      showAgeError={showAgeError}
                      showIsAgreementError={showIsAgreementError}
                      userNameErrorMessage={userNameErrorMessages}
                      nicknameErrorMessage={nickNameErrorMessages}
                      passwordErrorMessage={passwordErrorMessages}
                      ageErrorMessage={ageErrorMessages}
                      isAgreementErrorMessage={isagreementErrorMessages}
                    />
                  </>
                )}
                {showForm == "finished" && (
                  <div class="dark:text-white text-black text-3xl">
                    本登録が完了しました。閉じてログインしてください
                  </div>
                )}
              </div>
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
}: {
  showError: boolean
  errorMessage: string
  value: any
  onChange: (event: h.JSX.TargetedEvent<HTMLInputElement>) => void
  placeholder: string
  title: string
  type: string
}) {
  return (
    <>
      <div class="mb-5">
        <label
          for="email"
          class="block mb-2 text-sm font-medium text-black dark:text-white"
        >
          {title}
        </label>
        <input
          onChange={onChange}
          value={value}
          type={type}
          class="bg-gray-50 border border-gray-300 text-gray-900 dark:text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:focus:ring-blue-500 dark:focus:border-blue-500"
          placeholder={placeholder}
          required
        />
      </div>
      {showError && <div class="text-red-500 text-xs">{errorMessage}</div>}
    </>
  )
}
function EmailForm({
  onChange,
  value,
  onSubmit,
  showError,
  errorMessages,
}: {
  onChange: any
  value: any
  onSubmit: (event: h.JSX.TargetedEvent<HTMLFormElement, Event>) => void
  showError: boolean
  errorMessages: string
}) {
  return (
    <>
      <form onSubmit={onSubmit} class="max-w-sm mx-auto">
        <Input
          placeholder="tako@example.com"
          onChange={onChange}
          value={value}
          title="メールアドレス"
          type="email"
          showError={showError}
          errorMessage={errorMessages}
        />
        <button
          type="submit"
          class="text-white dark:text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 font-medium rounded-lg text-sm w-full sm:w-auto px-5 py-2.5 text-center dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
        >
          送信
        </button>
      </form>
    </>
  )
}
function CheckEmailForm({
  onChange,
  value,
  onSubmit,
  showError,
  errorMessages,
}: {
  onChange: any
  value: any
  onSubmit: (event: h.JSX.TargetedEvent<HTMLFormElement, Event>) => void
  showError: boolean
  errorMessages: string
}) {
  return (
    <>
      <form onSubmit={onSubmit} class="max-w-sm mx-auto">
        <p class="text-white hover:underline font-medium text-xl mb-10">
          確認コードを送信しました。認証してください
        </p>
        <Input
          placeholder="xxxxxx"
          onChange={onChange}
          value={value}
          title="確認コード"
          type="number"
          showError={showError}
          errorMessage={errorMessages}
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
function MainRegisterForm({
  userNameOnChange,
  nickNameOnChnage,
  passwordOnChange,
  ageOnChange,
  agreementOnChange,
  userName,
  nickName,
  password,
  age,
  isagreement,
  onSubmit,
  showUsernameError,
  showNickNameError,
  showPasswordError,
  showAgeError,
  showIsAgreementError,
  userNameErrorMessage,
  nicknameErrorMessage,
  passwordErrorMessage,
  ageErrorMessage,
  isAgreementErrorMessage,
}: {
  userNameOnChange: any
  nickNameOnChnage: any
  passwordOnChange: any
  ageOnChange: any
  agreementOnChange: any
  userName: string
  nickName: string
  password: string
  age: any
  isagreement: boolean
  onSubmit: (event: h.JSX.TargetedEvent<HTMLFormElement, Event>) => void
  showUsernameError: boolean
  showNickNameError: boolean
  showPasswordError: boolean
  showAgeError: boolean
  showIsAgreementError: boolean
  errorMessages: string
  userNameErrorMessage: string
  nicknameErrorMessage: string
  passwordErrorMessage: string
  ageErrorMessage: string
  isAgreementErrorMessage: string
}) {
  return (
    <>
      <form onSubmit={onSubmit} class="max-w-sm mx-auto">
        <Input
          placeholder="tako0614"
          onChange={userNameOnChange}
          value={userName}
          title="ユーザーネーム"
          type="text"
          showError={showUsernameError}
          errorMessage={userNameErrorMessage}
        />
        <Input
          placeholder="たこ"
          onChange={nickNameOnChnage}
          value={nickName}
          title="ニックネーム"
          type="text"
          showError={showNickNameError}
          errorMessage={nicknameErrorMessage}
        />
        <Input
          placeholder="************"
          onChange={passwordOnChange}
          value={password}
          title="パスワード"
          type="password"
          showError={showPasswordError}
          errorMessage={passwordErrorMessage}
        />
        <Input
          placeholder="20"
          onChange={ageOnChange}
          value={age}
          title="年齢"
          type="number"
          showError={showAgeError}
          errorMessage={ageErrorMessage}
        />
        <div class="flex items-start mb-5">
          <div class="flex items-center h-5">
            <input
              onChange={agreementOnChange}
              checked={isagreement}
              type="checkbox"
              class="w-4 h-4 border border-gray-300 rounded bg-gray-50 focus:ring-3 focus:ring-blue-300 dark:bg-gray-700 dark:border-gray-600 dark:focus:ring-blue-600 dark:ring-offset-gray-800 dark:focus:ring-offset-gray-800"
              required
            />
            {showIsAgreementError && (
              <div class="text-red-500 text-xs">
                {isAgreementErrorMessage}
              </div>
            )}
          </div>
          <label
            for="remember"
            class="ms-2 text-sm font-medium text-gray-900 dark:text-gray-300"
          >
            利用規約に同意
          </label>
        </div>
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
