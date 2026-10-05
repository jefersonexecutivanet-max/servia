import { useEffect, useMemo, useState } from "react";
import { Calendar, Clock, DollarSign, Download, TrendingUp, Users, UtensilsCrossed } from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";

type Period = "hoje" | "semana" | "mes" | "ano";
type RecordData = Record<string, any>;
type Summary = { revenue: number; orders: number; customers: number; averageTicket: number };

function asDate(value: any): Date | null {
  if (value?.toDate) return value.toDate();
  return value instanceof Date ? value : null;
}

function rangeFor(period: Period, reference = new Date()) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  if (period === "hoje") return { start, end: new Date(start.getTime() + 86400000) };
  if (period === "semana") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { start, end: new Date(start.getTime() + 7 * 86400000) };
  }
  if (period === "mes") {
    start.setDate(1);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return { start, end };
  }
  start.setMonth(0, 1);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  return { start, end };
}

function belongsTo(record: RecordData, range: { start: Date; end: Date }) {
  const date = asDate(record.createdAt);
  return Boolean(date && date >= range.start && date < range.end);
}

function summarize(payments: RecordData[]): Summary {
  const revenue = payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  return {
    revenue,
    orders: payments.length,
    customers: payments.reduce((sum, payment) => sum + (Number(payment.guests) || 0), 0),
    averageTicket: payments.length ? revenue / payments.length : 0,
  };
}

const periodOptions: Array<{ value: Period; label: string }> = [
  { value: "hoje", label: "Hoje" },
  { value: "semana", label: "Esta Semana" },
  { value: "mes", label: "Este Mês" },
  { value: "ano", label: "Este Ano" },
];

