import { useEffect, useMemo, useState, useRef, type ElementType } from "react";
import {
  BellRing,
  Check,
  CheckCheck,
  Clock3,
  LoaderCircle,
  ReceiptText,
  UserRoundCheck,
  UtensilsCrossed,
  AlertTriangle,
  Wifi,
  WifiOff,
  Settings,
  Plus,
  CheckCircle2,
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
import { useRestaurantScope } from "../contexts/RestaurantContext";
import TableTurnoverModule from "./TableTurnoverModule";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import WaiterOrderComposer from "./waiter/WaiterOrderComposer";
import WaiterReadyOrderDetail from "./waiter/WaiterReadyOrderDetail";
import WaiterCallDetail from "./waiter/WaiterCallDetail";
import WaiterTableDetail from "./waiter/WaiterTableDetail";

export type RequestKind = "waiter" | "bill";
export type RequestCollection = "tableCalls" | "billRequests";
export type RequestFilter = "open" | "completed";
export type CallTypeFilter = "all" | "waiter" | "bill";
export type CallStatusFilter = "all" | "pending" | "in_progress" | "completed";

export type ServiceRequest = {
  id: string;
  collectionName: RequestCollection;
  type: RequestKind;
  tableNumber: number;
  status: string;
  createdAt?: Date;
  attendedBy?: string;
  waiterName?: string;
};

export type TableOrder = {
  id: string;
  tableId: string;
  tableNumber: number;
  status: string;
  paymentStatus: string;
  total: number;
  items: Array<{ name: string; quantity: number; price?: number; extras?: string[]; notes?: string }>;
  createdAt?: Date;
  paidAt?: Date;
};

export type AssignedTable = {
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
          price: Number(item.price || 0),
          extras: Array.isArray(item.extras) ? item.extras.map(String) : [],
          notes: String(item.notes || ""),
        }))
      : [],
    createdAt: data.createdAt?.toDate instanceof Function ? data.createdAt.toDate() : undefined,
    paidAt: data.paidAt?.toDate instanceof Function ? data.paidAt.toDate() : undefined,
  };
}

