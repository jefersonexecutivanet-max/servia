import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  ChefHat,
  ClipboardList,
  PackageCheck,
  RefreshCw,
  UtensilsCrossed,
} from "lucide-react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import { formatCurrency } from "../utils/format";
import type { Order, OrderStatus } from "../types/order";
import { convertOrder, formatTime, statusClass, statusLabel } from "../utils/orders";
import { useRestaurantScope } from "../contexts/RestaurantContext";

type Filter = "todos" | OrderStatus;

function getNextStatus(
  status: OrderStatus,
): OrderStatus | null {
  switch (status) {
    case "novo":
      return "preparando";

    case "preparando":
      return "pronto";

    case "pronto":
      return "entregue";

    default:
      return null;
  }
}

function nextStatusLabel(status: OrderStatus) {
  switch (status) {
    case "novo":
      return "Iniciar preparo";

    case "preparando":
      return "Marcar como pronto";

    case "pronto":
      return "Entregar pedido";

    default:
      return "";
  }
}

export default function OrdersModule() {
  const { restaurantId } = useRestaurantScope();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");

  useEffect(() => {
    if (!restaurantId) {
      return;
    }

    const ordersQuery = query(
      collection(db, "orders"),
      where("restaurantId", "==", restaurantId),
    );

    const unsubscribe = onSnapshot(
      ordersQuery,
      (snapshot) => {
        const nextOrders = snapshot.docs
          .map(convertOrder)
          .sort((first, second) => (second.createdAt?.getTime() || 0) - (first.createdAt?.getTime() || 0));

        setOrders(nextOrders);
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        console.error(
          "Erro ao carregar pedidos:",
          snapshotError,
        );

        setLoading(false);
        setError(
          "Não foi possível carregar os pedidos.",
        );
      },
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const filteredOrders = useMemo(() => {
    if (filter === "todos") {
      return orders;
    }

    return orders.filter(
      (order) => order.status === filter,
    );
  }, [orders, filter]);

  const newOrders = orders.filter(
    (order) => order.status === "novo",
  ).length;

  const preparingOrders = orders.filter(
    (order) => order.status === "preparando",
  ).length;

  const readyOrders = orders.filter(
    (order) => order.status === "pronto",
  ).length;

  const totalOrders = orders.length;

  function reloadOrders() {
    window.location.reload();
  }

  async function advanceStatus(order: Order) {
    const nextStatus = getNextStatus(order.status);

    if (!nextStatus || updatingId) {
      return;
    }

    setUpdatingId(order.id);

    try {
      await updateDoc(doc(db, "orders", order.id), {
        status: nextStatus,
      });
    } catch (updateError) {
      console.error("Erro ao atualizar pedido:", updateError);
      window.alert("Não foi possível atualizar o status do pedido.");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <div className="orders-page">
      <div className="module-header">
        <div>
          <div className="eyebrow">OPERAÇÃO</div>

          <h1>Pedidos</h1>

          <p>
            Acompanhe pedidos e comandas em tempo real.
          </p>
        </div>

        <div className="module-header-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={reloadOrders}
          >
            <RefreshCw size={18} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="orders-summary">
        <div className="orders-summary-card">
          <div className="orders-summary-icon new">
            <ClipboardList size={20} />
          </div>

          <div>
            <strong>{newOrders}</strong>
            <span>Novos</span>
          </div>
        </div>

        <div className="orders-summary-card">
          <div className="orders-summary-icon preparing">
            <ChefHat size={20} />
          </div>

          <div>
            <strong>{preparingOrders}</strong>
            <span>Preparando</span>
          </div>
        </div>

        <div className="orders-summary-card">
          <div className="orders-summary-icon ready">
            <PackageCheck size={20} />
          </div>

          <div>
            <strong>{readyOrders}</strong>
            <span>Prontos</span>
          </div>
        </div>

        <div className="orders-summary-card">
          <div className="orders-summary-icon revenue">
            <CheckCircle2 size={20} />
          </div>

          <div>
            <strong>{totalOrders}</strong>
            <span>Pedidos</span>
          </div>
        </div>
      </div>

      <div className="orders-toolbar">
        <div className="orders-filters">
          {(
            [
              ["todos", "Todos"],
              ["novo", "Novos"],
              ["preparando", "Preparando"],
              ["pronto", "Prontos"],
              ["entregue", "Entregues"],
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={
                filter === value ? "active" : ""
              }
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="orders-error">
          <span>{error}</span>

          <button
            type="button"
            onClick={reloadOrders}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {loading ? (
        <div className="orders-empty">
          <div className="orders-empty-icon">
            <RefreshCw size={28} />
          </div>

          <h3>Carregando pedidos</h3>

          <p>
            Buscando os pedidos registrados no Servia.
          </p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="orders-empty">
          <div className="orders-empty-icon">
            <UtensilsCrossed size={28} />
          </div>

          <h3>Nenhum pedido encontrado</h3>

          <p>
            Quando um cliente fizer um pedido pelo QR Code,
            ele aparecerá aqui automaticamente.
          </p>
        </div>
      ) : (
        <div className="orders-list">
          {filteredOrders.map((order) => {
            const nextStatus = getNextStatus(order.status);

            return (
              <article
                className="order-card"
                key={order.id}
              >
                <div className="order-card-top">
                  <div className="order-card-id">
                    <strong>
                      #{order.id.slice(0, 6).toUpperCase()}
                    </strong>

                    <span>
                      <Clock3 size={14} />
                      {formatTime(order.createdAt)}
                    </span>
                  </div>

                  <div
                    className={`order-status ${statusClass(
                      order.status,
                    )}`}
                  >
                    {statusLabel(order.status)}
                  </div>
                </div>

                <div className="order-card-info">
                  <div>
                    <span>MESA</span>
                    <strong>
                      {order.tableNumber}
                    </strong>
                  </div>

                  <div>
                    <span>ITENS</span>
                    <strong>
                      {order.items.reduce(
                        (sum, item) =>
                          sum + item.quantity,
                        0,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>TOTAL</span>
                    <strong>
                      {formatCurrency(order.total)}
                    </strong>
                  </div>
                </div>

                <div className="order-card-items">
                  {order.items.map((item, index) => (
                    <div
                      className="order-card-item"
                      key={`${order.id}-${item.productId}-${index}`}
                    >
                      <div>
                        <strong>
                          {item.quantity}x {item.name}
                        </strong>

                        <span>
                          {formatCurrency(item.price)}
                          {item.extras?.length
                            ? ` · ${item.extras.join(", ")}`
                            : ""}
                          {item.notes ? ` · ${item.notes}` : ""}
                        </span>
                      </div>

                      <strong>
                        {formatCurrency(
                          item.price * item.quantity,
                        )}
                      </strong>
                    </div>
                  ))}
                </div>

                {nextStatus && (
                  <div className="order-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      disabled={updatingId === order.id}
                      onClick={() => {
                        void advanceStatus(order);
                      }}
                    >
                      {nextStatus === "preparando" && (
                        <ChefHat size={18} />
                      )}

                      {nextStatus === "pronto" && (
                        <PackageCheck size={18} />
                      )}

                      {nextStatus === "entregue" && (
                        <CheckCircle2 size={18} />
                      )}

                      {nextStatusLabel(order.status)}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
