import { X, BellRing, ReceiptText, Clock3, UtensilsCrossed, Plus } from "lucide-react";
import { formatCurrency } from "../../utils/format";
import type { TableOrder } from "../WaiterModule";
import type { Table } from "../../types/table";
import { useRestaurantScope } from "../../contexts/RestaurantContext";
import { useState } from "react";
import WaiterOrderComposer from "./WaiterOrderComposer";

interface WaiterTableDetailProps {
  table: Table & { isAssignedToMe: boolean; position: { left: string; top: string } };
  orders: TableOrder[];
  tableCalls: Array<{ id: string; tableNumber: number; type: "waiter" | "bill"; status: string; createdAt?: Date }>;
  billRequests: Array<{ id: string; tableNumber: number; type: "waiter" | "bill"; status: string; createdAt?: Date }>;
  onClose: () => void;
  onOpenComposer: (tableNumber: number, tableId: string, accessToken?: string) => void;
}

export default function WaiterTableDetail({
  table,
  orders,
  tableCalls,
  billRequests,
  onClose,
  onOpenComposer,
}: WaiterTableDetailProps) {
  const { restaurantId } = useRestaurantScope();
  const [addingOrder, setAddingOrder] = useState(false);

  const tableOrders = orders.filter(
    (o) => o.tableNumber === table.number && o.status !== "cancelado" && o.paymentStatus !== "paid"
  );
  const openCalls = [...tableCalls, ...billRequests].filter(
    (c) => c.tableNumber === table.number && c.status !== "completed"
  );
  const total = tableOrders.reduce((sum, o) => sum + o.total, 0);
  const itemCount = tableOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);

  const statusLabel = table.status === "reservada" ? "Reservada" : table.status === "ocupada" ? "Ocupada" : "Livre";
  const statusIcons: Record<string, React.ReactNode> = {
    livre: <UtensilsCrossed size={18} />,
    ocupada: <UtensilsCrossed size={18} />,
    reservada: <Clock3 size={18} />,
  };

  async function requestBill() {
    // This would create a bill request - for now just alert
    alert("Funcionalidade de solicitar conta será implementada");
  }

  return (
    <div className="waiter-table-detail-overlay" onClick={onClose}>
      <div className="waiter-table-detail-modal" onClick={(e) => e.stopPropagation()}>
        <header className="detail-header">
          <div className="table-identity">
            <div className={`table-status-badge ${table.status}`}>
              {statusIcons[table.status] || <UtensilsCrossed size={18} />}
              <span>Mesa {table.number} · {statusLabel}</span>
            </div>
            {table.isAssignedToMe && <span className="my-table-badge">Sua mesa</span>}
          </div>
          <button type="button" className="detail-close" onClick={onClose} aria-label="Fechar"><X size={22} /></button>
        </header>

        <div className="detail-body">
          <div className="table-summary">
            <div className="summary-item">
              <span className="summary-label">Itens</span>
              <strong>{itemCount}</strong>
            </div>
            <div className="summary-item">
              <span className="summary-label">Total</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
            <div className="summary-item">
              <span className="summary-label">Chamados</span>
              <strong>{openCalls.length}</strong>
            </div>
            <div className="summary-item">
              <span className="summary-label">Pedidos prontos</span>
              <strong>{tableOrders.filter((o) => o.status === "pronto").length}</strong>
            </div>
          </div>

          {tableOrders.length > 0 && (
            <section className="detail-orders">
              <h3>Comanda</h3>
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

          {openCalls.length > 0 && (
            <section className="detail-calls">
              <h3>Chamados Abertos</h3>
              {openCalls.map((call) => (
                <div key={call.id} className={`call-item ${call.type}`}>
                  <span className="call-icon">{call.type === "bill" ? <ReceiptText size={16} /> : <BellRing size={16} />}</span>
                  <span className="call-type">{call.type === "bill" ? "Conta solicitada" : "Chamou garçom"}</span>
                  <span className="call-time">
                    {call.createdAt
                      ? call.createdAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
                      : "Agora"}
                  </span>
                </div>
              ))}
            </section>
          )}

          <div className="detail-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => { onOpenComposer(table.number, `${restaurantId}_${table.number}`, table.accessToken); onClose(); }}
            >
              <Plus size={18} /> Adicionar Pedido
            </button>
            {tableOrders.length > 0 && (
              <button type="button" className="secondary-button" onClick={requestBill}>
                <ReceiptText size={18} /> Solicitar Conta
              </button>
            )}
            <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
          </div>
        </div>

        {addingOrder && (
          <WaiterOrderComposer
            tableNumber={table.number}
            tableId={`${restaurantId}_${table.number}`}
            accessToken={table.accessToken}
            onClose={() => setAddingOrder(false)}
            onSuccess={() => setAddingOrder(false)}
          />
        )}
      </div>
    </div>
  );
}