function formatRequestTime(date: Date | undefined, now: number) {
  if (!date) {
    return "Agora";
  }

  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60000));
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
  const isOnline = useOnlineStatus();
  const [tableCalls, setTableCalls] = useState<ServiceRequest[]>([]);
  const [billRequests, setBillRequests] = useState<ServiceRequest[]>([]);
  const [filter, setFilter] = useState<RequestFilter>("open");
  const [callTypeFilter, setCallTypeFilter] = useState<CallTypeFilter>("all");
  const [callStatusFilter, setCallStatusFilter] = useState<CallStatusFilter>("all");
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
  const [now, setNow] = useState(Date.now());
  // Modal states
  const [selectedReadyOrder, setSelectedReadyOrder] = useState<TableOrder | null>(null);
  const [selectedCall, setSelectedCall] = useState<ServiceRequest | null>(null);
  const [selectedTable, setSelectedTable] = useState<(Table & { isAssignedToMe: boolean; position: { left: string; top: string } }) | null>(null);
  const [showOrderComposer, setShowOrderComposer] = useState<{ tableNumber: number; tableId: string; accessToken?: string } | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

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
  useEffect(() => {
    if (!alertsEnabled || openCount === 0) return;
    const soundInterval = window.setInterval(playNotificationSound, 5000);
    return () => window.clearInterval(soundInterval);
  }, [alertsEnabled, openCount]);
  const escalationMinutes = Math.max(1, Number(import.meta.env.VITE_CALL_ESCALATION_MINUTES) || 3);
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

  // Summary counts
  const myTablesCount = assignedTables.length;
  const readyOrdersCount = readyOrders.length;
  const openCallsCount = requests.filter((r) => r.status !== "completed").length;
  const billRequestsCount = requests.filter((r) => r.type === "bill" && r.status !== "completed").length;

  // Filter visible requests
  const visibleRequests = requests.filter((request) => {
    if (filter === "completed" && request.status !== "completed") return false;
    if (filter === "open" && request.status === "completed") return false;
    if (callTypeFilter !== "all" && request.type !== callTypeFilter) return false;
    if (callStatusFilter !== "all" && request.status !== callStatusFilter) return false;
    return true;
  });

  function openOrderComposer(tableNumber: number, tableId: string, accessToken?: string) {
    setShowOrderComposer({ tableNumber, tableId, accessToken });
  }

  function openTableDetail(table: Table & { isAssignedToMe: boolean; position: { left: string; top: string } }) {
    setSelectedTable(table);
  }

  function openReadyOrderDetail(order: TableOrder) {
    setSelectedReadyOrder(order);
  }

  function openCallDetail(request: ServiceRequest) {
    setSelectedCall(request);
  }

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
        <div className="heading-left">
          <div className="servia-brand">
            <UtensilsCrossed size={24} />
            <span>Servia</span>
          </div>
          <div className="heading-title">
            <h1>Garçom</h1>
            <p>Atendimento em tempo real · {user.displayName || user.email}</p>
          </div>
        </div>
        <div className="waiter-header-actions">
          <div className={`connection-indicator ${isOnline ? "online" : "offline"}`} title={isOnline ? "Conectado ao Firebase" : "Desconectado"}>
            {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
            <span>{isOnline ? "Online" : "Offline"}</span>
          </div>
          <button className="waiter-alert-toggle" type="button" onClick={() => void enableAlerts()}>
            {alertsEnabled ? (
              <>
                <BellRing size={18} /> Avisos ativados
              </>
            ) : (
              <>
                <BellRing size={18} /> Ativar avisos
              </>
            )}
          </button>
          <button className="waiter-settings-btn" type="button" title="Configurações">
            <Settings size={20} />
          </button>
        </div>
      </header>

      {newAlert && <div className="waiter-new-alert" role="alert">{newAlert}</div>}

      {/* Summary Indicators */}
      <div className="waiter-summary" role="region" aria-label="Resumo do atendimento">
        <button
          type="button"
          className="summary-card"
          onClick={() => { /* scroll to my tables */ }}
        >
          <UtensilsCrossed size={22} />
          <div>
            <strong>{myTablesCount}</strong>
            <span>Minhas Mesas</span>
          </div>
        </button>
        <button
          type="button"
          className="summary-card ready"
          onClick={() => { /* scroll to ready orders */ }}
        >
          <CheckCircle2 size={22} />
          <div>
            <strong>{readyOrdersCount}</strong>
            <span>Prontos p/ Entregar</span>
          </div>
        </button>
        <button
          type="button"
          className="summary-card calls"
          onClick={() => { /* scroll to calls */ }}
        >
          <BellRing size={22} />
          <div>
            <strong>{openCallsCount}</strong>
            <span>Chamados Abertos</span>
          </div>
        </button>
        <button
          type="button"
          className="summary-card bills"
          onClick={() => { /* scroll to bills */ }}
        >
          <ReceiptText size={22} />
          <div>
            <strong>{billRequestsCount}</strong>
            <span>Contas Solicitadas</span>
          </div>
        </button>
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
              <span className="waiter-floor-entrance">ENTRADA / SALÃO</span>
              {waiterMapTables.map((table) => {
                const tableOrders = orders.filter(
                  (o) => o.tableNumber === table.number && o.status !== "cancelado" && o.paymentStatus !== "paid"
                );
                const hasReadyOrders = tableOrders.some((o) => o.status === "pronto");
                const hasOpenCalls = [...tableCalls, ...billRequests].some(
                  (c) => c.tableNumber === table.number && c.status !== "completed"
                );
                const hasBillRequest = billRequests.some(
                  (c) => c.tableNumber === table.number && c.status !== "completed"
                );
                const isWaitingService = hasOpenCalls && !hasReadyOrders && !hasBillRequest;
                const isWaitingBill = hasBillRequest && !hasReadyOrders;
                
                let statusLabel = table.status === "reservada"
                  ? "Reservada"
                  : table.status === "ocupada" ? "Ocupada" : "Livre";
                if (isWaitingService) statusLabel = "Aguardando atendimento";
                if (hasReadyOrders) statusLabel = "Pedido pronto";
                if (isWaitingBill) statusLabel = "Aguardando conta";

                const statusClass = table.isAssignedToMe 
                  ? "assigned-to-me" 
                  : hasReadyOrders 
                    ? "has-ready" 
                    : isWaitingService 
                      ? "waiting-service" 
                      : isWaitingBill 
                        ? "waiting-bill" 
                        : table.status;

                return (
                  <div
                    className={`waiter-map-table waiter-map-${table.status} ${statusClass}`}
                    key={table.number}
                    style={table.position}
                    title={`Mesa ${table.number} · ${statusLabel}`}
                    aria-label={`Mesa ${table.number}, ${statusLabel}`}
                    onClick={() => openTableDetail(table)}
                  >
                    <span>{table.number}</span>
                    <strong>Mesa {table.number}</strong>
                    <small>{table.isAssignedToMe ? "Minha mesa" : statusLabel}</small>
                    {hasReadyOrders && <span className="map-indicator ready"><CheckCircle2 size={12} /></span>}
                    {isWaitingService && <span className="map-indicator waiting"><AlertTriangle size={12} /></span>}
                    {isWaitingBill && <span className="map-indicator bill"><ReceiptText size={12} /></span>}
                  </div>
                );
              })}
            </div>
            <div className="waiter-floor-map-legend">
              <span><i className="mine" /> Sua mesa</span>
              <span><i className="occupied" /> Ocupada</span>
              <span><i className="free" /> Livre</span>
              <span><i className="reserved" /> Reservada</span>
              <span><i className="waiting" /> Aguardando</span>
              <span><i className="ready" /> Pronto</span>
              <span><i className="bill" /> Conta</span>
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
              const tableCallsForTable = [...tableCalls, ...billRequests].filter(
                (c) => c.tableNumber === table.tableNumber && c.status !== "completed"
              );
              const hasReadyOrders = tableOrders.some((o) => o.status === "pronto");
              const total = tableOrders.reduce((sum, order) => sum + order.total, 0);
              const itemCount = tableOrders.reduce((sum, order) => sum + order.items.reduce((s, i) => s + i.quantity, 0), 0);
              const openCallsCount = tableCallsForTable.length;

              return (
                <article className="waiter-assigned-table" key={table.id}>
                  <div className="table-header">
                    <strong>Mesa {table.tableNumber}</strong>
                    {hasReadyOrders && <span className="table-badge ready"><CheckCircle2 size={14} /> Pronto</span>}
                    {openCallsCount > 0 && <span className="table-badge waiting"><AlertTriangle size={14} /> {openCallsCount} chamado{openCallsCount > 1 ? "s" : ""}</span>}
                  </div>
                  {tableOrders.length === 0 ? (
                    <span className="no-orders">Nenhum pedido em aberto.</span>
                  ) : (
                    <>
                      <ul className="table-items">
                        {tableOrders.flatMap((order) => order.items.map((item, index) => (
                          <li key={`${order.id}-${index}`}>
                            <span>{item.quantity}x {item.name}</span>
                            {item.extras && item.extras.length > 0 && <span className="item-extras">+ {item.extras.join(", ")}</span>}
                            {item.notes && <span className="item-notes">"{item.notes}"</span>}
                          </li>
                        )))}
                      </ul>
                      <div className="table-summary">
                        <span>{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
                        <strong>{formatCurrency(total)}</strong>
                      </div>
                      {openCallsCount > 0 && (
                        <span className="table-calls">{openCallsCount} chamado{openCallsCount > 1 ? "s" : ""} aberto{openCallsCount > 1 ? "s" : ""}</span>
                      )}
                    </>
                  )}
                  <div className="table-actions">
                    <button
                      type="button"
                      className="action-btn primary"
                      onClick={() => openOrderComposer(table.tableNumber, `${restaurantId}_${table.tableNumber}`)}
                    >
                      <Plus size={14} /> Adicionar
                    </button>
                    <button
                      type="button"
                      className="action-btn secondary"
                      onClick={() => {
                        const fullTable = tables.find((t) => t.number === table.tableNumber);
                        if (fullTable) {
                          const pos = waiterMapTables.find((t) => t.number === table.tableNumber)?.position || { left: "0", top: "0" };
                          openTableDetail({ ...fullTable, isAssignedToMe: true, position: pos });
                        }
                      }}
                    >
                      Ver detalhes
                    </button>
                    {tableOrders.length > 0 && (
                      <button type="button" className="action-btn bill" onClick={() => alert("Solicitar conta")}>
                        <ReceiptText size={14} /> Conta
                      </button>
                    )}
                  </div>
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
            {readyOrders.map((order) => {
              const timeReady = order.paidAt || order.createdAt;
              const elapsed = timeReady ? Math.max(0, Math.floor((now - timeReady.getTime()) / 60000)) : 0;
              const elapsedText = elapsed < 1 ? "Agora" : elapsed < 60 ? `${elapsed} min` : `${Math.floor(elapsed / 60)}h ${elapsed % 60}min`;
              const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
              
              return (
                <article className="waiter-ready-order" key={order.id} onClick={() => openReadyOrderDetail(order)}>
                  <div className="order-main">
                    <div className="order-header">
                      <strong>Mesa {order.tableNumber}</strong>
                      <span className="order-id">#{order.id.slice(0, 8).toUpperCase()}</span>
                    </div>
                    <div className="order-meta">
                      <span className="item-count">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
                      <span className="ready-time">
                        <Clock3 size={14} /> Pronto há {elapsedText}
                      </span>
                      <span className="order-total">{formatCurrency(order.total)}</span>
                    </div>
                    <p className="order-items-preview">
                      {order.items.slice(0, 3).map((item) => `${item.quantity}x ${item.name}`).join(" · ")}
                      {order.items.length > 3 && ` +${order.items.length - 3} mais`}
                    </p>
                  </div>
                  <div className="order-actions">
                    <button
                      type="button"
                      className="action-btn view-btn"
                      onClick={(e) => { e.stopPropagation(); openReadyOrderDetail(order); }}
                    >
                      Ver pedido
                    </button>
                    <button
                      type="button"
                      className={`action-btn deliver-btn ${updatingId === order.id ? "loading" : ""}`}
                      onClick={(e) => { e.stopPropagation(); void markOrderDelivered(order); }}
                      disabled={Boolean(updatingId)}
                    >
                      {updatingId === order.id ? <LoaderCircle className="waiter-loader" size={16} /> : <Check size={16} />}
                      {updatingId === order.id ? "Entregando..." : "Entregue"}
                    </button>
                  </div>
                </article>
              );
            })}
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
            Abertos <span>{openCallsCount}</span>
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
        <div className="waiter-filters">
          <select
            value={callTypeFilter}
            onChange={(e) => setCallTypeFilter(e.target.value as CallTypeFilter)}
            aria-label="Filtrar por tipo"
          >
            <option value="all">Todos</option>
            <option value="waiter">Chamados</option>
            <option value="bill">Contas</option>
          </select>
          <select
            value={callStatusFilter}
            onChange={(e) => setCallStatusFilter(e.target.value as CallStatusFilter)}
            aria-label="Filtrar por status"
          >
            <option value="all">Todos</option>
            <option value="pending">Abertos</option>
            <option value="in_progress">Em atendimento</option>
            <option value="completed">Concluídos</option>
          </select>
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
            const isEscalated = request.status === "pending" && request.createdAt != null && now - request.createdAt.getTime() >= escalationMinutes * 60_000;

            return (
              <article
                className={`waiter-request ${isBill ? "bill" : "call"} ${isCompleted ? "completed" : ""} ${isEscalated ? "escalated" : ""}`}
                key={documentKey}
                onClick={() => openCallDetail(request)}
              >
                <div className="waiter-request-icon">
                  <Icon size={22} />
                </div>
                <div className="waiter-request-content">
                  <div className="waiter-request-title">
                    <span>{isBill ? "Solicitou a conta" : "Chamou o garçom"}</span>
                    <span className="waiter-request-time">
                      <Clock3 size={14} /> {formatRequestTime(request.createdAt, now)}
                    </span>
                  </div>
                  <strong className="waiter-table-number">
                    Mesa {request.tableNumber}
                  </strong>
                  {isEscalated && <span className="waiter-attendant escalated">Aguardando há mais de {escalationMinutes} min · prioridade do salão</span>}
                  {isInProgress && request.attendedBy && (
                    <span className="waiter-attendant in-progress">
                      Em atendimento por {request.attendedBy}
                    </span>
                  )}
                  {isCompleted && request.attendedBy && (
                    <span className="waiter-attendant completed">
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
                  onClick={(e) => { e.stopPropagation(); void advanceRequest(request); }}
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

      {/* Modals */}
      {selectedReadyOrder && (
        <WaiterReadyOrderDetail
          order={selectedReadyOrder}
          onClose={() => setSelectedReadyOrder(null)}
          onMarkDelivered={markOrderDelivered}
          delivering={updatingId === selectedReadyOrder.id}
          now={now}
        />
      )}
      {selectedCall && (
        <WaiterCallDetail
          request={selectedCall}
          orders={orders}
          onClose={() => setSelectedCall(null)}
          onAdvance={advanceRequest}
          updating={updatingId === `${selectedCall.collectionName}/${selectedCall.id}`}
        />
      )}
      {selectedTable && (
        <WaiterTableDetail
          table={selectedTable}
          orders={orders}
          tableCalls={tableCalls}
          billRequests={billRequests}
          onClose={() => setSelectedTable(null)}
          onOpenComposer={openOrderComposer}
        />
      )}
      {showOrderComposer && (
        <WaiterOrderComposer
          tableNumber={showOrderComposer.tableNumber}
          tableId={showOrderComposer.tableId}
          accessToken={showOrderComposer.accessToken}
          onClose={() => setShowOrderComposer(null)}
        />
      )}
    </section>
  );
}
