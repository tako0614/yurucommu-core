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
        <div className="modal animate-scale-in-center">
          <div className="modal-content">
            <span className="close" onClick={handleButtonClick}>×</span>
            <p class="	text-black">text message</p>
          </div>
        </div>
      )}
    </> 

}

