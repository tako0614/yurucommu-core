import { useState } from 'preact/hooks';

export default function RegisterForm({ text, color,tako }: { text: string, color: string; tako: string;}) {
    const classs = "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" + color 

    const [showModal, setShowModal] = useState(false);

    const handleButtonClick = () => {
      setShowModal(!showModal);
    }
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    // deno-lint-ignore no-explicit-any
    const handleSubmit = async (event: any) => {
      event.preventDefault();
      const response = await fetch('https://your-api-endpoint.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      if (response.ok) {
        console.log('Login successful');
      } else {
        console.log('Login failed');
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
                <form onSubmit={handleSubmit} class="">
                  <label class="mb-5">
                    <div>ユーザーネーム</div>
                    <input type="text" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" placeholder="Username" value={username} onInput={(e) => e.target && setPassword((e.target as HTMLInputElement).value)} />
                  </label>
                  <label>
                  <div>パスワード</div>
                    <input type="password" class="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline" placeholder="Username"  value={password} onInput={(e) => e.target && setPassword((e.target as HTMLInputElement).value)} />
                  </label>
                  <div>
                    <input type="submit" value="Submit" />
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
}