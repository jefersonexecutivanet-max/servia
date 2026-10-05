import { useEffect, useMemo, useState, useRef, type ElementType } from "react";
import {
  BellRing,
  Check,
  CheckCheck,
  Clock3,
  LoaderCircle,
  ReceiptText,
  UserRoundCheck,
} from "lucide-react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "../firebase";
import { formatCurrency } from "../utils/format";
import { useRestaurantScope } from "../contexts/RestaurantContext";
import TableTurnoverModule from "./TableTurnoverModule";

type RequestKind = "waiter" | "bill";
type RequestCollection = "tableCalls" | "billRequests";
type RequestFilter = "open" | "completed";

type ServiceRequest = {
  id: string;
  collectionName: RequestCollection;
  type: RequestKind;
  tableNumber: number;
  status: string;
  createdAt?: Date;
  attendedBy?: string;
  waiterName?: string;
};

type TableOrder = {
  id: string;
  tableNumber: number;
  status: string;
  total: number;
  items: Array<{ name: string; quantity: number }>;
};

function convertRequest(
  snapshot: QueryDocumentSnapshot<DocumentData>,
  collectionName: RequestCollection,
): ServiceRequest {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    collectionName,
    type: collectionName === "billRequests" ? "bill" : "waiter",
    tableNumber: Number(data.tableNumber || 0),
    status: data.status || "pending",
    createdAt:
      data.createdAt?.toDate instanceof Function
        ? data.createdAt.toDate()
        : undefined,
    attendedBy: data.attendedBy || "",
    waiterName: data.waiterName || "",
  };
}

function convertTableOrder(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): TableOrder {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    tableNumber: Number(data.tableNumber || 0),
    status: String(data.status || "novo"),
    total: Number(data.total || 0),
    items: Array.isArray(data.items)
      ? data.items.map((item) => ({
          name: String(item.name || "Item"),
          quantity: Number(item.quantity || 0),
        }))
      : [],
  };
}

