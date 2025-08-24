import NotificationsContent from "./home/NotificationsContent.tsx";

export function Notifications() {
  return (
    <div class="text-gray-100 bg-[#1e1e1e] h-screen flex items-center justify-center">
  <div class="p-8 w-full max-w-3xl lg:max-w-4xl min-h-[480px]">
        <NotificationsContent />
      </div>
    </div>
  );
}

export default Notifications;