export default function ReportsModule() {
  const { restaurantId } = useRestaurantScope();
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("hoje");
  const [orders, setOrders] = useState<RecordData[]>([]);
  const [payments, setPayments] = useState<RecordData[]>([]);
  const [cashTransactions, setCashTransactions] = useState<RecordData[]>([]);

  useEffect(() => {
    setOrders([]);
    setPayments([]);
    setCashTransactions([]);
    if (!restaurantId) {
      return;
    }
    const stopOrders = onSnapshot(
      query(collection(db, "orders"), where("restaurantId", "==", restaurantId)),
      (snapshot) => setOrders(snapshot.docs.map((item) => item.data())),
      (error) => console.error("Erro ao carregar pedidos dos relatórios:", error),
    );
    const stopPayments = onSnapshot(
      query(collection(db, "payments"), where("restaurantId", "==", restaurantId)),
      (snapshot) => setPayments(snapshot.docs.map((item) => item.data())),
      (error) => console.error("Erro ao carregar pagamentos dos relatórios:", error),
    );
    const stopCash = onSnapshot(
      query(collection(db, "cashTransactions"), where("restaurantId", "==", restaurantId)),
      (snapshot) => setCashTransactions(snapshot.docs.map((item) => item.data())),
      (error) => console.error("Erro ao carregar saídas do caixa:", error),
    );
    return () => { stopOrders(); stopPayments(); stopCash(); };
  }, [restaurantId]);

  const { currentRange, previousRange } = useMemo(() => {
    const currentRange = rangeFor(selectedPeriod);
    const previousReference = new Date(currentRange.start);
    if (selectedPeriod === "hoje") previousReference.setDate(previousReference.getDate() - 1);
    else if (selectedPeriod === "semana") previousReference.setDate(previousReference.getDate() - 7);
    else if (selectedPeriod === "mes") previousReference.setMonth(previousReference.getMonth() - 1);
    else previousReference.setFullYear(previousReference.getFullYear() - 1);
    return { currentRange, previousRange: rangeFor(selectedPeriod, previousReference) };
  }, [selectedPeriod]);

  const completedPayments = payments.filter((payment) => payment.status === "completed");
  const currentPayments = completedPayments.filter((payment) => belongsTo(payment, currentRange));
  const previousPayments = completedPayments.filter((payment) => belongsTo(payment, previousRange));
  const currentData = summarize(currentPayments);
  const previousData = summarize(previousPayments);
  const currentExpenses = cashTransactions
    .filter((item) => item.type === "saida" && belongsTo(item, currentRange))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const estimatedResult = currentData.revenue - currentExpenses;
  const completedOrders = orders.filter((order) => order.paymentStatus === "paid" && belongsTo(order, currentRange));

  const topProducts = Object.values(completedOrders.reduce((sales: Record<string, { name: string; quantity: number; revenue: number }>, order) => {
    (Array.isArray(order.items) ? order.items : []).forEach((item: RecordData) => {
      const name = String(item.name || "Produto");
      if (!sales[name]) sales[name] = { name, quantity: 0, revenue: 0 };
      sales[name].quantity += Number(item.quantity) || 0;
      sales[name].revenue += (Number(item.price) || 0) * (Number(item.quantity) || 0);
    });
    return sales;
  }, {})).sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  const peakHours = Object.entries(completedOrders.reduce((hours: Record<string, number>, order) => {
    const date = asDate(order.createdAt);
    if (date) {
      const hour = `${String(date.getHours()).padStart(2, "0")}:00`;
      hours[hour] = (hours[hour] || 0) + 1;
    }
    return hours;
  }, {})).map(([hour, count]) => ({ hour, orders: count }));

  const trend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    const revenue = completedPayments
      .filter((payment) => {
        const createdAt = asDate(payment.createdAt);
        return Boolean(createdAt && createdAt >= date && createdAt < end);
      })
      .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    return { label: date.toLocaleDateString("pt-BR", { weekday: "short" }), revenue };
  });

  const growth = (current: number, previous: number) => previous > 0 ? ((current - previous) / previous) * 100 : null;
  const revenueGrowth = growth(currentData.revenue, previousData.revenue);
  const ordersGrowth = growth(currentData.orders, previousData.orders);
  const money = (amount: number) => `R$ ${amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

  return (
    <div className="module-page">
      <div className="module-header">
        <div><h1>Relatórios e Indicadores</h1><p>Análise do desempenho registrado no restaurante</p></div>
        <button className="primary-button" onClick={() => window.alert("Exportação de relatórios ainda não está disponível.")}><Download size={18} />Exportar Relatório</button>
      </div>

      <div className="period-selector">
        <Calendar size={18} />
        {periodOptions.map((period) => <button key={period.value} className={`period-button ${selectedPeriod === period.value ? "active" : ""}`} onClick={() => setSelectedPeriod(period.value)}>{period.label}</button>)}
      </div>

      <div className="reports-dashboard">
        <div className="stat-card large"><div className="stat-icon success"><DollarSign size={28} /></div><div><span>Vendas confirmadas</span><strong>{money(currentData.revenue)}</strong><small className={revenueGrowth === null ? "neutral" : revenueGrowth >= 0 ? "positive" : "negative"}>{revenueGrowth === null ? "Sem vendas no período anterior" : `${revenueGrowth >= 0 ? "+" : ""}${revenueGrowth.toFixed(1)}% vs. período anterior`}</small></div></div>
        <div className="stat-card"><div className="stat-icon orange"><UtensilsCrossed size={24} /></div><div><span>Pagamentos confirmados</span><strong>{currentData.orders}</strong><small className={ordersGrowth === null ? "neutral" : ordersGrowth >= 0 ? "positive" : "negative"}>{ordersGrowth === null ? "Sem pagamentos no período anterior" : `${ordersGrowth >= 0 ? "+" : ""}${ordersGrowth.toFixed(1)}% vs. período anterior`}</small></div></div>
        <div className="stat-card"><div className="stat-icon blue"><Users size={24} /></div><div><span>Clientes</span><strong>—</strong><small>O fluxo de pagamento não coleta essa informação</small></div></div>
        <div className="stat-card"><div className="stat-icon purple"><TrendingUp size={24} /></div><div><span>Ticket Médio</span><strong>{money(currentData.averageTicket)}</strong><small>Vendas confirmadas ÷ pagamentos</small></div></div>
        <div className="stat-card"><div className="stat-icon green"><Clock size={24} /></div><div><span>Resultado estimado</span><strong>{money(estimatedResult)}</strong><small>Vendas confirmadas menos saídas registradas</small></div></div>
      </div>

      <div className="reports-grid">
        <div className="report-card"><div className="report-card-header"><h3>Produtos mais vendidos</h3><span className="report-badge">Top 5</span></div><div className="top-products-list">{topProducts.length === 0 ? <p className="empty-state">Nenhum produto vendido no período.</p> : topProducts.map((product, index) => <div key={product.name} className="top-product-item"><div className="product-rank">{index + 1}</div><div className="product-info"><strong>{product.name}</strong><span>{product.quantity} vendidos</span></div><div className="product-revenue"><strong>{money(product.revenue)}</strong></div></div>)}</div></div>

        <div className="report-card"><div className="report-card-header"><h3>Horários dos pedidos concluídos</h3><span className="report-badge">Período selecionado</span></div><div className="peak-hours-chart">{peakHours.length === 0 ? <p className="empty-state">Sem pedidos concluídos no período.</p> : peakHours.map((hour) => { const max = Math.max(...peakHours.map((entry) => entry.orders), 1); return <div key={hour.hour} className="peak-hour-item"><div className="hour-bar-container"><div className="hour-bar" style={{ width: `${hour.orders / max * 100}%` }} /></div><div className="hour-info"><span>{hour.hour}</span><strong>{hour.orders} pedidos</strong></div></div>; })}</div></div>

        <div className="report-card"><div className="report-card-header"><h3>Indicadores operacionais</h3><span className="report-badge">Dados disponíveis</span></div><div className="metrics-list"><div className="metric-item"><div className="metric-label"><span>Pedidos concluídos</span><small>No período selecionado</small></div><div className="metric-value"><strong>{completedOrders.length}</strong></div></div><div className="metric-item"><div className="metric-label"><span>Saídas de caixa</span><small>Despesas lançadas no período</small></div><div className="metric-value"><strong>{money(currentExpenses)}</strong></div></div><div className="metric-item"><div className="metric-label"><span>Resultado estimado</span><small>Não inclui custos não lançados no caixa</small></div><div className="metric-value"><strong>{money(estimatedResult)}</strong></div></div></div></div>

        <div className="report-card full-width"><div className="report-card-header"><h3>Vendas confirmadas — últimos 7 dias</h3><span className="report-badge">Pagamentos no banco</span></div><div className="revenue-trend">{trend.every((day) => day.revenue === 0) ? <p className="empty-state">Sem dados suficientes para exibir o gráfico.</p> : trend.map((day) => <div key={day.label} className="trend-item"><div className="trend-bar-container"><div className="trend-bar" style={{ width: `${day.revenue / Math.max(...trend.map((entry) => entry.revenue), 1) * 100}%` }} /></div><div className="trend-info"><span>{day.label}</span><strong>{money(day.revenue)}</strong></div></div>)}</div></div>
      </div>
    </div>
  );
}
