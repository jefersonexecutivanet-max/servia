import { X, BellRing, ReceiptText, Clock3, UserRoundCheck, AlertTriangle, Check, Loader2, Send } from "lucide-react";
import type { ServiceRequest, TableOrder } from "../WaiterModule";
import { formatCurrency } from "../../utils/format";

interface WaiterCallDetailProps {
  request: ServiceRequest;
  orders: TableOrder[];
  onClose: () => void;
  onAdvance: (request: ServiceRequest) => void;
  updating?: boolean;
}

export default function WaiterCallDetail({
  request,
  orders,
  onClose,
  onAdvance,
  updating,
}: WaiterCallDetailProps) {
  const isBill = request.type === "bill";
  const tableOrders = orders.filter(
    (order) =>
      order.tableNumber === request.tableNumber &&
      order.status !== "cancelado" &&
      order.paymentStatus !== "paid"
  );
  const isCompleted = request.status === "completed";
  const isInProgress = request.status === "in_progress";

  return (
    <div className="waiter-call-detail-overlay" onClick={onClose}>
      <div className="waiter-call-detail-modal" onClick={(e) => e.stopPropagation()}>
        <header className="detail-header">
          <div>
            <h2>
              {isBill ? <ReceiptText size={20} /> : <BellRing size={20} />}
              {isBill ? "Solicitação de Conta" : "Chamado de Garçom"}
            </h2>
            <p className="detail-meta">Mesa {request.tableNumber}</p>
          </div>
          <button type="button" className="detail-close" onClick={onClose} aria-label="Fechar"><X size={22} /></button>
        </header>

        <div className="detail-body">
          <div className="detail-status">
            <div className={`status-badge ${request.status}`}>
              {isCompleted && <Check size={16} />}
              {isInProgress && <UserRoundCheck size={16} />}
              {!isCompleted && !isInProgress && <AlertTriangle size={16} />}
              <span>
                {isCompleted ? "Concluído" : isInProgress ? "Em atendimento" : "Aberto"}
              </span>
            </div>
            <div className="status-time">
              <Clock3 size={16} />
              {request.createdAt
                ? `Criado ${request.createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                : "Agora"}
            </div>
          </div>

          {request.attendedBy && (
            <div className="detail-attendant">
              <UserRoundCheck size={16} />
              <span>{isCompleted ? "Atendido por" : "Em atendimento por"} {request.attendedBy}</span>
            </div>
          )}

          {tableOrders.length > 0 && (
            <section className="detail-comanda">
              <h3>Comanda da Mesa</h3>
              {tableOrders.map((order) => (
                <div key={order.id} className="comanda-order">
                  <div className="comanda-order-header">
                    <span className={`order-status ${order.status}`}>{order.status}</span>
                    <strong>{formatCurrency(order.total)}</strong>
                  </div>
                  <ul className="comanda-items">
                    {order.items.map((item, index) => (
                      <li key={`${order.id}-${index}`}>
                        <span>{item.quantity}x {item.name}</span>
                        <span>{formatCurrency((item.price || 0) * item.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          <div className="detail-actions">
            {!isCompleted && (
              <button
                type="button"
                className="primary-button advance-action"
                onClick={() => onAdvance(request)}
                disabled={updating}
              >
                {updating ? <Loader2 className="spinning" size={18} /> : isInProgress ? <Check size={18} /> : <Send size={18} />}
                {isInProgress ? "Concluir Atendimento" : "Assumir Atendimento"}
              </button>
            )}
            {isCompleted && (
              <span className="completed-label">
                <Check size={16} /> Atendimento concluído por {request.attendedBy || "equipe"}
              </span>
            )}
            <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  );
}