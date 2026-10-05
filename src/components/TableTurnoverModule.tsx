import { useEffect, useMemo, useState, useRef } from "react";
import {
  Timer,
  AlertTriangle,
  TrendingUp,
  Clock,
  Users,
  DollarSign,
  CheckCircle2,
  RefreshCw,
  Zap,
  AlertCircle,
  Bell,
  Phone,
  Receipt,
  ArrowUp,
  Target,
} from "lucide-react";
import { formatCurrency } from "../utils/format";
import type { TableStatus } from "../types/table";
import { collection, onSnapshot, query, where } from "firebase/firestore";
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
  occupancyDuration: number; // em minutos
  lastOrderTime?: Date;
  timeSinceLastRequest?: number; // em minutos
  lastRequestType?: "bill" | "waiter" | "drink" | "dessert";
  turnoverRate: number; // giros por hora
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

function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.floor(minutes)}min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins > 0 ? mins : ""}`;
}

const DEFAULT_THRESHOLDS = {
  waiting: 3,
  longOccupancy: 90,
  slowTurnover: 60,
};

function getAlertLevel(
  timeSince: number,
  threshold: number,
): "none" | "warning" | "critical" {
  if (timeSince < threshold * 0.7) return "none";
  if (timeSince < threshold) return "warning";
  return "critical";
}

function getTurnoverColor(minutes: number): string {
  if (minutes < 45) return "#7fd56b"; // verde - rápido
  if (minutes < 75) return "#f2b45c"; // laranja - normal
  return "#e74c3c"; // vermelho - lento
}

export default function TableTurnoverModule() {
  // Dados simulados para o dashboard (apenas visualização)
  const mockTables: TableMetrics[] = [
    {
      number: 1,
      status: "ocupada",
      guests: 4,
      total: 156.90,
      customer: "Ana",
      occupancyDuration: 45,
      lastOrderTime: new Date(0),
      timeSinceLastRequest: 8,
      lastRequestType: "bill",
      turnoverRate: 1.2,
    },
    {
      number: 2,
      status: "livre",
      guests: 0,
      total: 0,
      occupancyDuration: 0,
      turnoverRate: 1.5,
    },
      {
        number: 3,
        status: "ocupada",
        guests: 2,
        total: 89.50,
        customer: "Mariana",
        occupancyDuration: 95,
        lastOrderTime: new Date(0),
        timeSinceLastRequest: 12,
        lastRequestType: "waiter",
        turnoverRate: 0.8,
      },
      {
        number: 4,
        status: "livre",
        guests: 0,
        total: 0,
        occupancyDuration: 0,
        turnoverRate: 1.3,
      },
      {
        number: 5,
        status: "ocupada",
        guests: 3,
        total: 198.40,
        customer: "João",
        occupancyDuration: 72,
        lastOrderTime: new Date(0),
        timeSinceLastRequest: 2,
        lastRequestType: "drink",
        turnoverRate: 1.0,
      },
      {
        number: 6,
        status: "livre",
        guests: 0,
        total: 0,
        occupancyDuration: 0,
        turnoverRate: 1.4,
      },
      {
        number: 7,
        status: "ocupada",
        guests: 5,
        total: 245.80,
        customer: "Carlos",
        occupancyDuration: 105,
        lastOrderTime: new Date(0),
        timeSinceLastRequest: 15,
        lastRequestType: "bill",
        turnoverRate: 0.6,
      },
      {
        number: 8,
        status: "livre",
        guests: 0,
        total: 0,
        occupancyDuration: 0,
        turnoverRate: 1.1,
      },
    ];

  const [tables, setTables] = useState<TableMetrics[]>(mockTables);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showAlerts, setShowAlerts] = useState(true);
  const [tableCalls, setTableCalls] = useState<TableCall[]>([]);
  const previousCallCountRef = useRef(0);
  const { restaurantId } = useRestaurantScope();

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

  // Simular atualização em tempo real
  useEffect(() => {
    const interval = setInterval(() => {
      if (autoRefresh) {
        setTables(currentTables =>
          currentTables.map(table => ({
            ...table,
            timeSinceLastRequest: table.timeSinceLastRequest
              ? table.timeSinceLastRequest + 1
              : undefined,
            occupancyDuration: table.status === "ocupada"
              ? table.occupancyDuration + 1
              : table.occupancyDuration,
          }))
        );
      }
    }, 60000); // Atualiza a cada minuto

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Métricas calculadas
  const metrics = useMemo(() => {
    const occupied = tables.filter(t => t.status === "ocupada");
    const waitingForAttention = occupied.filter(
      t => t.timeSinceLastRequest && t.timeSinceLastRequest > DEFAULT_THRESHOLDS.waiting
    );
    const longOccupancy = occupied.filter(
      t => t.occupancyDuration > DEFAULT_THRESHOLDS.longOccupancy
    );
    const slowTurnover = occupied.filter(
      t => t.occupancyDuration > DEFAULT_THRESHOLDS.slowTurnover
    );

    const avgOccupancy = occupied.length > 0
      ? occupied.reduce((sum, t) => sum + t.occupancyDuration, 0) / occupied.length
      : 0;

    const avgTurnover = tables.length > 0
      ? tables.reduce((sum, t) => sum + t.turnoverRate, 0) / tables.length
      : 0;

    const potentialRevenue = waitingForAttention.reduce(
      (sum, t) => sum + t.total,
      0
    );

    return {
      occupiedCount: occupied.length,
      waitingCount: waitingForAttention.length,
      longOccupancyCount: longOccupancy.length,
      slowTurnoverCount: slowTurnover.length,
      avgOccupancy,
      avgTurnover,
      potentialRevenue,
      totalTables: tables.length,
    };
  }, [tables]);

  function getRequestIcon(type?: string) {
    switch (type) {
      case "bill":
        return <Receipt size={16} />;
      case "waiter":
        return <Users size={16} />;
      case "drink":
        return <Phone size={16} />;
      case "dessert":
        return <Zap size={16} />;
      default:
        return <Bell size={16} />;
    }
  }

  function getRequestLabel(type?: string) {
    switch (type) {
      case "bill":
        return "Conta";
      case "waiter":
        return "Garçom";
      case "drink":
        return "Bebida";
      case "dessert":
        return "Sobremesa";
      default:
        return "Atendimento";
    }
  }

  async function attendTable(tableNumber: number) {
    try {
      // Aqui você atualizaria no Firebase
      console.log(`Atendendo mesa ${tableNumber}`);
      setTables(currentTables =>
        currentTables.map(table =>
          table.number === tableNumber
            ? { ...table, timeSinceLastRequest: undefined, lastRequestType: undefined }
            : table
        )
      );
    } catch (error) {
      console.error("Erro ao atender mesa:", error);
    }
  }

  async function releaseTable(tableNumber: number) {
    try {
      // Aqui você atualizaria no Firebase
      console.log(`Liberando mesa ${tableNumber}`);
      setTables(currentTables =>
        currentTables.map(table =>
          table.number === tableNumber
            ? { ...table, status: "livre" as TableStatus, occupancyDuration: 0, total: 0, customer: undefined }
            : table
        )
      );
    } catch (error) {
      console.error("Erro ao liberar mesa:", error);
    }
  }

  return (
    <div className="turnover-page">
      <div className="module-header">
        <div>
          <div className="eyebrow">INTELIGÊNCIA DE SALÃO</div>

          <h1>Giro de Mesa Acelerado</h1>

          <p>
            Otimize o tempo de cada mesa e maximize seu faturamento com alertas em tempo real.
          </p>
        </div>

        <div className="module-header-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => setShowAlerts(!showAlerts)}
          >
            {showAlerts ? <Bell size={18} /> : <Bell size={18} />}
            {showAlerts ? "Ocultar alertas" : "Mostrar alertas"}
          </button>

          <button
            className={`secondary-button ${autoRefresh ? "active" : ""}`}
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw size={18} />
            {autoRefresh ? "Auto atualização" : "Pausar"}
          </button>
        </div>
      </div>

      {/* Métricas principais */}
      <div className="turnover-metrics">
        <div className="turnover-metric">
          <div className="metric-icon main">
            <Timer size={22} />
          </div>

          <div>
            <strong>{formatDuration(metrics.avgOccupancy)}</strong>
            <span>Tempo médio de ocupação</span>
          </div>

          <div className="metric-trend">
            <span className="trend-label">Média ideal: 60min</span>
          </div>
        </div>

        <div className="turnover-metric">
          <div className="metric-icon success">
            <TrendingUp size={22} />
          </div>

          <div>
            <strong>{metrics.avgTurnover.toFixed(1)}</strong>
            <span>Giros por hora</span>
          </div>

          <div className="metric-trend">
            <span className="trend-up">
              <ArrowUp size={12} />
              Meta: 1.5
            </span>
          </div>
        </div>

        <div className="turnover-metric">
          <div className="metric-icon warning">
            <AlertTriangle size={22} />
          </div>

          <div>
            <strong>{metrics.waitingCount}</strong>
            <span>Mesas esperando atendimento</span>
          </div>

          <div className="metric-trend">
            <span className="trend-label">Prioridade alta</span>
          </div>
        </div>

        <div className="turnover-metric">
          <div className="metric-icon danger">
            <DollarSign size={22} />
          </div>

          <div>
            <strong>{formatCurrency(metrics.potentialRevenue)}</strong>
            <span>Faturamento em espera</span>
          </div>

          <div className="metric-trend">
            <span className="trend-label">Libere para vender mais</span>
          </div>
        </div>
      </div>

      {/* Chamadas de Garçom - Notificações para o Gerente */}
      {showAlerts && tableCalls.filter(c => c.status === "pending").length > 0 && (
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

      {/* Alertas ativos */}
      {showAlerts && (metrics.waitingCount > 0 || metrics.longOccupancyCount > 0) && (
        <div className="turnover-alerts">
          <div className="alerts-header">
            <AlertCircle size={18} />
            <h3>Alertas de Prioridade</h3>
          </div>

          <div className="alerts-list">
            {tables
              .filter(t => t.status === "ocupada" && t.timeSinceLastRequest && t.timeSinceLastRequest > DEFAULT_THRESHOLDS.waiting)
              .map(table => {
                const alertLevel = getAlertLevel(table.timeSinceLastRequest || 0, DEFAULT_THRESHOLDS.waiting);
                return (
                  <div
                    key={table.number}
                    className={`alert-item alert-${alertLevel}`}
                  >
                    <div className="alert-icon">
                      {alertLevel === "critical" ? <AlertTriangle size={20} /> : <Clock size={20} />}
                    </div>

                    <div className="alert-content">
                      <strong>Mesa {table.number} esperando há {table.timeSinceLastRequest} minutos</strong>
                      <span>
                        {getRequestLabel(table.lastRequestType)} · {table.customer || "Cliente"}
                      </span>
                    </div>

                    <button
                      className="alert-action"
                      type="button"
                      onClick={() => attendTable(table.number)}
                    >
                      Atender
                    </button>
                  </div>
                );
              })}

            {tables
              .filter(t => t.status === "ocupada" && t.occupancyDuration > DEFAULT_THRESHOLDS.longOccupancy)
              .map(table => (
                <div key={table.number} className="alert-item alert-warning">
                  <div className="alert-icon">
                    <Timer size={20} />
                  </div>

                  <div className="alert-content">
                    <strong>Mesa {table.number} ocupada há {table.occupancyDuration} minutos</strong>
                    <span>
                      {table.customer || "Cliente"} · {formatCurrency(table.total)}
                    </span>
                  </div>

                  <button
                    className="alert-action"
                    type="button"
                    onClick={() => releaseTable(table.number)}
                  >
                    Liberar
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Grid de mesas com métricas */}
      <div className="turnover-grid">
        {tables.map(table => {
          const waitingAlert = table.timeSinceLastRequest && table.timeSinceLastRequest > DEFAULT_THRESHOLDS.waiting;
          const occupancyAlert = table.occupancyDuration > DEFAULT_THRESHOLDS.longOccupancy;
          const turnoverColor = getTurnoverColor(table.occupancyDuration);

          return (
            <div
              key={table.number}
              className={`turnover-card ${table.status} ${waitingAlert ? "waiting" : ""} ${occupancyAlert ? "long-occupancy" : ""}`}
            >
              <div className="turnover-card-header">
                <div className="table-number">
                  <strong>{table.number}</strong>
                  <span>{table.status === "ocupada" ? "Ocupada" : "Livre"}</span>
                </div>

                {table.status === "ocupada" && (
                  <div className="occupancy-indicator" style={{ background: turnoverColor }}>
                    <Timer size={14} />
                    <span>{formatDuration(table.occupancyDuration)}</span>
                  </div>
                )}
              </div>

              {table.status === "ocupada" && (
                <>
                  <div className="turnover-card-info">
                    <div>
                      <span>Cliente</span>
                      <strong>{table.customer || "Sem nome"}</strong>
                    </div>

                    <div>
                      <span>Pessoas</span>
                      <strong>{table.guests}</strong>
                    </div>

                    <div>
                      <span>Total</span>
                      <strong>{formatCurrency(table.total)}</strong>
                    </div>
                  </div>

                  {table.timeSinceLastRequest && (
                    <div className="turnover-request">
                      <div className="request-icon">
                        {getRequestIcon(table.lastRequestType)}
                      </div>

                      <div>
                        <span>{getRequestLabel(table.lastRequestType)}</span>
                        <strong>{table.timeSinceLastRequest !== undefined ? `${table.timeSinceLastRequest} minutos atrás` : "Aguardando"}</strong>
                      </div>

                      {waitingAlert && (
                        <button
                          className="quick-attend"
                          type="button"
                          onClick={() => attendTable(table.number)}
                        >
                          Atender
                        </button>
                      )}
                    </div>
                  )}

                  <div className="turnover-metrics-mini">
                    <div>
                      <span>Giro/hora</span>
                      <strong>{table.turnoverRate.toFixed(1)}</strong>
                    </div>

                    <div>
                      <span>Média ideal</span>
                      <strong>1.5</strong>
                    </div>
                  </div>
                </>
              )}

              {table.status === "livre" && (
                <div className="turnover-card-empty">
                  <CheckCircle2 size={24} />
                  <span>Mesa disponível</span>
                  <small>Giro: {table.turnoverRate.toFixed(1)}/hora</small>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Resumo de performance */}
      <div className="turnover-summary">
        <div className="summary-header">
          <Target size={20} />
          <h3>Performance do Salão</h3>
        </div>

        <div className="summary-grid">
          <div className="summary-item">
            <span>Índice de ocupação</span>
            <strong>
              {((metrics.occupiedCount / metrics.totalTables) * 100).toFixed(0)}%
            </strong>
            <small>Meta: 80%</small>
          </div>

          <div className="summary-item">
            <span>Tempo médio de giro</span>
            <strong>{formatDuration(metrics.avgOccupancy)}</strong>
            <small>Meta: 60min</small>
          </div>

          <div className="summary-item">
            <span>Potencial de giros adicionais</span>
            <strong>+{metrics.slowTurnoverCount}</strong>
            <small>Mesas lentas</small>
          </div>

          <div className="summary-item">
            <span>Faturamento potencial</span>
            <strong>{formatCurrency(metrics.potentialRevenue)}</strong>
            <small>Em espera</small>
          </div>
        </div>
      </div>
    </div>
  );
}
