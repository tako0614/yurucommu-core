function isbutton(a,b) {
  if(a !== undefined) {
    if(b !== undefined) {
      return true;
    }
  
}
}
export default function Button({ text, url, script }: { text: string, url?: string, script?: () => void }) {
  if(isbutton(url,script)) {
    return "error: urlとscriptの両方が指定されています。"
  }
  let url2 = `location.href=${url ? url : undefined}`
  return (
    <button 
      class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
      onClick={url2}
      onClick={script ? script : undefined}
    >
      {text}
    </button>
  );
}