
export default function User({ userName, latestMessage, icon }) {
  return (
    <>
      <li class="c-talk-rooms">
        <a href="">
          <div class="c-talk-rooms-icon">
            <img src={icon} />
          </div>
          <div class="c-talk-rooms-box">
            <div class="c-talk-rooms-name">
              <p>{userName}</p>
            </div>
            <div class="c-talk-rooms-msg">
              <p>{latestMessage}</p>
            </div>
          </div>
        </a>
      </li>
    </>
  );
}
/*
export default async function User({ userName, latestMessage }) {
  if(await fileExists("../../files/userIcons/" + userName.webp)) {
    const iconData = Deno.readFile("../../files/userIcons/" + userName.webp);
  } else {
    const iconData = Deno.readFile("../../static/people.png");
  }
  console.log("aaa")
  return (
    <>
      <li class="c-talk-rooms">
        <a href="">
          <div class="c-talk-rooms-icon">
            <img src="static/logo.png" alt="" />
          </div>
          <div class="c-talk-rooms-box">
            <div class="c-talk-rooms-name">
              <p>{userName}</p>
            </div>
            <div class="c-talk-rooms-msg">
              <p>{latestMessage}</p>
            </div>
          </div>
        </a>
      </li>
    </>
  );
}
async function fileExists(filepath){
  try {
    const file = await Deno.stat(filepath);
    return file.isFile();
  } catch (e) {
    return false;
  }
}

* */
