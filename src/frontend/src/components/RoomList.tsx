import { Room } from '../types';

interface RoomListProps {
  rooms: Room[];
  selectedRoom: Room | null;
  onSelectRoom: (room: Room) => void;
}

export function RoomList({ rooms, selectedRoom, onSelectRoom }: RoomListProps) {
  return (
    <div className="flex-1 overflow-y-auto p-2">
      {rooms.map(room => (
        <div
          key={room.id}
          className={`px-4 py-3 rounded-md cursor-pointer mb-0.5 transition-colors ${
            selectedRoom?.id === room.id
              ? 'bg-blue-600'
              : 'hover:bg-neutral-800'
          }`}
          onClick={() => onSelectRoom(room)}
        >
          <div className="font-medium text-neutral-100"># {room.name}</div>
          {room.description && (
            <div className={`text-sm mt-0.5 ${
              selectedRoom?.id === room.id ? 'text-blue-200' : 'text-neutral-500'
            }`}>
              {room.description}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
