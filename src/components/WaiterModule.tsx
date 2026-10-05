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
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
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
  paymentStatus: string;
  total: number;
  items: Array<{ name: string; quantity: number }>;
};

type AssignedTable = {
  id: string;
  tableNumber: number;
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
    paymentStatus: String(data.paymentStatus || "unpaid"),
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
  const [assignedTables, setAssignedTables] = useState<AssignedTable[]>([]);
  const [ordersAccessReady, setOrdersAccessReady] = useState(false);
  const seenRequestsRef = useRef(new Set<string>());
  const loadedRequestCollectionsRef = useRef(new Set<RequestCollection>());
  const readyOrderIdsRef = useRef(new Set<string>());
  const readyOrdersInitializedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [newAlert, setNewAlert] = useState("");

  // Função para tocar som de notificação
  async function enableAlerts() {
    try {
      const AudioContextConstructor = window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextConstructor) {
        audioContextRef.current ??= new AudioContextConstructor();
        await audioContextRef.current.resume();
      }
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      setAlertsEnabled(true);
    } catch (enableError) {
      console.error("Erro ao ativar alertas:", enableError);
      setAlertsEnabled(false);
    }
  }

  function playNotificationSound() {
    const audioContext = audioContextRef.current;
    if (!audioContext || audioContext.state !== "running") return;
    try {
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
  }

  function notifyNewRequest(request: ServiceRequest) {
    const title = request.type === "bill" ? "Pedido de conta" : "Chamado de garÃ§om";
    const body = `Mesa ${request.tableNumber} precisa de atendimento.`;
    setNewAlert(`${title}: ${body}`);
    window.setTimeout(() => setNewAlert(""), 8000);
    playNotificationSound();
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, tag: `${request.collectionName}-${request.id}` });
      } catch (notificationError) {
        console.error("Erro ao exibir notificaÃ§Ã£o:", notificationError);
      }
    }
  }

  function notifyReadyOrder(order: TableOrder) {
    const title = "Pedido pronto para levar";
    const body = `Mesa ${order.tableNumber} · ${order.items.map((item) => `${item.quantity}x ${item.name}`).join(", ")}`;
    setNewAlert(`${title}: ${body}`);
    window.setTimeout(() => setNewAlert(""), 8000);
    playNotificationSound();
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(title, { body, tag: `ready-order-${order.id}` });
      } catch (notificationError) {
        console.error("Erro ao exibir notificaÃ§Ã£o do pedido pronto:", notificationError);
      }
    }
  }

  useEffect(() => {
    if (!restaurantId || !waiterId) {
      setOrdersAccessReady(true);
      return;
    }

    let cancelled = false;
    setOrdersAccessReady(false);
    async function registerTeamAccess() {
      const waiterSnapshot = await getDoc(doc(db, "waiters", waiterId));
      const waiterData = waiterSnapshot.data();
      if (
        !waiterSnapshot.exists()
        || waiterData?.uid !== user.uid
        || waiterData?.restaurantId !== restaurantId
        || waiterData?.active !== true
      ) {
        throw new Error("A conta da equipe nÃ£o estÃ¡ ativa para este restaurante.");
      }
      await setDoc(doc(db, "restaurantStaff", user.uid), {
        restaurantId,
        waiterId,
        active: true,
      });
      if (!cancelled) setOrdersAccessReady(true);
    }

    void registerTeamAccess().catch((accessError) => {
      console.error("Erro ao validar acesso Ã s comandas:", accessError);
      if (!cancelled) {
        setError("NÃ£o foi possÃ­vel validar o acesso da equipe Ã s comandas.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, waiterId, user.uid]);

  useEffect(() => {
    if (!restaurantId || (waiterId && !ordersAccessReady)) {
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
        const firstSnapshot = !loadedRequestCollectionsRef.current.has("tableCalls");
        if (firstSnapshot) {
          snapshot.docs.forEach((item) => seenRequestsRef.current.add(`tableCalls/${item.id}`));
          loadedRequestCollectionsRef.current.add("tableCalls");
        } else {
          snapshot.docChanges().forEach((change) => {
            const requestKey = `tableCalls/${change.doc.id}`;
            if (change.type === "added" && !seenRequestsRef.current.has(requestKey)) {
              const request = convertRequest(change.doc, "tableCalls");
              if (request.status === "pending") notifyNewRequest(request);
            }
            seenRequestsRef.current.add(requestKey);
          });
        }
        setTableCalls(newCalls);
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
        const firstSnapshot = !loadedRequestCollectionsRef.current.has("billRequests");
        if (firstSnapshot) {
          snapshot.docs.forEach((item) => seenRequestsRef.current.add(`billRequests/${item.id}`));
          loadedRequestCollectionsRef.current.add("billRequests");
        } else {
          snapshot.docChanges().forEach((change) => {
            const requestKey = `billRequests/${change.doc.id}`;
            if (change.type === "added" && !seenRequestsRef.current.has(requestKey)) {
              const request = convertRequest(change.doc, "billRequests");
              if (request.status === "pending") notifyNewRequest(request);
            }
            seenRequestsRef.current.add(requestKey);
          });
        }
        setBillRequests(newBills);
        markLoaded("billRequests");
        setError("");
      },
      (snapshotError) => {
        console.error("Erro ao carregar pedidos de conta:", snapshotError);
        setError("Não foi possível carregar os chamados.");
        markLoaded("billRequests");
      },
    );

    const assignmentsQuery = waiterId
      ? query(
          collection(db, "waiterTables"),
          where("restaurantId", "==", restaurantId),
          where("waiterId", "==", waiterId),
        )
      : query(collection(db, "waiterTables"), where("restaurantId", "==", restaurantId));
    const unsubscribeAssignments = onSnapshot(
      assignmentsQuery,
      (snapshot) => {
        setAssignedTables(snapshot.docs.map((item) => ({
          id: item.id,
          tableNumber: Number(item.data().tableNumber || 0),
        })).sort((first, second) => first.tableNumber - second.tableNumber));
      },
      (snapshotError) => {
        console.error("Erro ao carregar mesas assumidas:", snapshotError);
        setError("NÃ£o foi possÃ­vel carregar as mesas assumidas.");
      },
    );

    const unsubscribeOrders = waiterId
      ? onSnapshot(
          query(
            collection(db, "orders"),
            where("restaurantId", "==", restaurantId),
          ),
          (snapshot) => {
            const newOrders = snapshot.docs.map(convertTableOrder);
            const currentReadyOrderIds = new Set(
              newOrders.filter((order) => order.status === "pronto").map((order) => order.id),
            );
            if (readyOrdersInitializedRef.current) {
              newOrders
                .filter((order) => order.status === "pronto" && !readyOrderIdsRef.current.has(order.id))
                .forEach(notifyReadyOrder);
            }
            readyOrderIdsRef.current = currentReadyOrderIds;
            readyOrdersInitializedRef.current = true;
            setOrders(newOrders);
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
      unsubscribeAssignments();
      unsubscribeOrders();
    };
  }, [restaurantId, waiterId, user.uid, ordersAccessReady]);

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
  const readyOrders = orders.filter((order) =>
    order.status === "pronto"
    && order.paymentStatus !== "paid"
    && assignedTables.some((table) => table.tableNumber === order.tableNumber),
  );

  async function markOrderDelivered(order: TableOrder) {
    if (updatingId) return;
    setUpdatingId(order.id);
    try {
      await updateDoc(doc(db, "orders", order.id), { status: "entregue" });
    } catch (deliveryError) {
      console.error("Erro ao marcar pedido como entregue:", deliveryError);
      setError("NÃ£o foi possÃ­vel atualizar o pedido. Tente novamente.");
    } finally {
      setUpdatingId("");
    }
  }

  async function advanceRequest(request: ServiceRequest) {
    const nextStatus =
      request.status === "pending" ? "in_progress" : "completed";
    const documentKey = `${request.collectionName}/${request.id}`;

    setUpdatingId(documentKey);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, request.collectionName, request.id), {
        status: nextStatus,
        attendedBy: user.displayName || user.email || "Equipe",
        ...(nextStatus === "completed"
          ? { completedAt: serverTimestamp() }
          : {}),
      });
      if (nextStatus === "in_progress") {
        batch.set(doc(db, "waiterTables", `${restaurantId}_${request.tableNumber}`), {
          restaurantId,
          tableId: `${restaurantId}_${request.tableNumber}`,
          tableNumber: request.tableNumber,
          waiterId,
          waiterName: request.waiterName || user.displayName || user.email || "Equipe",
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
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
        <div className="waiter-header-actions">
          <button className="waiter-alert-toggle" type="button" onClick={() => void enableAlerts()}>
            {alertsEnabled ? "Avisos ativados" : "Ativar avisos e som"}
          </button>
          <div className="waiter-live-indicator">
            <span /> Ao vivo
          </div>
        </div>
      </header>

      {newAlert && <div className="waiter-new-alert" role="alert">{newAlert}</div>}

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

      <section className="waiter-assigned-tables" aria-label="Mesas assumidas">
        <div className="waiter-assigned-tables-heading">
          <h2>Minhas mesas</h2>
          <span>{assignedTables.length} em atendimento</span>
        </div>
        {assignedTables.length === 0 ? (
          <p className="waiter-assigned-tables-empty">As mesas que vocÃª assumir aparecerÃ£o aqui atÃ© o fechamento da conta.</p>
        ) : (
          <div className="waiter-assigned-tables-grid">
            {assignedTables.map((table) => {
              const tableOrders = orders.filter((order) =>
                order.tableNumber === table.tableNumber
                && order.status !== "cancelado"
                && order.paymentStatus !== "paid",
              );
              return (
                <article className="waiter-assigned-table" key={table.id}>
                  <strong>Mesa {table.tableNumber}</strong>
                  {tableOrders.length === 0 ? (
                    <span>Nenhum pedido em aberto.</span>
                  ) : (
                    <>
                      <ul>
                        {tableOrders.flatMap((order) => order.items.map((item, index) => (
                          <li key={`${order.id}-${index}`}>{item.quantity}x {item.name}</li>
                        )))}
                      </ul>
                      <span>Total: {formatCurrency(tableOrders.reduce((sum, order) => sum + order.total, 0))}</span>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="waiter-ready-orders" aria-label="Pedidos prontos para levar">
        <div className="waiter-assigned-tables-heading">
          <h2>Prontos para levar</h2>
          <span>{readyOrders.length} pedidos</span>
        </div>
        {readyOrders.length === 0 ? (
          <p className="waiter-assigned-tables-empty">Os pedidos da cozinha aparecerÃ£o aqui quando estiverem prontos.</p>
        ) : (
          <div className="waiter-ready-order-list">
            {readyOrders.map((order) => (
              <article className="waiter-ready-order" key={order.id}>
                <div>
                  <strong>Mesa {order.tableNumber}</strong>
                  <span>{order.items.map((item) => `${item.quantity}x ${item.name}`).join(" · ")}</span>
                  <span>{formatCurrency(order.total)}</span>
                </div>
                <button
                  type="button"
                  disabled={Boolean(updatingId)}
                  onClick={() => void markOrderDelivered(order)}
                >
                  {updatingId === order.id ? <LoaderCircle className="waiter-loader" size={17} /> : <Check size={17} />}
                  Marcar como entregue
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

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
                    .filter((order) =>
                      order.tableNumber === request.tableNumber
                      && order.status !== "cancelado"
                      && order.paymentStatus !== "paid",
                    )
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
