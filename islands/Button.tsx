function isbutton(a: string,b: string) {
    if(a !== undefined) {
      if(b !== undefined) {
        return true;
      }
  }
  }
  export default function Button({ text, script }: { text: string, script: any}) {
    return (
      <button 
        class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        onClick={script}
      >
        {text}
      </button>
    );
  }
  
  