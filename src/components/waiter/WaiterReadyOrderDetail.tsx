import { X, Clock3, CheckCircle2, Loader2 } from "lucide-react";
import { formatCurrency } from "../../utils/format";
import type { TableOrder } from "../WaiterModule";

interface WaiterReadyOrderDetailProps {
  order: TableOrder;
  onClose: () => void;
  onMarkDelivered: (order: TableOrder) => void;
  delivering?: boolean;
  now: number;
}

export default function WaiterReadyOrderDetail({
  order,
  onClose,
  onMarkDelivered,
  delivering,
  now,
}: WaiterReadyOrderDetailProps) {
  const timeReady = order.paidAt || order.createdAt;
  const elapsed = timeReady ? Math.max(0, Math.floor((now - timeReady.getTime()) / 60000)) : 0;
  const elapsedText = elapsed < 1 ? "Agora" : elapsed < 60 ? `${elapsed} min` : `${Math.floor(elapsed / 60)}h ${elapsed % 60}min`;

  return (
    <div className="waiter-ready-order-detail-overlay" onClick={onClose}>
      <div className="waiter-ready-order-detail-modal" onClick={(e) => e.stopPropagation()}>
        <header className="detail-header">
          <div>
            <h2>Pedido Pronto · Mesa {order.tableNumber}</h2>
            <p className="detail-meta">
              <span>Pedido: {order.id.slice(0, 8).toUpperCase()}</span>
            </p>
          </div>
          <button type="button" className="detail-close" onClick={onClose} aria-label="Fechar"><X size={22} /></button>
        </header>

        <div className="detail-body">
          <div className="detail-status">
            <div className="status-badge ready">
              <CheckCircle2 size={16} /> Pronto para entrega
            </div>
            <div className="status-time">
              <Clock3 size={16} /> Pronto há {elapsedText}
            </div>
          </div>

          <ul className="detail-items">
            {order.items.map((item, index) => (
              <li key={`${order.id}-${index}`} className="detail-item">
                <div className="item-left">
                  <span className="item-qty">{item.quantity}x</span>
                  <span className="item-name">{item.name}</span>
                  {item.extras && item.extras.length > 0 && (
                    <span className="item-extras">+ {item.extras.join(", ")}</span>
                  )}
                  {item.notes && <span className="item-notes">"{item.notes}"</span>}
                </div>
                <strong className="item-total">{formatCurrency((item.price || 0) * item.quantity)}</strong>
              </li>
            ))}
          </ul>

          <div className="detail-total">
            <span>Total</span>
            <strong>{formatCurrency(order.total)}</strong>
          </div>

          <div className="detail-actions">
            <button
              type="button"
              className="primary-button mark-delivered"
              onClick={() => onMarkDelivered(order)}
              disabled={delivering}
            >
              {delivering ? <Loader2 className="spinning" size={18} /> : <CheckCircle2 size={18} />}
              {delivering ? "Entregando..." : "Marcar como Entregue"}
            </button>
            <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}