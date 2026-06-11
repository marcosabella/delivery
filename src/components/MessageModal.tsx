import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

type MessageModalType = 'error' | 'info' | 'success';

interface MessageModalProps {
  message: string;
  onClose: () => void;
  title?: string;
  type?: MessageModalType;
}

const modalStyles: Record<MessageModalType, { icon: typeof Info; iconClass: string; title: string }> = {
  error: { icon: AlertCircle, iconClass: 'bg-red-100 text-red-600', title: 'Ocurrió un error' },
  info: { icon: Info, iconClass: 'bg-blue-100 text-blue-600', title: 'Atención' },
  success: { icon: CheckCircle, iconClass: 'bg-green-100 text-green-600', title: 'Operación exitosa' },
};

export function MessageModal({ message, onClose, title, type = 'info' }: MessageModalProps) {
  const style = modalStyles[type];
  const Icon = style.icon;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="message-modal-title">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${style.iconClass}`}>
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <h2 id="message-modal-title" className="text-lg font-bold text-gray-800">{title || style.title}</h2>
              <p className="mt-1 text-sm leading-6 text-gray-600">{message}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Cerrar mensaje">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onClose} autoFocus className="rounded-lg bg-orange-500 px-5 py-2 font-semibold text-white hover:bg-orange-600">
            Aceptar
          </button>
        </div>
      </div>
    </div>
  );
}
