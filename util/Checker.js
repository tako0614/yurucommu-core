import sessionid from "../models/sessionid.ts"
import csrftoken from "../models/csrftoken.ts"
import { getCookies } from "$std/http/cookie.ts"
export const checksesssionCSRF = async (req) => {
    if (req.body === null || req.body === undefined) {
        return { status: false }
    }
    const data = await req.json()
    const cookies = getCookies(req.headers)
    if (cookies.sessionid === undefined || cookies.sessionid === null) {
        return { status: false }
    }
    // Check if the CSRF token is valid
    if (typeof data.csrftoken !== "string") {
        return { status: false }
    }
    const iscsrfToken = await csrftoken.findOne({ token: data.csrftoken })
    if (iscsrfToken === null || iscsrfToken === undefined) {
        return false
    }
    if (iscsrfToken.sessionID !== cookies.sessionid) {
        return { status: false }
    }
    await csrftoken.deleteOne({ token: data.csrftoken })
    // Check if the session ID is valid
    const sessionidinfo = await sessionid.findOne({
        sessionID: cookies.sessionid,
    })
    if (sessionidinfo === null || sessionidinfo === undefined) {
        return { status: false }
    }
    return {
        sessionidinfo: sessionidinfo,
        iscsrfToken: iscsrfToken,
        status: true,
        data,
    }
}
export function isNullorUndefind(response) {
    if (response === null || response === undefined) {
        return false
    }
    return true
}
