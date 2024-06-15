export async function takosfetch(url: string, options?: RequestInit) {
    try {
        return await fetch("https://" + url,
            options
        )
    } catch (_e) {
        //
    }
    try {
        return await fetch("http://" + url,
            options
        )
    } catch (_e) {
        return null
    }
}