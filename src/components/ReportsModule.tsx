import { useState, useEffect } from "react";
import { TrendingUp, Users, DollarSign, Clock, UtensilsCrossed, Download, Calendar } from "lucide-react";

interface ReportData {
  period: string;
  revenue: number;
  orders: number;
  customers: number;
  averageTicket: number;
  tableTurnover: number;
}

interface TopItem {
  name: string;
  quantity: number;
  revenue: number;
}

export default function ReportsModule() {
  const [selectedPeriod, setSelectedPeriod] = useState("hoje");
  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [topProducts, setTopProducts] = useState<TopItem[]>([]);
  const [peakHours, setPeakHours] = useState<{ hour: string; orders: number }[]>([]);

  const periods = [
    { value: "hoje", label: "Hoje" },
    { value: "semana", label: "Esta Semana" },
    { value: "mes", label: "Este Mês" },
    { value: "ano", label: "Este Ano" },
  ];

  useEffect(() => {
    // Dados mockados para os relatórios
    const mockData: ReportData[] = [
      {
        period: "Hoje",
        revenue: 3842.90,
        orders: 48,
        customers: 120,
        averageTicket: 80.06,
        tableTurnover: 1.8,
      },
      {
        period: "Ontem",
        revenue: 3250.50,
        orders: 42,
        customers: 105,
        averageTicket: 77.39,
        tableTurnover: 1.6,
      },
      {
        period: "Semana Passada",
        revenue: 21800.00,
        orders: 295,
        customers: 735,
        averageTicket: 73.90,
        tableTurnover: 1.7,
      },
    ];

    const mockTopProducts: TopItem[] = [
      { name: "Hambúrguer Artesanal", quantity: 85, revenue: 2720.00 },
      { name: "Pizza Margherita", quantity: 62, revenue: 4333.80 },
      { name: "Coca-Cola 2L", quantity: 95, revenue: 807.50 },
      { name: "Filé Mignon", quantity: 45, revenue: 2677.50 },
      { name: "Cerveja Lata", quantity: 120, revenue: 720.00 },
    ];

    const mockPeakHours = [
      { hour: "12:00 - 13:00", orders: 12 },
      { hour: "13:00 - 14:00", orders: 18 },
      { hour: "14:00 - 15:00", orders: 8 },
      { hour: "19:00 - 20:00", orders: 15 },
      { hour: "20:00 - 21:00", orders: 22 },
      { hour: "21:00 - 22:00", orders: 14 },
    ];

    setReportData(mockData);
    setTopProducts(mockTopProducts);
    setPeakHours(mockPeakHours);
  }, [selectedPeriod]);

  const currentData = reportData[0] || {
    period: selectedPeriod,
    revenue: 0,
    orders: 0,
    customers: 0,
    averageTicket: 0,
    tableTurnover: 0,
  };

  const previousData = reportData[1];
  const calculateGrowth = (current: number, previous: number) => {
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  };

  const revenueGrowth = previousData ? calculateGrowth(currentData.revenue, previousData.revenue) : 0;
  const ordersGrowth = previousData ? calculateGrowth(currentData.orders, previousData.orders) : 0;

  const handleExportReport = () => {
    alert("Funcionalidade de exportação em desenvolvimento. Será implementada com integração real.");
  };

  return (
    <div className="module-page">
      <div className="module-header">
        <div>
          <h1>Relatórios e Indicadores</h1>
          <p>Análise detalhada do desempenho do restaurante</p>
        </div>
        <button className="primary-button" onClick={handleExportReport}>
          <Download size={18} />
          Exportar Relatório
        </button>
      </div>

      <div className="period-selector">
        <Calendar size={18} />
        {periods.map((period) => (
          <button
            key={period.value}
            className={`period-button ${selectedPeriod === period.value ? "active" : ""}`}
            onClick={() => setSelectedPeriod(period.value)}
          >
            {period.label}
          </button>
        ))}
      </div>

      <div className="reports-dashboard">
        <div className="stat-card large">
          <div className="stat-icon success">
            <DollarSign size={28} />
          </div>
          <div>
            <span>Faturamento Total</span>
            <strong>R$ {currentData.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
            <small className={revenueGrowth >= 0 ? "positive" : "negative"}>
              {revenueGrowth >= 0 ? "+" : ""}{revenueGrowth.toFixed(1)}% vs. período anterior
            </small>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon orange">
            <UtensilsCrossed size={24} />
          </div>
          <div>
            <span>Pedidos</span>
            <strong>{currentData.orders}</strong>
            <small className={ordersGrowth >= 0 ? "positive" : "negative"}>
              {ordersGrowth >= 0 ? "+" : ""}{ordersGrowth.toFixed(1)}% vs. período anterior
            </small>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon blue">
            <Users size={24} />
          </div>
          <div>
            <span>Clientes</span>
            <strong>{currentData.customers}</strong>
            <small>Total de clientes atendidos</small>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple">
            <TrendingUp size={24} />
          </div>
          <div>
            <span>Ticket Médio</span>
            <strong>R$ {currentData.averageTicket.toFixed(2)}</strong>
            <small>Valor médio por pedido</small>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green">
            <Clock size={24} />
          </div>
          <div>
            <span>Giro de Mesa</span>
            <strong>{currentData.tableTurnover.toFixed(1)}</strong>
            <small>Média por período</small>
          </div>
        </div>
      </div>

      <div className="reports-grid">
        <div className="report-card">
          <div className="report-card-header">
            <h3>🏆 Produtos Mais Vendidos</h3>
            <span className="report-badge">Top 5</span>
          </div>

          <div className="top-products-list">
            {topProducts.map((product, index) => (
              <div key={index} className="top-product-item">
                <div className="product-rank">{index + 1}</div>
                <div className="product-info">
                  <strong>{product.name}</strong>
                  <span>{product.quantity} vendidos</span>
                </div>
                <div className="product-revenue">
                  <strong>R$ {product.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="report-card">
          <div className="report-card-header">
            <h3>⏰ Horários de Pico</h3>
            <span className="report-badge">Análise</span>
          </div>

          <div className="peak-hours-chart">
            {peakHours.map((hour, index) => {
              const maxOrders = Math.max(...peakHours.map((h) => h.orders));
              const percentage = (hour.orders / maxOrders) * 100;

              return (
                <div key={index} className="peak-hour-item">
                  <div className="hour-bar-container">
                    <div
                      className="hour-bar"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <div className="hour-info">
                    <span>{hour.hour}</span>
                    <strong>{hour.orders} pedidos</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="report-card">
          <div className="report-card-header">
            <h3>📊 Métricas de Desempenho</h3>
            <span className="report-badge">KPIs</span>
          </div>

          <div className="metrics-list">
            <div className="metric-item">
              <div className="metric-label">
                <span>Taxa de Ocupação</span>
                <small>Capacidade utilizada</small>
              </div>
              <div className="metric-value">
                <strong>78%</strong>
                <small className="positive">+5% vs. meta</small>
              </div>
            </div>

            <div className="metric-item">
              <div className="metric-label">
                <span>Tempo Médio de Atendimento</span>
                <small>Do pedido à entrega</small>
              </div>
              <div className="metric-value">
                <strong>18 min</strong>
                <small className="positive">-3 min vs. meta</small>
              </div>
            </div>

            <div className="metric-item">
              <div className="metric-label">
                <span>Satisfação do Cliente</span>
                <small>Avaliação média</small>
              </div>
              <div className="metric-value">
                <strong>4.7/5.0</strong>
                <small className="positive">Excelente</small>
              </div>
            </div>

            <div className="metric-item">
              <div className="metric-label">
                <span>Cancelamentos</span>
                <small>Pedidos cancelados</small>
              </div>
              <div className="metric-value">
                <strong>2.1%</strong>
                <small className="negative">+0.3% vs. meta</small>
              </div>
            </div>

            <div className="metric-item">
              <div className="metric-label">
                <span>Receita por Mesa</span>
                <small>Faturamento médio</small>
              </div>
              <div className="metric-value">
                <strong>R$ 480.36</strong>
                <small className="positive">+12% vs. meta</small>
              </div>
            </div>

            <div className="metric-item">
              <div className="metric-label">
                <span>Custo de Operação</span>
                <small>Porcentagem do faturamento</small>
              </div>
              <div className="metric-value">
                <strong>32%</strong>
                <small className="positive">-2% vs. meta</small>
              </div>
            </div>
          </div>
        </div>

        <div className="report-card full-width">
          <div className="report-card-header">
            <h3>📈 Tendência de Faturamento</h3>
            <span className="report-badge">Últimos 7 dias</span>
          </div>

          <div className="revenue-trend">
            {reportData.map((data, index) => (
              <div key={index} className="trend-item">
                <div className="trend-bar-container">
                  <div
                    className="trend-bar"
                    style={{
                      width: `${(data.revenue / Math.max(...reportData.map((d) => d.revenue))) * 100}%`,
                    }}
                  />
                </div>
                <div className="trend-info">
                  <span>{data.period}</span>
                  <strong>R$ {data.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}