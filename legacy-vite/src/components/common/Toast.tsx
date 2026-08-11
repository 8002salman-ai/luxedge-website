import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { useNotificationStore } from '../../store/notificationStore';

export default function Toast() {
  const { notifications, removeNotification } = useNotificationStore();

  if (notifications.length === 0) return null;

  const icons = {
    success: <CheckCircle size={18} className="text-green-500" />,
    error: <AlertCircle size={18} className="text-red-500" />,
    warning: <AlertTriangle size={18} className="text-amber-500" />,
    info: <Info size={18} className="text-blue-500" />,
  };

  const bgColors = {
    success: 'bg-green-50 border-green-200',
    error: 'bg-red-50 border-red-200',
    warning: 'bg-amber-50 border-amber-200',
    info: 'bg-blue-50 border-blue-200',
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] space-y-2">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg animate-slide-in-right ${bgColors[notification.type]}`}
        >
          {icons[notification.type]}
          <p className="text-sm text-gray-800">{notification.message}</p>
          <button
            onClick={() => removeNotification(notification.id)}
            className="ml-2 p-1 hover:bg-black/5 rounded-full transition-colors"
          >
            <X size={14} className="text-gray-500" />
          </button>
        </div>
      ))}
    </div>
  );
}
