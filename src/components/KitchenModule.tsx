import { useEffect, useMemo, useState, useRef } from "react";
import {
  Printer,
  Clock3,
  ChefHat,
  PackageCheck,
  RefreshCw,
  UtensilsCrossed,
  CheckCircle2,
  Info,
} from "lucide-react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";
import { formatCurrency } from "../utils/format";
import { generatePrintContent, printContent as printToPrinter, shouldAutoPrintOrders, getRestaurantPrinterSettings } from "../utils/printer";
import type { Order, OrderStatus } from "../types/order";
import { useRestaurantScope } from "../contexts/RestaurantContext";

type Filter = "todos" | OrderStatus;

function formatTime(date?: Date) {
  if (!date) {
    return "--:--";
  }

  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: OrderStatus) {
  switch (status) {
    case "novo":
      return "Novo";

    case "preparando":
      return "Preparando";

    case "pronto":
      return "Pronto";

    case "entregue":
      return "Entregue";

    case "cancelado":
      return "Cancelado";

    default:
      return status;
  }
}

function statusClass(status: OrderStatus) {
  switch (status) {
    case "novo":
      return "new";

    case "preparando":
      return "preparing";

    case "pronto":
      return "ready";

    case "entregue":
      return "delivered";

    case "cancelado":
      return "cancelled";

    default:
      return "";
  }
}

function convertOrder(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): Order {
  const data = snapshot.data();

  const createdAt =
    data.createdAt?.toDate instanceof Function
      ? data.createdAt.toDate()
      : undefined;

  return {
    id: snapshot.id,
    tableNumber: Number(data.tableNumber || 0),
    status: (data.status || "novo") as OrderStatus,
    source: data.source,
    items: Array.isArray(data.items)
      ? data.items
      : [],
    total: Number(data.total || 0),
    createdAt,
  };
}

async function printOrder(order: Order) {
  const settings = getRestaurantPrinterSettings();
  const htmlContent = generatePrintContent(
    "COMANDA",
    order.id.slice(0, 8).toUpperCase(),
    order.tableNumber,
    order.items,
    order.total,
    {
      "Status": statusLabel(order.status),
      "Origem": order.source === "qrcode" ? "QR Code" : "Manual",
      "Horário": formatTime(order.createdAt),
    },
    settings.paperWidth,
  );
  await printToPrinter(htmlContent, settings);
}

export default function KitchenModule() {
  const { restaurantId } = useRestaurantScope();
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const printedOrdersRef = useRef<Set<string>>(new Set());

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

        // Auto-print new orders if enabled
        if (shouldAutoPrintOrders()) {
          nextOrders.forEach((order) => {
            if (order.status === "novo" && !printedOrdersRef.current.has(order.id)) {
              printedOrdersRef.current.add(order.id);
              void printOrder(order);
            }
          });
        }
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

  const totalSales = orders
    .filter((order) => order.status !== "cancelado")
    .reduce((sum, order) => sum + order.total, 0);

  function reloadOrders() {
    window.location.reload();
  }

  async function markAsPreparing(order: Order) {
    if (updatingId) return;

    setUpdatingId(order.id);

    try {
      await updateDoc(doc(db, "orders", order.id), {
        status: "preparando",
      });
    } catch (updateError) {
      console.error("Erro ao atualizar pedido:", updateError);
      window.alert("Não foi possível atualizar o status do pedido.");
    } finally {
      setUpdatingId("");
    }
  }

  async function markAsReady(order: Order) {
    if (updatingId) return;

    setUpdatingId(order.id);

    try {
      await updateDoc(doc(db, "orders", order.id), {
        status: "pronto",
      });
    } catch (updateError) {
      console.error("Erro ao atualizar pedido:", updateError);
      window.alert("Não foi possível atualizar o status do pedido.");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <div className="kitchen-page">
      <div className="module-header">
        <div>
          <div className="eyebrow">OPERAÇÃO</div>

          <h1>Cozinha</h1>

          <p>
            Receba comandas, imprima tickets e acompanhe o preparo dos pedidos.
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

      {shouldAutoPrintOrders() && (
        <div className="kitchen-print-info">
          <Info size={16} />
          <span>Impressão automática ativada: novos pedidos serão impressos automaticamente.</span>
        </div>
      )}

      <div className="orders-summary">
        <div className="orders-summary-card">
          <div className="orders-summary-icon new">
            <Clock3 size={20} />
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
            <strong>{formatCurrency(totalSales)}</strong>
            <span>Total vendido</span>
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
        <div className="orders-list kitchen-orders">
          {filteredOrders.map((order) => (
            <article
              className="order-card kitchen-order-card"
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

              <div className="kitchen-order-actions">
                <button
                  className="print-button"
                  type="button"
                  onClick={() => printOrder(order)}
                  title="Imprimir comanda"
                >
                  <Printer size={18} />
                  Imprimir
                </button>

                {order.status === "novo" && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={updatingId === order.id}
                    onClick={() => {
                      void markAsPreparing(order);
                    }}
                  >
                    <ChefHat size={18} />
                    Iniciar preparo
                  </button>
                )}

                {order.status === "preparando" && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={updatingId === order.id}
                    onClick={() => {
                      void markAsReady(order);
                    }}
                  >
                    <PackageCheck size={18} />
                    Marcar como pronto
                  </button>
                )}

                {order.status === "pronto" && (
                  <button
                    className="success-button"
                    type="button"
                    disabled
                  >
                    <CheckCircle2 size={18} />
                    Pronto para entrega
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
