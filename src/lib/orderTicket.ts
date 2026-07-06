export type PrintableOrderTicket = {
  orderId: string;
  customerName: string;
  deliveryAddress: string;
  totalAmount: number;
  items: Array<{ name: string; quantity: number; subtotal: number }>;
  tableLabel?: string;
  waiterName?: string;
  paymentLabel?: string;
  paymentAmount?: number;
  notes?: string | null;
};

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character,
  );
}

function ticketInfo(label: string, value?: string | null) {
  if (!value) return '';
  return `<div class="info"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`;
}

export function openOrderTicket(restaurantName: string, ticket: PrintableOrderTicket) {
  const ticketWindow = window.open('', '_blank', 'width=420,height=640');
  if (!ticketWindow) return false;

  const itemRows = ticket.items.map((item) =>
    `<tr><td><strong>${item.quantity} x</strong> ${escapeHtml(item.name)}</td><td>${escapeHtml(moneyFormatter.format(item.subtotal))}</td></tr>`,
  ).join('');

  ticketWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
    <title>Pedido #${escapeHtml(ticket.orderId.slice(0, 8))}</title><style>
    @page { margin: 8mm; } body { font-family: Arial, sans-serif; color: #111; margin: 0; }
    .ticket { max-width: 80mm; margin: 0 auto; } h1 { margin: 0 0 12px; text-align: center; font-size: 22px; }
    .order { border-block: 2px dashed #111; padding: 10px 0; font-size: 18px; }
    .info { margin: 10px 0; font-size: 15px; line-height: 1.4; } table { width: 100%; border-collapse: collapse; }
    td { border-top: 1px solid #bbb; padding: 10px 0; font-size: 15px; vertical-align: top; }
    td:last-child { text-align: right; white-space: nowrap; } .total { border-top: 2px solid #111; padding-top: 10px; text-align: right; font-size: 18px; }
    </style></head><body><main class="ticket"><h1>${escapeHtml(restaurantName)}</h1>
    <div class="order"><strong>Pedido #${escapeHtml(ticket.orderId.slice(0, 8))}</strong></div>
    ${ticketInfo('Cliente', ticket.customerName)}
    ${ticketInfo('Mesa', ticket.tableLabel)}
    ${ticketInfo('Mozo', ticket.waiterName)}
    ${ticketInfo('Entrega', ticket.deliveryAddress)}
    ${ticketInfo('Pago', ticket.paymentLabel)}
    ${ticket.paymentAmount !== undefined ? ticketInfo('Monto pago', moneyFormatter.format(ticket.paymentAmount)) : ''}
    ${ticketInfo('Notas', ticket.notes)}
    <table><tbody>${itemRows}</tbody></table>
    <p class="total"><strong>Total: ${escapeHtml(moneyFormatter.format(ticket.totalAmount))}</strong></p>
    </main><script>window.addEventListener('load', () => { window.print(); window.close(); });</script></body></html>`);
  ticketWindow.document.close();
  return true;
}
