import { useState } from 'react';
import { CheckCircle2, Printer, X } from 'lucide-react';
import { openOrderTicket, PrintableOrderTicket } from '../lib/orderTicket';

export type PaymentMethod = 'cash' | 'transfer' | 'current_account' | 'debit' | 'credit' | 'other';

const paymentLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  current_account: 'Cta cte',
  debit: 'Debito',
  credit: 'Credito',
  other: 'Otro',
};

const paymentOptions: PaymentMethod[] = ['cash', 'transfer', 'debit', 'credit', 'current_account', 'other'];

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

type TableCloseModalProps = {
  restaurantName: string;
  ticket: PrintableOrderTicket;
  closing?: boolean;
  onClose: () => void;
  onConfirm: (payment: { method: PaymentMethod; label: string; amount: number }) => void;
};

export function TableCloseModal({ restaurantName, ticket, closing = false, onClose, onConfirm }: TableCloseModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const paymentLabel = paymentLabels[paymentMethod];
  const printableTicket = {
    ...ticket,
    paymentLabel,
    paymentAmount: ticket.totalAmount,
  };

  function handlePrintAndConfirm() {
    const printed = openOrderTicket(restaurantName, printableTicket);
    if (!printed) window.alert('El navegador bloqueo la ventana de impresion. Habilita las ventanas emergentes e intenta nuevamente.');
    if (printed) onConfirm({ method: paymentMethod, label: paymentLabel, amount: ticket.totalAmount });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-labelledby="table-close-title">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-4">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Cierre de mesa</p>
            <h2 id="table-close-title" className="text-lg font-bold text-slate-900">{ticket.tableLabel || 'Pedido de mesa'}</h2>
            <p className="text-sm text-slate-500">Pedido #{ticket.orderId.slice(0, 8)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">Mozo</p>
              <p className="truncate text-sm font-semibold text-slate-900">{ticket.waiterName || 'No informado'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-500">Mesa</p>
              <p className="truncate text-sm font-semibold text-slate-900">{ticket.tableLabel || ticket.deliveryAddress}</p>
            </div>
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="text-xs font-medium text-orange-700">Total</p>
              <p className="text-lg font-bold text-orange-700">{moneyFormatter.format(ticket.totalAmount)}</p>
            </div>
          </div>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Detalle</h3>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {ticket.items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{item.quantity}x {item.name}</p>
                  </div>
                  <p className="text-sm font-semibold text-slate-700">{moneyFormatter.format(item.subtotal)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-3">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Forma de pago</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {paymentOptions.map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      paymentMethod === method
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {paymentLabels[method]}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {ticket.notes && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
              <p className="text-xs font-semibold text-yellow-800">Notas</p>
              <p className="text-sm text-yellow-900">{ticket.notes}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 p-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancelar
          </button>
          <button
            type="button"
            onClick={handlePrintAndConfirm}
            disabled={closing}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            {closing ? 'Cerrando...' : 'Confirmar cierre e imprimir'}
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ method: paymentMethod, label: paymentLabel, amount: ticket.totalAmount })}
            disabled={closing}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {closing ? 'Cerrando...' : 'Confirmar cierre'}
          </button>
        </div>
      </div>
    </div>
  );
}
