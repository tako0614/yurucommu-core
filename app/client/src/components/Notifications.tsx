import NotificationsContent from "./home/NotificationsContent.tsx";

export function Notifications() {
  return (
    <div class="text-gray-100 bg-[#1e1e1e] h-screen">
      <div class="p-4 w-full h-screen overflow-auto">
        <NotificationsContent />
      </div>
    </div>
  );
}

export default Notifications;
