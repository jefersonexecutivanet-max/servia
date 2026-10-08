import { useEffect, useMemo, useState } from "react";
import { Calendar, Clock, DollarSign, Download, TrendingUp, Users, UtensilsCrossed } from "lucide-react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";
import { aggregateProductSales, expenseDeltaCents, totalExpenseCents, type PaidItemDetail } from "../utils/reporting";

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

function csvValue(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\t\r=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function formatDate(value: unknown): string {
  const date = asDate(value);
  return date ? date.toLocaleString("pt-BR") : "";
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
      (snapshot) => setOrders(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
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
  const paymentMethodTotals = currentPayments.reduce((totals: Record<string, number>, payment) => {
    const parts = Array.isArray(payment.paymentParts) && payment.paymentParts.length
      ? payment.paymentParts
      : [{ method: payment.method || payment.paymentMethod || "other", amount: payment.amount }];
    parts.forEach((part: RecordData) => {
      const method = String(part.method || "other");
      const amount = Number(part.amount ?? (Number(part.amountCents) / 100)) || 0;
      totals[method] = (totals[method] || 0) + amount;
    });
    return totals;
  }, {});
  const operatorTotals = currentPayments.reduce((totals: Record<string, { amount: number; payments: number }>, payment) => {
    const operator = String(payment.createdByName || payment.createdBy || "Operador não identificado");
    if (!totals[operator]) totals[operator] = { amount: 0, payments: 0 };
    totals[operator].amount += Number(payment.amount) || 0;
    totals[operator].payments += 1;
    return totals;
  }, {});
  const sortedOperatorTotals = Object.entries(operatorTotals).sort((first, second) => second[1].amount - first[1].amount);
  const previousData = summarize(previousPayments);
  const currentExpenseMovements = cashTransactions.filter((item) => belongsTo(item, currentRange));
  const currentExpenses = totalExpenseCents(currentExpenseMovements) / 100;
  const estimatedResult = currentData.revenue - currentExpenses;
  const paidOrderIdsInRange = new Set(currentPayments.flatMap((payment) => Array.isArray(payment.orderIds) ? payment.orderIds : []));
  const completedOrders = orders.filter((order) => paidOrderIdsInRange.has(String(order.id || ""))
    || (order.paymentStatus === "paid" && belongsTo(order, currentRange)));

  const paymentsWithItemDetails = currentPayments.filter((payment) => Array.isArray(payment.itemDetails));
  const modernOrderIds = new Set(paymentsWithItemDetails.flatMap((payment) => Array.isArray(payment.orderIds) ? payment.orderIds : []));
  const paidItems: PaidItemDetail[] = paymentsWithItemDetails.flatMap((payment) => payment.itemDetails as PaidItemDetail[]);
  completedOrders.filter((order) => !modernOrderIds.has(String(order.id || ""))).forEach((order) => {
    (Array.isArray(order.items) ? order.items : []).forEach((item: RecordData, lineIndex: number) => {
      const paid = Number(order.paidQuantities?.[String(lineIndex)]);
      const quantity = Number.isInteger(paid) ? paid : Math.max(0, (Number(item.quantity) || 0) - (Number(item.cancelledQuantity) || 0));
      if (quantity > 0) paidItems.push({ productId: item.productId, name: item.name, quantity, unitPriceCents: Math.round((Number(item.price) || 0) * 100) });
    });
  });
  const topProducts = aggregateProductSales(paidItems).slice(0, 5);
  const exportedItemDetails: Array<{ createdAt: unknown; tableNumber: unknown; item: PaidItemDetail }> = paymentsWithItemDetails.flatMap((payment) =>
    (payment.itemDetails as PaidItemDetail[]).map((item) => ({ createdAt: payment.createdAt, tableNumber: payment.tableNumber, item })),
  );
  completedOrders.filter((order) => !modernOrderIds.has(String(order.id || ""))).forEach((order) => {
    (Array.isArray(order.items) ? order.items : []).forEach((item: RecordData, lineIndex: number) => {
      const paid = Number(order.paidQuantities?.[String(lineIndex)]);
      const quantity = Number.isInteger(paid) ? paid : Math.max(0, (Number(item.quantity) || 0) - (Number(item.cancelledQuantity) || 0));
      if (quantity > 0) exportedItemDetails.push({
        createdAt: order.createdAt,
        tableNumber: order.tableNumber,
        item: { productId: item.productId, name: item.name, quantity, unitPriceCents: Math.round((Number(item.price) || 0) * 100) },
      });
    });
  });

  const orderPaymentTimes = new Map<string, Date>();
  currentPayments.forEach((payment) => {
    const date = asDate(payment.createdAt);
    if (!date) return;
    (Array.isArray(payment.orderIds) ? payment.orderIds : []).forEach((orderId: string) => {
      const existing = orderPaymentTimes.get(orderId);
      if (!existing || existing < date) orderPaymentTimes.set(orderId, date);
    });
  });
  completedOrders.forEach((order) => {
    if (!orderPaymentTimes.has(String(order.id || ""))) {
      const date = asDate(order.createdAt);
      if (date) orderPaymentTimes.set(String(order.id || `legacy-${orderPaymentTimes.size}`), date);
    }
  });
  const peakHours = Object.entries([...orderPaymentTimes.values()].reduce((hours: Record<string, number>, date) => {
      const hour = `${String(date.getHours()).padStart(2, "0")}:00`;
      hours[hour] = (hours[hour] || 0) + 1;
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

  function exportReport() {
    const rows: unknown[][] = [
      ["RELATÓRIO SERVIA", "Período", periodOptions.find((period) => period.value === selectedPeriod)?.label || selectedPeriod],
      ["RELATÓRIO SERVIA", "De", currentRange.start.toLocaleDateString("pt-BR")],
      ["RELATÓRIO SERVIA", "Até", new Date(currentRange.end.getTime() - 1).toLocaleDateString("pt-BR")],
      [],
      ["RESUMO", "Vendas confirmadas", currentData.revenue.toFixed(2)],
      ["RESUMO", "Pagamentos confirmados", currentData.orders],
      ["RESUMO", "Ticket médio", currentData.averageTicket.toFixed(2)],
      ["RESUMO", "Despesas líquidas (após estornos)", currentExpenses.toFixed(2)],
      ["RESUMO", "Resultado estimado", estimatedResult.toFixed(2)],
      [],
      ["PAGAMENTOS", "Data", "Mesa", "Forma de pagamento", "Operador", "Valor", "Clientes"],
      ...sortedOperatorTotals.map(([operator, totals]) => ["TOTAL POR OPERADOR", operator, totals.payments, totals.amount.toFixed(2)]),
      ...Object.entries(paymentMethodTotals).map(([method, amount]) => ["TOTAL POR FORMA", method, amount.toFixed(2)]),
      ...currentPayments.map((payment) => ["PAGAMENTO", formatDate(payment.createdAt), payment.tableNumber ?? "", payment.method ?? payment.paymentMethod ?? "", payment.createdByName || payment.createdBy || "Operador não identificado", Number(payment.amount) || 0, Number(payment.guests) || 0]),
      [],
      ["DESPESAS", "Data", "Descrição", "Categoria", "Valor", "Forma de pagamento"],
      ...currentExpenseMovements
        .filter((item) => expenseDeltaCents(item) !== 0)
        .map((item) => [item.type === "estorno" ? "ESTORNO DE DESPESA" : "DESPESA", formatDate(item.createdAt), item.description || "", item.category || "", expenseDeltaCents(item) / 100, item.paymentMethod || ""]),
      [],
      ["PRODUTOS VENDIDOS", "Produto", "Quantidade", "Faturamento"],
      ...topProducts.map((product) => ["PRODUTO", product.name, product.quantity, product.revenue.toFixed(2)]),
      [],
      ["ITENS PAGOS", "Data do pagamento", "Mesa", "Produto", "Quantidade", "Valor unitário", "Total"],
      ...exportedItemDetails.map(({ createdAt, tableNumber, item }) => [
        "ITEM PAGO", formatDate(createdAt), tableNumber ?? "", item.name || "Produto", Number(item.quantity) || 0,
        (Number(item.unitPriceCents) || 0) / 100, ((Number(item.unitPriceCents) || 0) * (Number(item.quantity) || 0) / 100).toFixed(2),
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvValue).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `servia-relatorio-${selectedPeriod}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="module-page">
      <div className="module-header">
        <div><h1>Relatórios e Indicadores</h1><p>Análise do desempenho registrado no restaurante</p></div>
        <button className="primary-button" type="button" onClick={exportReport}><Download size={18} />Exportar Relatório</button>
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
        <div className="stat-card"><div className="stat-icon green"><Clock size={24} /></div><div><span>Resultado estimado</span><strong>{money(estimatedResult)}</strong><small>Vendas confirmadas menos despesas líquidas</small></div></div>
      </div>

      <div className="reports-grid">
        <div className="report-card"><div className="report-card-header"><h3>Vendas por operador</h3><span className="report-badge">Período selecionado</span></div><div className="metrics-list">{sortedOperatorTotals.length === 0 ? <p className="empty-state">Nenhuma venda identificada por operador.</p> : sortedOperatorTotals.map(([operator, totals]) => <div className="metric-item" key={operator}><div className="metric-label"><span>{operator}</span><small>{totals.payments} pagamentos</small></div><div className="metric-value"><strong>{money(totals.amount)}</strong></div></div>)}</div></div>
        <div className="report-card"><div className="report-card-header"><h3>Produtos mais vendidos</h3><span className="report-badge">Top 5</span></div><div className="top-products-list">{topProducts.length === 0 ? <p className="empty-state">Nenhum produto vendido no período.</p> : topProducts.map((product, index) => <div key={product.name} className="top-product-item"><div className="product-rank">{index + 1}</div><div className="product-info"><strong>{product.name}</strong><span>{product.quantity} vendidos</span></div><div className="product-revenue"><strong>{money(product.revenue)}</strong></div></div>)}</div></div>

        <div className="report-card"><div className="report-card-header"><h3>Horários dos pedidos concluídos</h3><span className="report-badge">Período selecionado</span></div><div className="peak-hours-chart">{peakHours.length === 0 ? <p className="empty-state">Sem pedidos concluídos no período.</p> : peakHours.map((hour) => { const max = Math.max(...peakHours.map((entry) => entry.orders), 1); return <div key={hour.hour} className="peak-hour-item"><div className="hour-bar-container"><div className="hour-bar" style={{ width: `${hour.orders / max * 100}%` }} /></div><div className="hour-info"><span>{hour.hour}</span><strong>{hour.orders} pedidos</strong></div></div>; })}</div></div>

        <div className="report-card"><div className="report-card-header"><h3>Indicadores operacionais</h3><span className="report-badge">Dados disponíveis</span></div><div className="metrics-list"><div className="metric-item"><div className="metric-label"><span>Pedidos com pagamentos</span><small>Inclui pagamentos parciais no período</small></div><div className="metric-value"><strong>{completedOrders.length}</strong></div></div>{Object.entries(paymentMethodTotals).map(([method, amount]) => <div className="metric-item" key={method}><div className="metric-label"><span>Pagamento · {method}</span><small>Período selecionado</small></div><div className="metric-value"><strong>{money(amount)}</strong></div></div>)}
        <div className="metric-item"><div className="metric-label"><span>Despesas líquidas</span><small>Saídas menos estornos no período</small></div><div className="metric-value"><strong>{money(currentExpenses)}</strong></div></div><div className="metric-item"><div className="metric-label"><span>Resultado estimado</span><small>Não inclui custos não lançados no caixa</small></div><div className="metric-value"><strong>{money(estimatedResult)}</strong></div></div></div></div>

        <div className="report-card full-width"><div className="report-card-header"><h3>Vendas confirmadas — últimos 7 dias</h3><span className="report-badge">Pagamentos no banco</span></div><div className="revenue-trend">{trend.every((day) => day.revenue === 0) ? <p className="empty-state">Sem dados suficientes para exibir o gráfico.</p> : trend.map((day) => <div key={day.label} className="trend-item"><div className="trend-bar-container"><div className="trend-bar" style={{ width: `${day.revenue / Math.max(...trend.map((entry) => entry.revenue), 1) * 100}%` }} /></div><div className="trend-info"><span>{day.label}</span><strong>{money(day.revenue)}</strong></div></div>)}</div></div>
      </div>
    </div>
  );
}
