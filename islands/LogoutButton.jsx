function LogoutButton() {
  const logout = async () => {
    const res = await fetch("/api/logins/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reqirments: "logout" }),
    });
    const data = await res.json();
    if (data.status === true) {
      document.cookie = "sessionid=; max-age=0";
      window.location.href = "/";
    }
  };
  return (
    <a
      class="flex items-center gap-2 py-2 px-3 rounded-md text-sm font-medium"
      href="#"
      onClick={logout}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-5 h-5"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" x2="9" y1="12" y2="12"></line>
      </svg>
      <span class="font-medium">Logout</span>
    </a>
  );
}

export default LogoutButton;
