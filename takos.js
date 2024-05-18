for(let i = 1; i < 200; i++ ) {
  const data = { prompt: "自己紹介をしてください" };
  const res = await fetch("http://api.natsukiproject.com/v3/s1/ai", {
    mode: "cors",
    method: "POST",
    body: JSON.stringify(data),
    headers: {
      "Content-Type": "application/json",
    },
  })
  if(res.ok) {
    const result = await res.json()
    console.log(result.text)
  }
  }