function formatRequestTime(date?: Date) {
  if (!date) {
    return "Agora";
  }

  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) {
    return "Agora";
  }
  if (minutes < 60) {
    return `há ${minutes} min`;
  }

  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function WaiterModule({
  user,
  waiterId = "",
  showTurnover = false,
}: {
  user: User;
  waiterId?: string;
  showTurnover?: boolean;
}) {
  const { restaurantId } = useRestaurantScope();
  const [tableCalls, setTableCalls] = useState<ServiceRequest[]>([]);
  const [billRequests, setBillRequests] = useState<ServiceRequest[]>([]);
  const [filter, setFilter] = useState<RequestFilter>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState("");
  const [orders, setOrders] = useState<TableOrder[]>([]);
  const previousCallCountRef = useRef(0);
  const previousBillCountRef = useRef(0);

  // Função para tocar som de notificação
  const playNotificationSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (error) {
      console.error("Erro ao tocar som:", error);
    }
  };

  useEffect(() => {
    if (!restaurantId) {
      return;
    }

    const pendingSources = new Set<RequestCollection>([
      "tableCalls",
      "billRequests",
    ]);

    function markLoaded(source: RequestCollection) {
      pendingSources.delete(source);
      if (pendingSources.size === 0) {
        setLoading(false);
      }
    }

    function requestsQuery(source: RequestCollection) {
      const sourceCollection = collection(db, source);
      return waiterId
        ? query(
            sourceCollection,
            where("restaurantId", "==", restaurantId),
            where("waiterId", "==", waiterId),
          )
        : query(sourceCollection, where("restaurantId", "==", restaurantId));
    }

    const unsubscribeCalls = onSnapshot(
      requestsQuery("tableCalls"),
      (snapshot) => {
        const newCalls = snapshot.docs.map((item) => convertRequest(item, "tableCalls"));
        const openCalls = newCalls.filter(c => c.status === "pending");
        
        // Tocar som se houver novos chamados
        if (openCalls.length > previousCallCountRef.current && previousCallCountRef.current > 0) {
          playNotificationSound();
        }
        
        setTableCalls(newCalls);
        previousCallCountRef.current = openCalls.length;
        markLoaded("tableCalls");
        setError("");
      },
      (snapshotError) => {
        console.error("Erro ao carregar chamados:", snapshotError);
        setError("Não foi possível carregar os chamados.");
        markLoaded("tableCalls");
      },
    );

    const unsubscribeBills = onSnapshot(
      requestsQuery("billRequests"),
      (snapshot) => {
        const newBills = snapshot.docs.map((item) => convertRequest(item, "billRequests"));
        const openBills = newBills.filter(b => b.status === "pending");
        
        // Tocar som se houver novos pedidos de conta
        if (openBills.length > previousBillCountRef.current && previousBillCountRef.current > 0) {
          playNotificationSound();
        }
        
        setBillRequests(newBills);
        previousBillCountRef.current = openBills.length;
        markLoaded("billRequests");
        setError("");
      },
      (snapshotError) => {
        console.error("Erro ao carregar pedidos de conta:", snapshotError);
        setError("Não foi possível carregar os chamados.");
        markLoaded("billRequests");
      },
    );

    const unsubscribeOrders = waiterId
      ? onSnapshot(
          query(
            collection(db, "orders"),
            where("restaurantId", "==", restaurantId),
            where("waiterId", "==", waiterId),
          ),
          (snapshot) => {
            setOrders(snapshot.docs.map(convertTableOrder));
          },
          (snapshotError) => {
            console.error("Erro ao carregar comandas:", snapshotError);
            setError("Não foi possível carregar as comandas das mesas.");
          },
        )
      : onSnapshot(
          query(collection(db, "orders"), where("restaurantId", "==", restaurantId)),
          (snapshot) => setOrders(snapshot.docs.map(convertTableOrder)),
          (snapshotError) => {
            console.error("Erro ao carregar comandas:", snapshotError);
            setError("Não foi possível carregar as comandas das mesas.");
          },
        );

    return () => {
      unsubscribeCalls();
      unsubscribeBills();
      unsubscribeOrders();
    };
  }, [restaurantId, waiterId, user.uid]);

  const requests = useMemo(
    () =>
      [...tableCalls, ...billRequests].sort(
        (first, second) =>
          (first.createdAt?.getTime() || 0) - (second.createdAt?.getTime() || 0),
      ),
    [tableCalls, billRequests],
  );

  const openCount = requests.filter(
    (request) => request.status !== "completed",
  ).length;
  const inProgressCount = requests.filter(
    (request) => request.status === "in_progress",
  ).length;
  const visibleRequests = requests.filter((request) =>
    filter === "open"
      ? request.status !== "completed"
      : request.status === "completed",
  );

  async function advanceRequest(request: ServiceRequest) {
    const nextStatus =
      request.status === "pending" ? "in_progress" : "completed";
    const documentKey = `${request.collectionName}/${request.id}`;

    setUpdatingId(documentKey);
    try {
      await updateDoc(doc(db, request.collectionName, request.id), {
        status: nextStatus,
        attendedBy: user.displayName || user.email || "Equipe",
        ...(nextStatus === "completed"
          ? { completedAt: serverTimestamp() }
          : {}),
      });
    } catch (updateError) {
      console.error("Erro ao atualizar chamado:", updateError);
      setError("Não foi possível atualizar este chamado. Tente novamente.");
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <section className="waiter-page" aria-live="polite">
      <header className="waiter-heading">
        <div>
          <span className="eyebrow">SALÃO · EM TEMPO REAL</span>
          <h1>Atendimento</h1>
          <p>Chamados e pedidos de conta das mesas.</p>
        </div>
        <div className="waiter-live-indicator">
          <span /> Ao vivo
        </div>
      </header>

      <div className="waiter-stats">
        <div className="waiter-stat waiter-stat-open">
          <BellRing size={19} />
          <strong>{openCount}</strong>
          <span>Em aberto</span>
        </div>
        <div className="waiter-stat waiter-stat-progress">
          <UserRoundCheck size={19} />
          <strong>{inProgressCount}</strong>
          <span>Em atendimento</span>
        </div>
      </div>

      {showTurnover && (
        <section className="waiter-turnover-panel">
          <h2>Mesas, ocupação e fechamento</h2>
          <TableTurnoverModule embedded />
        </section>
      )}

      <div className="waiter-toolbar">
        <div className="waiter-tabs" role="tablist" aria-label="Fila de atendimento">
          <button
            className={filter === "open" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={filter === "open"}
            onClick={() => setFilter("open")}
          >
            Abertos <span>{openCount}</span>
          </button>
          <button
            className={filter === "completed" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={filter === "completed"}
            onClick={() => setFilter("completed")}
          >
            Concluídos
          </button>
        </div>
        <span className="waiter-queue-note">
          {filter === "open" ? "Mais antigo primeiro" : "Histórico recente"}
        </span>
      </div>

      {error && <div className="waiter-error" role="alert">{error}</div>}

      {loading ? (
        <div className="waiter-empty">
          <LoaderCircle className="waiter-loader" size={24} />
          <strong>Carregando chamados</strong>
        </div>
      ) : visibleRequests.length === 0 ? (
        <div className="waiter-empty">
          <CheckCheck size={27} />
          <strong>
            {filter === "open" ? "Tudo em dia" : "Nenhum atendimento concluído"}
          </strong>
          <span>
            {filter === "open"
              ? "Novos chamados das mesas aparecerão aqui."
              : "Os atendimentos concluídos aparecerão aqui."}
          </span>
        </div>
      ) : (
        <div className="waiter-request-list">
          {visibleRequests.map((request) => {
            const isBill = request.type === "bill";
            const documentKey = `${request.collectionName}/${request.id}`;
            const Icon: ElementType = isBill ? ReceiptText : BellRing;
            const isCompleted = request.status === "completed";
            const isInProgress = request.status === "in_progress";

            return (
              <article
                className={`waiter-request ${isBill ? "bill" : "call"} ${isCompleted ? "completed" : ""}`}
                key={documentKey}
              >
                <div className="waiter-request-icon">
                  <Icon size={22} />
                </div>
                <div className="waiter-request-content">
                  <div className="waiter-request-title">
                    <span>{isBill ? "Solicitou a conta" : "Chamou o garçom"}</span>
                    <span className="waiter-request-time">
                      <Clock3 size={14} /> {formatRequestTime(request.createdAt)}
                    </span>
                  </div>
                  <strong className="waiter-table-number">
                    Mesa {request.tableNumber}
                  </strong>
                  {isInProgress && request.attendedBy && (
                    <span className="waiter-attendant">
                      Em atendimento por {request.attendedBy}
                    </span>
                  )}
                  {isCompleted && request.attendedBy && (
                    <span className="waiter-attendant">
                      Atendido por {request.attendedBy}
                    </span>
                  )}
                  {orders
                    .filter((order) => order.tableNumber === request.tableNumber)
                    .map((order) => (
                      <div className="waiter-command" key={order.id}>
                        <div>
                          <strong>Comanda · {order.status}</strong>
                          <span>{formatCurrency(order.total)}</span>
                        </div>
                        <p>
                          {order.items
                            .map((item) => `${item.quantity}x ${item.name}`)
                            .join(" · ")}
                        </p>
                      </div>
                    ))}
                </div>
                <button
                  className={`waiter-action ${isCompleted ? "done" : ""}`}
                  type="button"
                  disabled={Boolean(updatingId) || isCompleted}
                  onClick={() => void advanceRequest(request)}
                >
                  {updatingId === documentKey ? (
                    <LoaderCircle className="waiter-loader" size={17} />
                  ) : isCompleted ? (
                    <Check size={17} />
                  ) : isInProgress ? (
                    <Check size={17} />
                  ) : (
                    <UserRoundCheck size={17} />
                  )}
                  <span>
                    {isCompleted
                      ? "Concluído"
                      : isInProgress
                        ? "Concluir"
                        : "Assumir"}
                  </span>
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
