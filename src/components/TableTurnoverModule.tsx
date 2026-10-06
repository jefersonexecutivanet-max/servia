import { useEffect, useMemo, useState, useRef } from "react";
import {
  Timer,
  AlertTriangle,
  DollarSign,
  Bell,
} from "lucide-react";
import { formatCurrency } from "../utils/format";
import { calculateOrderTotal } from "../utils/orders";
import type { TableStatus } from "../types/table";
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";

type TableCall = {
  id: string;
  tableNumber: number;
  type: "waiter" | "bill";
  status: string;
  waiterName?: string;
  createdAt?: Date;
};

type TableMetrics = {
  number: number;
  status: TableStatus;
  guests: number;
  total: number;
  customer?: string;
};

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

export default function TableTurnoverModule({ embedded = false }: { embedded?: boolean }) {
  const { restaurantId } = useRestaurantScope();
  const [tables, setTables] = useState<TableMetrics[]>([]);
  const [showAlerts, setShowAlerts] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tableCalls, setTableCalls] = useState<TableCall[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const previousCallCountRef = useRef(0);

  // Função para tocar som de notificação
  const playNotificationSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 600;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (error) {
      console.error("Erro ao tocar som:", error);
    }
  };

  // Carregar mesas reais do Firestore
  useEffect(() => {
    setTables([]);
    if (!restaurantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      query(collection(db, "tables"), where("restaurantId", "==", restaurantId)),
      (snapshot) => {
        const tableData = snapshot.docs.map(doc => doc.data() as any);
        const metrics: TableMetrics[] = tableData.map(t => ({
          number: t.number,
          status: t.status,
          guests: t.guests || 0,
          total: t.total || 0,
          customer: t.customer,
        }));
        setTables(metrics);
        setLoading(false);
      },
      (error) => {
        console.error("Erro ao carregar mesas:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    setOrders([]);
    setPayments([]);
    if (!restaurantId) return;
    const stopOrders = onSnapshot(query(collection(db, "orders"), where("restaurantId", "==", restaurantId)), (snapshot) => {
      setOrders(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    }, (error) => console.error("Erro ao carregar pedidos das mesas:", error));
    const stopPayments = onSnapshot(query(collection(db, "payments"), where("restaurantId", "==", restaurantId)), (snapshot) => {
      setPayments(snapshot.docs.map((item) => item.data()));
    }, (error) => console.error("Erro ao carregar pagamentos:", error));
    return () => { stopOrders(); stopPayments(); };
  }, [restaurantId]);

  // Carregar chamadas de garçom para notificações
  useEffect(() => {
    if (!restaurantId) {
      return;
    }

    const unsubscribe = onSnapshot(
      query(collection(db, "tableCalls"), where("restaurantId", "==", restaurantId)),
      (snapshot) => {
        const calls = snapshot.docs.map(doc => ({
          id: doc.id,
          tableNumber: Number(doc.data().tableNumber || 0),
          type: doc.data().type || "waiter",
          status: doc.data().status || "pending",
          waiterName: doc.data().waiterName,
          createdAt: doc.data().createdAt?.toDate(),
        }));
        
        const pendingCalls = calls.filter(c => c.status === "pending");
        
        // Tocar som se houver novos chamados
        if (pendingCalls.length > previousCallCountRef.current && previousCallCountRef.current > 0) {
          playNotificationSound();
        }
        
        setTableCalls(calls);
        previousCallCountRef.current = pendingCalls.length;
      },
      (error) => {
        console.error("Erro ao carregar chamadas:", error);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  // Métricas calculadas
  const openOrders = useMemo(() => orders.filter((order) => order.status !== "cancelado" && order.paymentStatus !== "paid"), [orders]);
  const liveTables = useMemo(() => tables.map((table) => {
    const tableOrders = openOrders.filter((order) => order.tableNumber === table.number);
    return tableOrders.length
      ? { ...table, status: "ocupada" as const, total: tableOrders.reduce((sum, order) => sum + calculateOrderTotal(Array.isArray(order.items) ? order.items : []), 0) }
      : table;
  }), [tables, openOrders]);

  const metrics = useMemo(() => {
    const occupied = liveTables.filter(t => t.status === "ocupada");
    const free = liveTables.filter(t => t.status === "livre");
    const occupiedCount = occupied.length;
    const freeCount = free.length;
    const totalTables = liveTables.length;
    const totalRevenue = payments.filter((payment) => payment.status === "completed")
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);

    return {
      occupiedCount,
      freeCount,
      totalTables,
      totalRevenue,
    };
  }, [liveTables, payments]);

  async function releaseTable(tableNumber: number) {
    const table = liveTables.find((item) => item.number === tableNumber);
    if (!table || table.total <= 0) {
      window.alert("Não há valor registrado para receber nesta mesa.");
      return;
    }
    if (!window.confirm(`Confirmar recebimento de ${formatCurrency(table.total)} e liberar a mesa ${tableNumber}?`)) return;
    const method = window.prompt("Informe a forma de pagamento: pix, card ou cash", "pix");
    if (!method || !["pix", "card", "cash"].includes(method)) {
      window.alert("Forma de pagamento inválida. Use pix, card ou cash.");
      return;
    }
    try {
      const assignmentRef = doc(db, "waiterTables", `${restaurantId}_${tableNumber}`);
      const assignmentSnapshot = await getDoc(assignmentRef);
      const batch = writeBatch(db);
      const paymentRef = doc(collection(db, "payments"));
      batch.set(paymentRef, {
        restaurantId,
        tableId: `${restaurantId}_${tableNumber}`,
        tableNumber,
        method,
        amount: table.total,
        items: openOrders.filter((order) => order.tableNumber === tableNumber)
          .reduce((count, order) => count + (Array.isArray(order.items) ? order.items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0) : 0), 0),
        status: "completed",
        createdAt: serverTimestamp(),
      });
      openOrders.filter((order) => order.tableNumber === tableNumber).forEach((order) => {
        batch.update(doc(db, "orders", order.id), { paymentStatus: "paid", paymentId: paymentRef.id, paidAt: serverTimestamp() });
      });
      batch.update(doc(db, "tables", `${restaurantId}_${tableNumber}`), { status: "livre", guests: 0, total: 0, customer: "" });
      if (assignmentSnapshot.exists()) batch.delete(assignmentRef);
      await batch.commit();
    } catch (error) {
      console.error("Erro ao liberar mesa:", error);
      window.alert("Não foi possível confirmar o recebimento e liberar a mesa.");
    }
  }

  if (loading) {
    if (embedded) {
      return <div className="turnover-embedded-loading">Carregando mesas...</div>;
    }
    return (
      <div className="turnover-page">
        <div className="module-header">
          <div>
            <div className="eyebrow">INTELIG�NCIA DE SAL�O</div>
            <h1>Giro de Mesa Acelerado</h1>
            <p>Carregando dados...</p>
          </div>
        </div>
      </div>
    );
  }

  if (tables.length === 0) {
    if (embedded) {
      return <div className="turnover-embedded-loading">Nenhuma mesa cadastrada. Cadastre mesas no módulo Mesas.</div>;
    }
    return (
      <div className="turnover-page">
        <div className="module-header">
          <div>
            <div className="eyebrow">INTELIG�NCIA DE SAL�O</div>
            <h1>Giro de Mesa Acelerado</h1>
            <p>Nenhuma mesa cadastrada. Cadastre mesas no módulo Mesas primeiro.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`turnover-page${embedded ? " turnover-embedded" : ""}`}>
      {!embedded && (
      <div className="module-header">
        <div>
          <div className="eyebrow">INTELIG�NCIA DE SAL�O</div>

          <h1>Giro de Mesa Acelerado</h1>

          <p>
            Otimize o tempo de cada mesa e maximize seu faturamento com alertas em tempo real.
          </p>
        </div>
        </div>
      )}

      {!embedded && (
        <div className="module-header-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => setShowAlerts(!showAlerts)}
          >
            {showAlerts ? <Bell size={18} /> : <Bell size={18} />}
            {showAlerts ? "Ocultar alertas" : "Mostrar alertas"}
          </button>
        </div>
      )}

      {/* Métricas principais */}
      <div className="turnover-metrics">
        <div className="turnover-metric">
          <div className="metric-icon main">
            <Timer size={22} />
          </div>

          <div>
            <strong>{metrics.occupiedCount}</strong>
            <span>Mesas ocupadas</span>
          </div>

          <div className="metric-trend">
            <span className="trend-label">Total: {metrics.totalTables}</span>
          </div>
        </div>

        <div className="turnover-metric">
          <div className="metric-icon success">
            <DollarSign size={22} />
          </div>

          <div>
            <strong>{formatCurrency(metrics.totalRevenue)}</strong>
            <span>Faturamento atual</span>
          </div>

          <div className="metric-trend">
            <span className="trend-label">Em tempo real</span>
          </div>
        </div>

        <div className="turnover-metric">
          <div className="metric-icon warning">
            <AlertTriangle size={22} />
          </div>

          <div>
            <strong>{metrics.freeCount}</strong>
            <span>Mesas livres</span>
          </div>

          <div className="metric-trend">
            <span className="trend-label">Disponíveis</span>
          </div>
        </div>
      </div>

      {/* Chamadas de Garçom - Notificações para o Gerente */}
      {!embedded && showAlerts && tableCalls.filter(c => c.status === "pending").length > 0 && (
        <div className="turnover-alerts">
          <div className="alert-header">
            <Bell size={20} />
            <strong>Chamadas de Garçom Pendentes</strong>
          </div>
          <div className="alert-list">
            {tableCalls.filter(c => c.status === "pending").map(call => (
              <div key={call.id} className="alert-item">
                <div className="alert-table">
                  <strong>Mesa {call.tableNumber}</strong>
                </div>
                <div className="alert-type">
                  {call.type === "waiter" ? "Chamou garçom" : "Pediu conta"}
                </div>
                {call.waiterName && (
                  <div className="alert-waiter">
                    {call.waiterName}
                  </div>
                )}
                <div className="alert-time">
                  {call.createdAt ? formatRequestTime(call.createdAt) : "Agora"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabela de mesas */}
      <div className="turnover-tables">
        <div className="tables-header">
          <h3>Mesas em Tempo Real</h3>
          <span>{tables.length} mesas · {metrics.occupiedCount} ocupadas · {metrics.freeCount} livres</span>
        </div>

        <div className="tables-grid">
          {tables.map((table) => (
            <div
              key={table.number}
              className={`turnover-table ${table.status}`}
            >
              <div className="table-number">
                <strong>{table.number}</strong>
              </div>

              <div className="table-info">
                <span className="table-status">
                  {table.status === "livre" ? "Livre" : 
                   table.status === "ocupada" ? "Ocupada" : "Reservada"}
                </span>
                {table.status === "ocupada" && (
                  <>
                    <span>{table.guests} pessoas</span>
                    <span>{formatCurrency(table.total)}</span>
                  </>
                )}
              </div>

              {table.status === "ocupada" && (
                <div className="table-actions">
                  <button
                    className="table-action"
                    type="button"
                    onClick={() => releaseTable(table.number)}
                  >
                    Liberar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
