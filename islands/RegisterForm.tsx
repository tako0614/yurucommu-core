import { useState } from 'preact/hooks';

export default function RegisterForm({ text, color,tako }: { text: string, color: string; tako: string;}) {
    const classs = "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" + color 

    const [showModal, setShowModal] = useState(false);

    const handleButtonClick = () => {
      setShowModal(!showModal);
    }
  
return <>

    <button class={classs} onClick={handleButtonClick}>
        {text}
    </button>
    {showModal && (
        <div className="fixed z-[1] w-full h-full overflow-auto bg-[rgba(0,0,0,0.4)] left-0 top-0 animate-scale-in-center">
          <div className="bg-[#fefefe] border w-[30%] h-[30%] mx-auto my-[15%] p-5 border-solid border-[#888]">
            <span className="text-[#aaa] float-right text-[28px] font-[bold] no-underline cursor-pointer" onClick={handleButtonClick}>×</span>
            <p class="	text-black">text message</p>
          </div>
        </div>
      )}
    </> 

}

