import { ComponentChild, VNode } from "preact"

export default function User(
  props: {
    userName:
      | string
      | number
      | bigint
      | boolean
      | object
      | ComponentChild[]
      | VNode<any>
      | null
      | undefined
    latestMessage:
      | string
      | number
      | bigint
      | boolean
      | object
      | ComponentChild[]
      | VNode<any>
      | null
      | undefined
  },
) {
  return (
    <>
      <li class="c-talk-rooms">
        <button>
          <span class="c-talk-rooms-icon">
            <img src="static/logo.png" alt="" />
          </span>
          <span class="c-talk-rooms-box">
            <span class="c-talk-rooms-name">
              <span>{props.userName}</span>
            </span>
            <span class="c-talk-rooms-msg">
              <span>{props.latestMessage}</span>
            </span>
          </span>
        </button>
      </li>
    </>
  )
}
