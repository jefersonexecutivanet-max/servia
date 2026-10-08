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
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "../firebase";
import type { Table, TableStatus } from "../types/table";
import { formatCurrency } from "../utils/format";
import { calculateOrderTotal } from "../utils/orders";
import { paymentApi } from "../utils/employeeApi";
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
  tableId: string;
  tableNumber: number;
  status: string;
  paymentStatus: string;
  total: number;
  items: Array<{ name: string; quantity: number }>;
  createdAt?: Date;
};

type AssignedTable = {
  id: string;
  tableNumber: number;
};

const waiterMapPositions = [
  { left: "10%", top: "23%" },
  { left: "38%", top: "20%" },
  { left: "68%", top: "22%" },
  { left: "13%", top: "57%" },
  { left: "42%", top: "52%" },
  { left: "72%", top: "55%" },
  { left: "26%", top: "78%" },
  { left: "61%", top: "79%" },
];

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
    tableId: String(data.tableId || ""),
    tableNumber: Number(data.tableNumber || 0),
    status: String(data.status || "novo"),
    paymentStatus: String(data.paymentStatus || "unpaid"),
    total: calculateOrderTotal(Array.isArray(data.items) ? data.items : []),
    items: Array.isArray(data.items)
      ? data.items.map((item) => ({
          name: String(item.name || "Item"),
          quantity: Number(item.quantity || 0),
        }))
      : [],
    createdAt: data.createdAt?.toDate instanceof Function ? data.createdAt.toDate() : undefined,
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
  const [waiterOrders, setWaiterOrders] = useState<TableOrder[]>([]);
  const [assignedOrders, setAssignedOrders] = useState<TableOrder[]>([]);
  const [assignedTables, setAssignedTables] = useState<AssignedTable[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [ordersAccessReady, setOrdersAccessReady] = useState(false);
  const seenRequestsRef = useRef(new Set<string>());
  const loadedRequestCollectionsRef = useRef(new Set<RequestCollection>());
  const readyOrderIdsRef = useRef(new Set<string>());
  const readyOrdersInitializedRef = useRef(false);
  const orderIdsRef = useRef(new Set<string>());
  const orderFeedInitializedRef = useRef(false);
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
    const title = request.type === "bill" ? "Pedido de conta" : "Chamado de garçom";
    const body = `Mesa ${request.tableNumber} precisa de atendimento.`;
    setNewAlert(`${title}: ${body}`);
    window.setTimeout(() => setNewAlert(""), 8000);
    playNotificationSound();
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const notificationOptions = { body, tag: `${request.collectionName}-${request.id}` };
        if (document.hidden && "serviceWorker" in navigator) {
          void navigator.serviceWorker.ready.then((registration) => registration.showNotification(title, notificationOptions));
        } else {
          new Notification(title, notificationOptions);
        }
      } catch (notificationError) {
        console.error("Erro ao exibir notificação:", notificationError);
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
        const notificationOptions = { body, tag: `ready-order-${order.id}` };
        if (document.hidden && "serviceWorker" in navigator) {
          void navigator.serviceWorker.ready.then((registration) => registration.showNotification(title, notificationOptions));
        } else {
          new Notification(title, notificationOptions);
        }
      } catch (notificationError) {
        console.error("Erro ao exibir notificação do pedido pronto:", notificationError);
      }
    }
  }

  function notifyNewOrder(order: TableOrder) {
    const title = `Novo pedido · Mesa ${order.tableNumber}`;
    const body = order.items.map((item) => `${item.quantity}x ${item.name}`).join(", ") || "A comanda foi atualizada.";
    setNewAlert(`${title}: ${body}`);
    window.setTimeout(() => setNewAlert(""), 8000);
    playNotificationSound();
    if ("Notification" in window && Notification.permission === "granted") {
      const options = { body, tag: `new-order-${order.id}` };
      if (document.hidden && "serviceWorker" in navigator) {
        void navigator.serviceWorker.ready.then((registration) => registration.showNotification(title, options));
      } else {
        new Notification(title, options);
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
        throw new Error("A conta da equipe não está ativa para este restaurante.");
      }
      await setDoc(doc(db, "restaurantStaff", user.uid), {
        restaurantId,
        waiterId,
        role: waiterData.role || "WAITER",
        active: true,
      });
      if (!cancelled) setOrdersAccessReady(true);
    }

    void registerTeamAccess().catch((accessError) => {
      console.error("Erro ao validar acesso às comandas:", accessError);
      if (!cancelled) {
        setError("Não foi possível validar o acesso da equipe às comandas.");
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
          snapshot.docs.forEach((item) => {
            seenRequestsRef.current.add(`tableCalls/${item.id}`);
            const request = convertRequest(item, "tableCalls");
            if (request.status === "pending") notifyNewRequest(request);
          });
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
          snapshot.docs.forEach((item) => {
            seenRequestsRef.current.add(`billRequests/${item.id}`);
            const request = convertRequest(item, "billRequests");
            if (request.status === "pending") notifyNewRequest(request);
          });
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
        setError("Não foi possível carregar as mesas assumidas.");
      },
    );

    const unsubscribeTables = onSnapshot(
      query(collection(db, "tables"), where("restaurantId", "==", restaurantId)),
      (snapshot) => {
        setTables(snapshot.docs.map((item) => item.data() as Table)
          .sort((first, second) => first.number - second.number));
      },
      (snapshotError) => {
        console.error("Erro ao carregar o mapa de mesas:", snapshotError);
        setError("Não foi possível carregar o mapa de mesas.");
      },
    );

  const unsubscribeOrders = waiterId
      ? onSnapshot(
          query(
            collection(db, "orders"),
            where("restaurantId", "==", restaurantId),
            where("waiterId", "==", waiterId),
            where("createdAt", ">=", Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000)),
            orderBy("createdAt", "desc"),
            limit(200),
          ),
          (snapshot) => {
            const newOrders = snapshot.docs.map(convertTableOrder);
            const currentOrderIds = new Set(newOrders.map((order) => order.id));
            const incomingOrders = orderFeedInitializedRef.current
              ? snapshot.docChanges().filter((change) => change.type === "added").map((change) => convertTableOrder(change.doc))
              : newOrders.filter((order) => order.status === "novo" && order.createdAt && Date.now() - order.createdAt.getTime() < 10 * 60 * 1000);
            incomingOrders.filter((order) => order.status === "novo").forEach(notifyNewOrder);
            orderIdsRef.current = currentOrderIds;
            orderFeedInitializedRef.current = true;
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
            setWaiterOrders(newOrders);
          },
          (snapshotError) => {
            console.error("Erro ao carregar comandas:", snapshotError);
            setError("Não foi possível carregar as comandas das mesas.");
          },
        )
      : onSnapshot(
          query(collection(db, "orders"), where("restaurantId", "==", restaurantId)),
          (snapshot) => setWaiterOrders(snapshot.docs.map(convertTableOrder)),
          (snapshotError) => {
            console.error("Erro ao carregar comandas:", snapshotError);
            setError("Não foi possível carregar as comandas das mesas.");
          },
        );

    return () => {
      unsubscribeCalls();
      unsubscribeBills();
      unsubscribeAssignments();
      unsubscribeTables();
      unsubscribeOrders();
    };
  }, [restaurantId, waiterId, user.uid, ordersAccessReady]);

  useEffect(() => {
    setAssignedOrders([]);
    if (!restaurantId || assignedTables.length === 0) return;

    const tableOrders = new Map<string, TableOrder[]>();
    const unsubscribers = assignedTables.map((table) => onSnapshot(
      query(
        collection(db, "orders"),
        where("restaurantId", "==", restaurantId),
        where("tableId", "==", table.id),
      ),
      (snapshot) => {
        tableOrders.set(table.id, snapshot.docs.map(convertTableOrder));
        setAssignedOrders(Array.from(tableOrders.values()).flat());
      },
      (snapshotError) => {
        console.error("Erro ao carregar os pedidos da mesa atribuída:", snapshotError);
        setError("Não foi possível carregar os pedidos desta mesa.");
      },
    ));

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [assignedTables, restaurantId]);

  const orders = useMemo(() => {
    const uniqueOrders = new Map<string, TableOrder>();
    [...waiterOrders, ...assignedOrders].forEach((order) => uniqueOrders.set(order.id, order));
    return Array.from(uniqueOrders.values());
  }, [assignedOrders, waiterOrders]);

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
  useEffect(() => {
    if (!alertsEnabled || openCount === 0) return;
    const soundInterval = window.setInterval(playNotificationSound, 5000);
    return () => window.clearInterval(soundInterval);
  }, [alertsEnabled, openCount]);
  const escalationMinutes = Math.max(1, Number(import.meta.env.VITE_CALL_ESCALATION_MINUTES) || 3);
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
  const waiterMapTables = tables.map((table, index) => {
    const hasOpenOrders = orders.some((order) =>
      order.tableNumber === table.number
      && order.status !== "cancelado"
      && order.paymentStatus !== "paid",
    );
    const status: TableStatus = table.status === "reservada"
      ? "reservada"
      : hasOpenOrders ? "ocupada" : table.status;
    const isAssignedToMe = assignedTables.some((assigned) => assigned.tableNumber === table.number);
    const fallbackPosition = waiterMapPositions[index]
      ?? { left: `${12 + (index % 4) * 25}%`, top: `${20 + Math.floor(index / 4) * 25}%` };
    const position = table.x !== undefined && table.y !== undefined
      ? { left: `${table.x}%`, top: `${table.y}%` }
      : fallbackPosition;
    return { ...table, status, isAssignedToMe, position };
  });

  async function markOrderDelivered(order: TableOrder) {
    if (updatingId) return;
    setUpdatingId(order.id);
    try {
      await updateDoc(doc(db, "orders", order.id), { status: "entregue" });
    } catch (deliveryError) {
      console.error("Erro ao marcar pedido como entregue:", deliveryError);
      setError("Não foi possível atualizar o pedido. Tente novamente.");
    } finally {
      setUpdatingId("");
    }
  }

  async function closeAssignedTable(tableNumber: number) {
    const tableOrders = orders.filter((order) =>
      order.tableNumber === tableNumber
      && order.status !== "cancelado"
      && order.paymentStatus !== "paid",
    );
    const subtotal = tableOrders.reduce((sum, order) => sum + order.total, 0);
    const confirmation = subtotal > 0
      ? `Fechar a conta da mesa ${tableNumber}? Subtotal: ${formatCurrency(subtotal)}.`
      : `Fechar a conta da mesa ${tableNumber}? O total será calculado com base nos pedidos em aberto.`;
    if (!window.confirm(confirmation)) return;
    const paymentMethod = window.prompt("Informe a forma de pagamento: pix, card ou cash", "pix")?.trim().toLowerCase();
    if (!paymentMethod || !["pix", "card", "cash"].includes(paymentMethod)) {
      setError("Forma de pagamento inválida. Use pix, card ou cash.");
      return;
    }

    const closingId = `close-${tableNumber}`;
    setUpdatingId(closingId);
    setError("");
    try {
      const result = await paymentApi<{ amount?: number }>("close", { restaurantId, tableNumber, paymentMethod });
      const paidAmount = Number(result?.amount);
      window.alert(paidAmount > 0
        ? `Conta da mesa ${tableNumber} fechada. Total recebido: ${formatCurrency(paidAmount)}.`
        : `Conta da mesa ${tableNumber} fechada.`);
    } catch (closeError) {
      console.error("Erro ao fechar conta da mesa:", closeError);
      setError(closeError instanceof Error ? closeError.message : "Não foi possível fechar a conta da mesa.");
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
          <span className="eyebrow">SAL�O � EM TEMPO REAL</span>
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

      <section className="waiter-floor-map-panel" aria-label="Mapa de mesas do salão">
        <div className="waiter-assigned-tables-heading">
          <h2>Mapa do salão</h2>
          <span>{waiterMapTables.filter((table) => table.isAssignedToMe).length} mesas suas</span>
        </div>
        {waiterMapTables.length === 0 ? (
          <p className="waiter-assigned-tables-empty">As mesas cadastradas aparecerão aqui.</p>
        ) : (
          <>
            <div className="waiter-floor-map">
              <span className="waiter-floor-entrance">ENTRADA / SALÃƒO</span>
              {waiterMapTables.map((table) => {
                const statusLabel = table.status === "reservada"
                  ? "Reservada"
                  : table.status === "ocupada" ? "Ocupada" : "Livre";
                return (
                  <div
                    className={`waiter-map-table waiter-map-${table.status} ${table.isAssignedToMe ? "assigned-to-me" : ""}`}
                    key={table.number}
                    style={table.position}
                    title={`Mesa ${table.number} · ${table.isAssignedToMe ? "Em seu atendimento" : statusLabel}`}
                    aria-label={`Mesa ${table.number}, ${table.isAssignedToMe ? "em seu atendimento" : statusLabel}`}
                  >
                    <span>{table.number}</span>
                    <strong>Mesa {table.number}</strong>
                    <small>{table.isAssignedToMe ? "Minha mesa" : statusLabel}</small>
                  </div>
                );
              })}
            </div>
            <div className="waiter-floor-map-legend">
              <span><i className="mine" /> Sua mesa</span>
              <span><i className="occupied" /> Ocupada</span>
              <span><i className="free" /> Livre</span>
              <span><i className="reserved" /> Reservada</span>
            </div>
          </>
        )}
      </section>

      <section className="waiter-assigned-tables" aria-label="Mesas assumidas">
        <div className="waiter-assigned-tables-heading">
          <h2>Minhas mesas</h2>
          <span>{assignedTables.length} em atendimento</span>
        </div>
        {assignedTables.length === 0 ? (
          <p className="waiter-assigned-tables-empty">As mesas que você assumir aparecerão aqui até o fechamento da conta.</p>
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
                  <button
                    type="button"
                    className="waiter-close-table-button"
                    disabled={Boolean(updatingId)}
                    onClick={() => void closeAssignedTable(table.tableNumber)}
                  >
                    {updatingId === `close-${table.tableNumber}` ? <LoaderCircle className="waiter-loader" size={17} /> : <ReceiptText size={17} />}
                    Fechar conta
                  </button>
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
          <p className="waiter-assigned-tables-empty">Os pedidos da cozinha aparecerão aqui quando estiverem prontos.</p>
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
            const isEscalated = request.status === "pending" && request.createdAt != null && Date.now() - request.createdAt.getTime() >= escalationMinutes * 60_000;

            return (
              <article
                className={`waiter-request ${isBill ? "bill" : "call"} ${isCompleted ? "completed" : ""} ${isEscalated ? "escalated" : ""}`}
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
                  {isEscalated && <span className="waiter-attendant">Aguardando há mais de {escalationMinutes} min · prioridade do salão</span>}
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
