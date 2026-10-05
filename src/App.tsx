import { startTransition, useEffect, useState, type ElementType, type FormEvent } from "react";

import {
  BarChart3,
  Bell,
  BellRing,
  BookOpen,
  Box,
  Calculator,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Grid3X3,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShoppingBag,
  Store,
  Timer,
  UserRound,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  updatePassword,
  updateProfile,
  reload,
  sendPasswordResetEmail,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";

import TablesModule from "./components/TablesModule";
import CustomerTable from "./components/CustomerTable";
import OrdersModule from "./components/OrdersModule";
import MenuModule from "./components/MenuModule";
import KitchenModule from "./components/KitchenModule";
import SettingsModule from "./components/SettingsModule";
import TableTurnoverModule from "./components/TableTurnoverModule";
import StockModule from "./components/StockModule";
import TeamModule from "./components/TeamModule";
import CashModule from "./components/CashModule";
import ReportsModule from "./components/ReportsModule";
import WaiterModule from "./components/WaiterModule";
import RestaurantsModule from "./components/RestaurantsModule";
import { RestaurantProvider } from "./contexts/RestaurantContext";

import { formatCurrency } from "./utils/format";
import type { TableStatus } from "./types/table";

type ModuleName =
  | "Dashboard"
  | "Mesas"
  | "Giro de Mesa"
  | "Pedidos"
  | "Atendimento"
  | "Restaurantes"
  | "Cardápio"
  | "Cozinha"
  | "Estoque"
  | "Equipe"
  | "Caixa"
  | "Relatórios"
  | "Configurações";

/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function getStatusClass(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "preparando") {
    return "order-status preparing";
  }

  if (normalized === "pronto") {
    return "order-status ready";
  }

  if (normalized === "entregue") {
    return "order-status delivered";
  }

  return "order-status";
}

function getTableClass(status: TableStatus) {
  if (status === "ocupada") {
    return "dashboard-table occupied";
  }

  if (status === "reservada") {
    return "dashboard-table reserved";
  }

  return "dashboard-table free";
}

const ownerIdentity = {
  uid: "FOuQD7ivuuVAfDZwlsjaU2Lte753",
  email: "finho60@hotmail.com",
};

/* =========================================================
   LOGIN
========================================================= */

function LoginScreen({ waiterMode = false, waiterEmail = "" }: { waiterMode?: boolean; waiterEmail?: string } = {}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");

  const [name, setName] = useState("");
  const [email, setEmail] = useState(waiterEmail);
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(waiterMode && !waiterEmail ? "Este QR precisa ser atualizado pelo gestor para incluir o e-mail de acesso." : "");
  const [notice, setNotice] = useState("");

  async function handlePasswordReset() {
    if (!email.trim()) {
      setError("Digite seu e-mail para recuperar a senha.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setNotice("E-mail de recuperação enviado. Verifique sua caixa de entrada.");
      setMode("login");
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err && "code" in err
          ? String((err as { code: string }).code)
          : "";

      if (code === "auth/user-not-found") {
        setError("E-mail não encontrado.");
      } else if (code === "auth/invalid-email") {
        setError("E-mail inválido.");
      } else {
        setError("Não foi possível enviar o e-mail de recuperação.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (waiterMode && !email.trim()) {
      setError("Este QR precisa ser atualizado pelo gestor para incluir o e-mail de acesso.");
      return;
    }

    setError("");
    setNotice("");
    setLoading(true);

    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(
          auth,
          email.trim().toLowerCase(),
          password,
        );
      } else {
        const credential =
          await createUserWithEmailAndPassword(
            auth,
            email.trim().toLowerCase(),
            password,
          );

        if (name.trim()) {
          await updateProfile(credential.user, {
            displayName: name.trim(),
          });
        }

        await sendEmailVerification(credential.user);
        await signOut(auth);
        setNotice(
          waiterMode
            ? "Sua senha foi criada. Confirme seu e-mail e depois volte ao QR para entrar com seu e-mail e senha."
            : "Confirme seu e-mail antes de entrar no Servia.",
        );
        if (waiterMode) {
          setMode("login");
        }
      }
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err && "code" in err
          ? String((err as { code: string }).code)
          : "";

      if (
        code === "auth/invalid-credential" ||
        code === "auth/wrong-password" ||
        code === "auth/user-not-found"
      ) {
        setError(waiterMode ? "Senha temporária ou atual incorreta." : "E-mail ou senha incorretos.");
      } else if (code === "auth/email-already-in-use") {
        if (waiterMode && mode === "register") {
          setMode("login");
          setError("Este e-mail já tem uma conta. Entre com a senha que você criou.");
        } else {
          setError("Este e-mail já está cadastrado.");
        }
      } else if (code === "auth/weak-password") {
        setError(
          "A senha precisa ter pelo menos 6 caracteres.",
        );
      } else if (code === "auth/invalid-email") {
        setError("Digite um e-mail válido.");
      } else if (code === "auth/network-request-failed") {
        setError(
          "Não foi possível conectar ao Firebase. Verifique sua internet.",
        );
      } else {
        setError(
          "Não foi possível realizar a operação. Tente novamente.",
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-background-glow glow-one" />
      <div className="login-background-glow glow-two" />

      <div className="login-container">
        <div className="login-brand">
          <div className="login-brand-icon">
            <UtensilsCrossed size={24} />
          </div>

          <div>
            <strong>Servia</strong>
            <span>Sistema de gestão para restaurantes</span>
          </div>
        </div>

        <div className="login-card">
          <div className="login-card-header">
            <div className="login-card-icon">
              {mode === "login" ? (
                <Store size={22} />
              ) : (
                <UserRound size={22} />
              )}
            </div>

            <div>
              <h1>
                {waiterMode
                  ? mode === "reset" ? "Recuperar senha" : "Acesso da equipe"
                  : mode === "login" ? "Bem-vindo de volta" : "Criar conta"}
              </h1>

              <p>
                {waiterMode
                  ? mode === "reset"
                    ? "Enviaremos um link de recuperação para o e-mail cadastrado pelo gestor."
                    : "Entre com a senha temporária fornecida pelo gestor. No primeiro acesso, você vai criar sua senha pessoal."
                  : mode === "login"
                    ? "Entre para administrar seu restaurante."
                    : "Comece a gerenciar seu restaurante com o Servia."}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {mode === "register" && !waiterMode && (
              <div className="form-field">
                <label>Nome</label>

                <div className="input-wrapper">
                  <UserRound size={17} />

                  <input
                    type="text"
                    placeholder="Seu nome"
                    value={name}
                    onChange={(event) =>
                      setName(event.target.value)
                    }
                    required
                  />
                </div>
              </div>
            )}

            {!waiterMode && <div className="form-field">
              <label>E-mail</label>

              <div className="input-wrapper">
                <span className="input-at">@</span>

                <input
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(event) =>
                    setEmail(event.target.value)
                  }
                  required
                />
              </div>
            </div>}

            {waiterMode && (
              <div className="form-field">
                <label>Conta cadastrada pelo gestor</label>
                <div className="input-wrapper">
                  <input type="email" value={email} readOnly aria-label="E-mail da conta cadastrada" />
                </div>
              </div>
            )}

            <div className="form-field">
              <label>{waiterMode ? "Senha temporária ou atual" : "Senha"}</label>

              <div className="input-wrapper">
                <span className="password-dot">•••</span>

                <input
                  type="password"
                  placeholder={waiterMode ? "Digite a senha fornecida pelo gestor" : "Sua senha"}
                  value={password}
                  onChange={(event) =>
                    setPassword(event.target.value)
                  }
                  required
                />
              </div>
            </div>

            {error && (
              <div className="login-error">
                {error}
              </div>
            )}

            {notice && (
              <div className="login-notice" role="status">
                {notice}
              </div>
            )}

            <button
              type="submit"
              className="login-submit"
              disabled={loading}
            >
              {loading
                ? "Aguarde..."
                : waiterMode && mode === "register"
                  ? "Criar minha senha"
                  : mode === "login"
                  ? "Entrar no Servia"
                  : "Criar minha conta"}
            </button>
          </form>

          {mode === "reset" && (
            <div className="password-reset-form">
              <h3>Recuperar Senha</h3>
              <p>Digite seu e-mail para receber um link de redefinição de senha.</p>
              
              {!waiterMode && <div className="form-field">
                <label>E-mail</label>
                <div className="input-wrapper">
                  <span className="input-at">@</span>
                  <input
                    type="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
              </div>}

              <button
                type="button"
                className="login-submit"
                onClick={handlePasswordReset}
                disabled={loading}
              >
                {loading ? "Enviando..." : "Enviar E-mail de Recuperação"}
              </button>

              <button
                type="button"
                className="login-switch-button"
                onClick={() => {
                  setMode("login");
                  setError("");
                  setNotice("");
                }}
              >
                Voltar para o login
              </button>
            </div>
          )}

          {(mode !== "reset" || waiterMode) && (
            <div className="login-switch">
              <span>
                {mode === "login"
                  ? (waiterMode ? "Problemas para entrar?" : "Esqueceu sua senha?")
                  : "Já possui uma conta?"}
              </span>

              <button
                type="button"
                onClick={() => {
                  if (mode === "login") {
                    setMode("reset");
                  } else {
                    setMode("login");
                  }
                  setError("");
                  setNotice("");
                }}
              >
                {mode === "login" ? "Recuperar senha" : "Fazer login"}
              </button>
            </div>
          )}
        </div>

        <div className="login-footer">
          <span>Servia</span>
          <span>•</span>
          <span>Gestão inteligente para restaurantes</span>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   SIDEBAR
========================================================= */

function Sidebar({
  active,
  setActive,
  collapsed,
  setCollapsed,
  mobileOpen,
  setMobileOpen,
  user,
  systemAdmin,
}: {
  active: ModuleName;
  setActive: (value: ModuleName) => void;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (value: boolean) => void;
  user: User;
  systemAdmin: boolean;
}) {
  const mainMenu: {
    label: ModuleName;
    icon: ElementType;
  }[] = systemAdmin ? [
    {
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      label: "Restaurantes",
      icon: Store,
    },
    {
      label: "Caixa",
      icon: CircleDollarSign,
    },
    {
      label: "Relatórios",
      icon: BarChart3,
    },
  ] : [
    {
      label: "Dashboard",
      icon: LayoutDashboard,
    },
    {
      label: "Mesas",
      icon: Grid3X3,
    },
    {
      label: "Pedidos",
      icon: ClipboardList,
    },
    {
      label: "Atendimento",
      icon: BellRing,
    },
    {
      label: "Cardápio",
      icon: BookOpen,
    },
    {
      label: "Cozinha",
      icon: ChefHat,
    },
  ];

  const managementMenu: {
    label: ModuleName;
    icon: ElementType;
  }[] = systemAdmin ? [] : [
    {
      label: "Estoque",
      icon: Box,
    },
    {
      label: "Equipe",
      icon: Users,
    },
    {
      label: "Caixa",
      icon: CircleDollarSign,
    },
    {
      label: "Relatórios",
      icon: BarChart3,
    },
  ];

  const systemMenu: {
    label: ModuleName;
    icon: ElementType;
  }[] = systemAdmin ? [] : [
    {
      label: "Configurações",
      icon: Settings,
    },
  ];

  function renderItem(item: {
    label: ModuleName;
    icon: ElementType;
  }) {
    const Icon = item.icon;

    return (
      <button
        key={item.label}
        className={
          active === item.label
            ? "sidebar-item active"
            : "sidebar-item"
        }
        onClick={() => {
          setActive(item.label);
          setMobileOpen(false);
        }}
        title={collapsed ? item.label : undefined}
      >
        <Icon size={19} />

        {!collapsed && <span>{item.label}</span>}
      </button>
    );
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="mobile-sidebar-overlay"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={[
          "sidebar",
          collapsed ? "collapsed" : "",
          mobileOpen ? "mobile-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <UtensilsCrossed size={21} />
          </div>

          {!collapsed && (
            <div className="sidebar-brand-text">
              <strong>Servia</strong>
              <span>Restaurant OS</span>
            </div>
          )}

          <button
            className="sidebar-mobile-close"
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-content">
          <div className="sidebar-section">
            {!collapsed && (
              <span className="sidebar-section-title">
                {systemAdmin ? "GESTÃO FINANCEIRA" : "PRINCIPAL"}
              </span>
            )}

            {mainMenu.map(renderItem)}
          </div>

          {managementMenu.length > 0 && (
            <div className="sidebar-section">
              {!collapsed && (
                <span className="sidebar-section-title">
                  GESTÃO
                </span>
              )}

              {managementMenu.map(renderItem)}
            </div>
          )}

          {systemMenu.length > 0 && (
            <div className="sidebar-section">
              {!collapsed && (
                <span className="sidebar-section-title">
                  SISTEMA
                </span>
              )}

              {systemMenu.map(renderItem)}
            </div>
          )}
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">
              {(
                user.displayName ||
                user.email ||
                "S"
              )
                .charAt(0)
                .toUpperCase()}
            </div>

            {!collapsed && (
              <div className="sidebar-user-info">
                <strong>
                  {user.displayName || "Administrador"}
                </strong>

                <span>
                  {user.email || "Conta Servia"}
                </span>
              </div>
            )}
          </div>
        </div>

        <button
          className="sidebar-collapse-button"
          onClick={() => setCollapsed(!collapsed)}
          title={
            collapsed
              ? "Expandir menu"
              : "Recolher menu"
          }
        >
          {collapsed ? (
            <ChevronRight size={17} />
          ) : (
            <ChevronLeft size={17} />
          )}
        </button>
      </aside>
    </>
  );
}

/* =========================================================
   TOPBAR
========================================================= */

function Topbar({
  active,
  user,
  onLogout,
  onOpenMobile,
}: {
  active: ModuleName;
  user: User;
  onLogout: () => void;
  onOpenMobile: () => void;
}) {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          className="mobile-menu-button"
          onClick={onOpenMobile}
        >
          <Menu size={21} />
        </button>

        <div>
          <span className="breadcrumb-home">
            Servia
          </span>

          <span className="breadcrumb-separator">
            /
          </span>

          <strong>{active}</strong>
        </div>
      </div>

      <div className="topbar-right">
        <div className={`connection-status ${online ? "online" : "offline"}`} role="status">
          <span />
          {online ? "Online" : "Offline"}
        </div>
        <button
          className="notification-button"
          title="Notificações"
        >
          <Bell size={18} />
          <span className="notification-dot" />
        </button>

        <div className="topbar-profile">
          <div className="topbar-avatar">
            {(
              user.displayName ||
              user.email ||
              "S"
            )
              .charAt(0)
              .toUpperCase()}
          </div>

          <div className="topbar-user">
            <strong>
              {user.displayName || "Administrador"}
            </strong>

            <span>Administrador</span>
          </div>
        </div>

        <button
          className="logout-button"
          onClick={onLogout}
          title="Sair"
        >
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}

/* =========================================================
   DASHBOARD
========================================================= */

function DashboardContent({
  setActive,
  systemAdmin = false,
  restaurantId,
}: {
  setActive: (value: ModuleName) => void;
  systemAdmin?: boolean;
  restaurantId: string;
}) {
  const [dashboardOrders, setDashboardOrders] = useState<any[]>([]);
  const [dashboardPayments, setDashboardPayments] = useState<any[]>([]);
  const [dashboardTables, setDashboardTables] = useState<any[]>([]);
  useEffect(() => {
    setDashboardOrders([]);
    setDashboardPayments([]);
    setDashboardTables([]);
    if (!restaurantId || systemAdmin) {
      return;
    }
    const stopOrders = onSnapshot(query(collection(db, "orders"), where("restaurantId", "==", restaurantId)), (snapshot) => {
      setDashboardOrders(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        .sort((a: any, b: any) => b.createdAt.toMillis() - a.createdAt.toMillis()));
    }, (error) => console.error("Erro ao carregar pedidos do dashboard:", error));
    const stopTables = onSnapshot(query(collection(db, "tables"), where("restaurantId", "==", restaurantId)), (snapshot) => {
      setDashboardTables(snapshot.docs.map((item) => item.data()).sort((a: any, b: any) => a.number - b.number));
    }, (error) => console.error("Erro ao carregar mesas do dashboard:", error));
    const stopPayments = onSnapshot(query(collection(db, "payments"), where("restaurantId", "==", restaurantId)), (snapshot) => {
      setDashboardPayments(snapshot.docs.map((item) => item.data()));
    }, (error) => console.error("Erro ao carregar pagamentos do dashboard:", error));
    return () => { stopOrders(); stopTables(); stopPayments(); };
  }, [restaurantId, systemAdmin]);

  if (systemAdmin) {
    // Dashboard de gestão financeira para administrador
    return (
      <div className="dashboard-page">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">
              GESTÃO FINANCEIRA
            </span>

            <h1>Bom dia, administrador.</h1>

            <p>
              Visão geral financeira dos restaurantes cadastrados no Servia.
            </p>
          </div>

          <div className="dashboard-date">
            <span>HOJE</span>

            <strong>
              {new Date().toLocaleDateString(
                "pt-BR",
                {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                },
              )}
            </strong>
          </div>
        </div>

        <div className="dashboard-stats">
          <div className="dashboard-stat">
            <div className="stat-icon green">
              <CircleDollarSign size={20} />
            </div>

            <div>
              <span>Receita Mensal</span>

              <strong>R$ 0,00</strong>

              <small className="positive">
                +15,2% vs. mês anterior
              </small>
            </div>
          </div>

          <div className="dashboard-stat">
            <div className="stat-icon orange">
              <Store size={20} />
            </div>

            <div>
              <span>Restaurantes Ativos</span>

              <strong>0</strong>

              <small className="positive">
                +3 novos este mês
              </small>
            </div>
          </div>

          <div className="dashboard-stat">
            <div className="stat-icon blue">
              <BarChart3 size={20} />
            </div>

            <div>
              <span>Pagamentos Pendentes</span>

              <strong>R$ 0,00</strong>

              <small className="neutral">
                5 aguardando confirmação
              </small>
            </div>
          </div>

          <div className="dashboard-stat">
            <div className="stat-icon purple">
              <Users size={20} />
            </div>

            <div>
              <span>Total de Usuários</span>

              <strong>0</strong>

              <small className="positive">
                +12 novos usuários
              </small>
            </div>
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-card">
            <div className="card-header">
              <div>
                <h3>Ações Rápidas</h3>
                <p>Gerencie seus restaurantes e finanças</p>
              </div>
            </div>

            <div className="dashboard-actions">
              <button
                className="dashboard-action-btn"
                onClick={() => setActive("Restaurantes")}
              >
                <Store size={24} />
                <span>Cadastrar Restaurante</span>
                <small>Adicionar novo estabelecimento</small>
              </button>

              <button
                className="dashboard-action-btn"
                onClick={() => setActive("Caixa")}
              >
                <CircleDollarSign size={24} />
                <span>Ver Movimentações</span>
                <small>Consultar entradas e saídas</small>
              </button>

              <button
                className="dashboard-action-btn"
                onClick={() => setActive("Relatórios")}
              >
                <BarChart3 size={24} />
                <span>Relatórios Financeiros</span>
                <small>Análise de receitas e despesas</small>
              </button>
            </div>
          </div>

          <div className="dashboard-card">
            <div className="card-header">
              <div>
                <h3>Últimos Pagamentos</h3>
                <p>Restaurantes que pagaram recentemente</p>
              </div>
            </div>

            <div className="payment-list">
              <div className="empty-state">Nenhum pagamento registrado.</div>
              {/*
              <div className="payment-item">
                <div className="payment-info">
                  <strong>Restaurante ABC</strong>
                  <small>Plano Mensal</small>
                </div>
                <div className="payment-amount positive">
                  +R$ 100,00
                </div>
              </div>

              <div className="payment-item">
                <div className="payment-info">
                  <strong>Pizzaria do João</strong>
                  <small>Plano Mensal</small>
                </div>
                <div className="payment-amount positive">
                  +R$ 100,00
                </div>
              </div>

              <div className="payment-item">
                <div className="payment-info">
                  <strong>Churrascaria Sul</strong>
                  <small>Plano Mensal</small>
                </div>
                <div className="payment-amount positive">
                  +R$ 100,00
                </div>
              </div>

              <div className="payment-item">
                <div className="payment-info">
                  <strong>Café Central</strong>
                  <small>Plano Mensal</small>
                </div>
                <div className="payment-amount positive">
                  +R$ 100,00
                </div>
              </div>
              */}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard operacional para restaurantes
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const ordersToday = dashboardOrders.filter((order) => order.createdAt?.toDate && order.createdAt.toDate() >= today && order.createdAt.toDate() < tomorrow);
  const openOrders = dashboardOrders.filter((order) => order.status !== "cancelado" && order.paymentStatus !== "paid");
  const dashboardTablesView = dashboardTables.map((table) => {
    const tableOrders = openOrders.filter((order) => order.tableNumber === table.number);
    return tableOrders.length > 0
      ? { ...table, status: "ocupada", total: tableOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0) }
      : table;
  });
  const occupied = dashboardTablesView.filter((table) => table.status === "ocupada").length;
  const free = dashboardTablesView.filter((table) => table.status === "livre").length;
  const reserved = dashboardTablesView.filter((table) => table.status === "reservada").length;
  const completedToday = dashboardPayments.filter((payment) => payment.status === "completed" && payment.createdAt?.toDate && payment.createdAt.toDate() >= today && payment.createdAt.toDate() < tomorrow);
  const salesToday = completedToday.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const openTablesTotal = dashboardTablesView.filter((table) => table.status === "ocupada").reduce((sum, table) => sum + (Number(table.total) || 0), 0);

  return (
    <div className="dashboard-page">
      <div className="dashboard-heading">
        <div>
          <span className="eyebrow">
            VISÃO GERAL
          </span>

          <h1>Bom dia, administrador.</h1>

          <p>
            Aqui está o resumo da operação do seu
            restaurante.
          </p>
        </div>

        <div className="dashboard-date">
          <span>HOJE</span>

          <strong>
            {new Date().toLocaleDateString(
              "pt-BR",
              {
                day: "2-digit",
                month: "long",
                year: "numeric",
              },
            )}
          </strong>
        </div>
      </div>

      <div className="dashboard-stats">
        <div className="dashboard-stat">
          <div className="stat-icon green">
            <CircleDollarSign size={20} />
          </div>

          <div>
            <span>Vendas hoje</span>

            <strong>{formatCurrency(salesToday)}</strong>

            <small className="neutral">
              {completedToday.length} venda(s) concluída(s)
            </small>
          </div>
        </div>

        <div className="dashboard-stat">
          <div className="stat-icon orange">
            <ClipboardList size={20} />
          </div>

          <div>
            <span>Pedidos hoje</span>

            <strong>{ordersToday.length}</strong>

            <small className="positive">
              Pedidos registrados hoje
            </small>
          </div>
        </div>

        <div className="dashboard-stat">
          <div className="stat-icon blue">
            <Grid3X3 size={20} />
          </div>

          <div>
            <span>Mesas ocupadas</span>

            <strong>
              {occupied}/{dashboardTables.length}
            </strong>

            <small>
              {free} livres · {reserved} reservadas
            </small>
          </div>
        </div>

        <div className="dashboard-stat">
          <div className="stat-icon purple">
            <ShoppingBag size={20} />
          </div>

          <div>
            <span>Comandas abertas</span>

            <strong>{openOrders.length}</strong>

            <small>
              {formatCurrency(openTablesTotal)} em pedidos não pagos
            </small>
          </div>
        </div>
      </div>

      <div className="dashboard-main-grid">
        <section className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <h2>Mapa das mesas</h2>

              <p>
                Acompanhe o salão em tempo real.
              </p>
            </div>

            <button
              className="panel-link"
              onClick={() => setActive("Mesas")}
            >
              Ver mapa completo
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="dashboard-tables">
            {dashboardTablesView.length === 0 ? (
              <div className="empty-state">
                <strong>Nenhuma mesa cadastrada</strong>
                <p>Cadastre mesas no módulo Mesas para visualizar o mapa.</p>
              </div>
            ) : (
              dashboardTablesView.map((table) => (
                <button
                  key={table.number}
                  className={getTableClass(
                    table.status as TableStatus,
                  )}
                  onClick={() => setActive("Mesas")}
                >
                  <div className="dashboard-table-number">
                    {table.number}
                  </div>

                  <div className="dashboard-table-info">
                    <strong>
                      Mesa {table.number}
                    </strong>

                    {table.status === "ocupada" && (
                      <>
                        <span>
                          {table.customer}
                        </span>

                        <small>
                          {formatCurrency(
                            table.total,
                          )}
                        </small>
                      </>
                    )}

                    {table.status === "livre" && (
                      <span>Disponível</span>
                    )}

                    {table.status === "reservada" && (
                      <span>Reservada</span>
                    )}
                  </div>

                  <span className="dashboard-table-status">
                    {table.status === "ocupada"
                      ? "Ocupada"
                      : table.status === "livre"
                        ? "Livre"
                        : "Reserva"}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="dashboard-panel">
          <div className="panel-heading">
            <div>
              <h2>Pedidos recentes</h2>

              <p>
                Últimas movimentações.
              </p>
            </div>

            <button
              className="panel-link"
              onClick={() =>
                setActive("Pedidos")
              }
            >
              Ver todos
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="recent-orders">
            {dashboardOrders.length === 0 ? (
              <div className="empty-state">
                <strong>Nenhum pedido registrado</strong>
                <p>Os pedidos aparecerão aqui quando forem criados.</p>
              </div>
            ) : (
              dashboardOrders.map((order) => (
                <div
                  className="recent-order"
                  key={order.id}
                >
                  <div className="order-number">
                    {order.id}
                  </div>

                  <div className="order-main">
                    <strong>
                      Mesa {order.tableNumber} ·{" "}
                      {order.items[0]?.name || "Cliente"}
                    </strong>

                    <span>{order.items.map((i: any) => `${i.quantity}x ${i.name}`).join(" + ")}</span>
                  </div>

                  <div className="order-right">
                    <strong>
                      {formatCurrency(
                        order.total,
                      )}
                    </strong>

                    <span
                      className={getStatusClass(
                        order.status,
                      )}
                    >
                      {order.status === "preparando" ? "Preparando" :
                       order.status === "pronto" ? "Pronto" :
                       order.status === "entregue" ? "Entregue" : order.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="quick-actions-panel">
        <div className="panel-heading">
          <div>
            <h2>Ações rápidas</h2>

            <p>
              Acesse as principais funções.
            </p>
          </div>
        </div>

        <div className="quick-actions">
          <button
            onClick={() => setActive("Mesas")}
          >
            <Grid3X3 size={20} />

            <span>Mapa de mesas</span>

            <small>
              QR Code · Tap · Comanda
            </small>
          </button>

          <button
            onClick={() =>
              setActive("Pedidos")
            }
          >
            <ClipboardList size={20} />

            <span>Novo pedido</span>

            <small>
              Registrar atendimento
            </small>
          </button>

          <button
            onClick={() =>
              setActive("Cardápio")
            }
          >
            <BookOpen size={20} />

            <span>Editar cardápio</span>

            <small>
              Produtos e categorias
            </small>
          </button>

          <button
            onClick={() => setActive("Caixa")}
          >
            <Calculator size={20} />

            <span>Abrir caixa</span>

            <small>
              Controle financeiro
            </small>
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   MÓDULOS
========================================================= */

function ModulePage({
  title,
}: {
  title: ModuleName;
}) {
  const config: Record<
    ModuleName,
    {
      icon: ElementType;
      description: string;
    }
  > = {
    Dashboard: {
      icon: LayoutDashboard,
      description:
        "Visão geral do restaurante.",
    },

    Mesas: {
      icon: Grid3X3,
      description: "Controle de mesas.",
    },

    "Giro de Mesa": {
      icon: Timer,
      description: "Otimização de tempo de mesa.",
    },

    Pedidos: {
      icon: ClipboardList,
      description:
        "Pedidos e comandas.",
    },

    Atendimento: {
      icon: BellRing,
      description: "Chamados e pedidos de conta das mesas.",
    },

    Cardápio: {
      icon: BookOpen,
      description:
        "Produtos e categorias.",
    },

    Cozinha: {
      icon: ChefHat,
      description:
        "Operação da cozinha.",
    },

    Estoque: {
      icon: Box,
      description:
        "Controle de estoque.",
    },

    Equipe: {
      icon: Users,
      description:
        "Garçons e funcionários.",
    },

    Caixa: {
      icon: CircleDollarSign,
      description:
        "Controle financeiro.",
    },

    Relatórios: {
      icon: BarChart3,
      description:
        "Relatórios e indicadores.",
    },

    Configurações: {
      icon: Settings,
      description:
        "Configurações do restaurante.",
    },

    Restaurantes: {
      icon: Store,
      description: "Cadastro, cobrança e liberação de acesso.",
    },
  };

  const Icon = config[title].icon;

  return (
    <div className="empty-module-page">
      <div className="empty-module-icon">
        <Icon size={30} />
      </div>

      <span className="eyebrow">
        MÓDULO SERVIA
      </span>

      <h1>{title}</h1>

      <p>{config[title].description}</p>

      <div className="coming-soon">
        <span>EM DESENVOLVIMENTO</span>
      </div>
    </div>
  );
}

/* =========================================================
   APLICAÇÃO ADMINISTRATIVA
========================================================= */

function AdminApplication({
  user,
  systemAdmin,
  restaurantId,
  onSelectRestaurant,
}: {
  user: User;
  systemAdmin: boolean;
  restaurantId: string;
  onSelectRestaurant: (restaurantId: string) => void;
}) {
  const [active, setActive] =
    useState<ModuleName>(systemAdmin ? "Restaurantes" : "Dashboard");

  const [collapsed, setCollapsed] =
    useState(false);

  const [mobileOpen, setMobileOpen] =
    useState(false);

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(error);
    }
  }

  function renderContent() {
    if (active === "Restaurantes" && systemAdmin) {
      return (
        <RestaurantsModule
          onOpenRestaurant={(selectedId) => {
            onSelectRestaurant(selectedId);
            setActive("Dashboard");
          }}
        />
      );
    }

    if (active === "Dashboard") {
      return (
        <DashboardContent
          setActive={setActive}
          systemAdmin={systemAdmin}
          restaurantId={restaurantId}
        />
      );
    }

    if (active === "Mesas") {
      return <TablesModule />;
    }

    if (active === "Giro de Mesa") {
      return <TableTurnoverModule />;
    }

    if (active === "Pedidos") {
      return <OrdersModule />;
    }

    if (active === "Atendimento") {
      return <WaiterModule user={user} showTurnover />;
    }

    if (active === "Cardápio") {
      return <MenuModule />;
    }

    if (active === "Cozinha") {
      return <KitchenModule />;
    }

    if (active === "Configurações") {
      return <SettingsModule />;
    }

    if (active === "Estoque") {
      return <StockModule />;
    }

    if (active === "Equipe") {
      return <TeamModule />;
    }

    if (active === "Caixa") {
      return <CashModule />;
    }

    if (active === "Relatórios") {
      return <ReportsModule />;
    }

    return <ModulePage title={active} />;
  }

  return (
    <RestaurantProvider value={{ restaurantId, systemAdmin, setRestaurantId: onSelectRestaurant }}>
    <div className="app-shell">
      <Sidebar
        active={active}
        setActive={setActive}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        user={user}
        systemAdmin={systemAdmin}
      />

      <div
        className={
          collapsed
            ? "app-main sidebar-collapsed"
            : "app-main"
        }
      >
        <Topbar
          active={active}
          user={user}
          onLogout={handleLogout}
          onOpenMobile={() =>
            setMobileOpen(true)
          }
        />

        <main className="content-area">
          {renderContent()}
        </main>
      </div>
    </div>
    </RestaurantProvider>
  );
}

function WaiterPortal({ user, waiterId, restaurantId }: { user: User; waiterId: string; restaurantId: string }) {
  return (
    <RestaurantProvider value={{ restaurantId, systemAdmin: false, setRestaurantId: () => undefined }}>
    <div className="waiter-mobile-shell">
      <header className="waiter-mobile-header">
        <div>
          <strong>Servia</strong>
          <span>{user.displayName || "Atendimento do salão"}</span>
        </div>
        <ConnectionStatus />
        <button type="button" onClick={() => void signOut(auth)} aria-label="Sair">
          <LogOut size={19} />
        </button>
      </header>
      <main className="waiter-mobile-content">
        <WaiterModule user={user} waiterId={waiterId} />
      </main>
    </div>
    </RestaurantProvider>
  );
}

function ConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const markOnline = () => setOnline(true);
    const markOffline = () => setOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  return (
    <div className={`connection-status ${online ? "online" : "offline"}`} role="status">
      <span />
      {online ? "Online" : "Offline"}
    </div>
  );
}

function EmailVerificationPage({ user }: { user: User }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function resendEmail() {
    setBusy(true);
    try {
      await sendEmailVerification(user);
      setMessage("Enviamos um novo e-mail de confirmação.");
    } catch {
      setMessage("Não foi possível enviar o e-mail agora.");
    } finally {
      setBusy(false);
    }
  }

  async function checkVerification() {
    setBusy(true);
    try {
      await reload(user);
      await user.getIdToken(true);
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-card-icon"><UserRound size={22} /></div>
            <div>
              <h1>Confirme seu e-mail</h1>
              <p>Confirme {user.email} para ativar o acesso ao Servia.</p>
            </div>
          </div>
          {message && <div className="login-notice" role="status">{message}</div>}
          <button className="login-submit" type="button" disabled={busy} onClick={() => void resendEmail()}>
            Reenviar confirmação
          </button>
          <button className="login-secondary-action" type="button" disabled={busy} onClick={() => void checkVerification()}>
            Já confirmei
          </button>
          <button className="login-switch-button" type="button" onClick={() => void signOut(auth)}>
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

function RestrictedAccessPage({ message }: { message: string }) {
  return (
    <div className="loading-screen">
      <div className="loading-logo"><UtensilsCrossed size={26} /></div>
      <strong>Acesso não autorizado</strong>
      <span>{message}</span>
      <button className="secondary-button" type="button" onClick={() => void signOut(auth)}>
        Sair
      </button>
    </div>
  );
}

function WaiterPasswordChange({ user, waiterId, onComplete }: {
  user: User;
  waiterId: string;
  onComplete: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("As senhas não são iguais.");
      return;
    }

    setBusy(true);
    try {
      await updatePassword(user, password);
      await updateDoc(doc(db, "waiters", waiterId), { mustChangePassword: false });
      onComplete();
    } catch (changeError) {
      console.error("Não foi possível alterar a senha temporária:", changeError);
      setError("Não foi possível atualizar sua senha. Entre novamente com a senha temporária e tente outra vez.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-card-icon"><UserRound size={22} /></div>
            <div>
              <h1>Crie sua senha pessoal</h1>
              <p>A senha temporária do gestor só pode ser usada neste primeiro acesso.</p>
            </div>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label>Nova senha</label>
              <div className="input-wrapper">
                <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} placeholder="Mínimo de 6 caracteres" />
              </div>
            </div>
            <div className="form-field">
              <label>Confirme a nova senha</label>
              <div className="input-wrapper">
                <input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={6} placeholder="Digite a senha novamente" />
              </div>
            </div>
            {error && <div className="login-error" role="alert">{error}</div>}
            <button className="login-submit" type="submit" disabled={busy}>
              {busy ? "Atualizando..." : "Salvar senha e abrir sistema"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   APP PRINCIPAL
========================================================= */

export default function App() {
  const waiterRouteMatch = window.location.pathname.match(/^\/garcom\/([^/]+)\/([^/]+)\/?$/);
  const waiterRestaurantRouteId = waiterRouteMatch?.[1] || "";
  const waiterRouteId = waiterRouteMatch?.[2] || "";
  const waiterEmail = new URLSearchParams(window.location.search).get("email") || "";
  const [user, setUser] =
    useState<User | null>(null);

  const [loading, setLoading] =
    useState(true);
  const [access, setAccess] = useState<"admin" | "restaurant" | "restaurant-pending" | "waiter" | "waiter-password-change" | "verification" | "blocked" | "signed-out">("signed-out");
  const [waiterId, setWaiterId] = useState("");
  const [restaurantId, setRestaurantId] = useState(() => localStorage.getItem("servia-active-restaurant") || "");
  const [pendingRestaurantName, setPendingRestaurantName] = useState("");
  const [pendingPaymentAmount, setPendingPaymentAmount] = useState(600);
  const [accessMessage, setAccessMessage] = useState("Entre com uma conta cadastrada para a equipe Servia.");

  function selectRestaurant(id: string) {
    setRestaurantId(id);
    localStorage.setItem("servia-active-restaurant", id);
  }

  useEffect(() => {
    const unsubscribe =
      onAuthStateChanged(
        auth,
        async (currentUser) => {
          setUser(currentUser);
          if (!currentUser) {
            setAccess("signed-out");
            setWaiterId("");
            setAccessMessage("Entre com uma conta cadastrada para a equipe Servia.");
            setLoading(false);
            return;
          }

          startTransition(() => setLoading(true));
          try {
            if (
              currentUser.uid === ownerIdentity.uid &&
              currentUser.email === ownerIdentity.email
            ) {
              setAccess("admin");
            } else {
              const restaurantSnapshot = await getDoc(doc(db, "restaurants", currentUser.uid));
              const restaurantData = restaurantSnapshot.data();
              if (
                restaurantSnapshot.exists() &&
                restaurantData?.ownerEmail === currentUser.email
              ) {
                setRestaurantId(currentUser.uid);
                setPendingRestaurantName(String(restaurantData.name || "Restaurante"));
                const monthlyPaidUntil = restaurantData.monthlyPaidUntil?.toDate?.() as Date | undefined;
                setPendingPaymentAmount(monthlyPaidUntil ? 100 : 600);
                const isPaid = restaurantData.status === "active" && monthlyPaidUntil && monthlyPaidUntil.getTime() > Date.now();
                setAccess(isPaid ? "restaurant" : "restaurant-pending");
              } else if (!waiterRouteId && !currentUser.emailVerified) {
                setAccess("verification");
              } else {
                let memberSnapshot;
                let matchingMembers;
                if (waiterRouteId) {
                  const memberRef = doc(db, "waiters", waiterRouteId);
                  try {
                    await updateDoc(memberRef, {
                      uid: currentUser.uid,
                      email: currentUser.email,
                    });
                  } catch {
                    // Existing links are read-only after the first account claims them.
                  }
                  memberSnapshot = await getDoc(memberRef);
                } else {
                  matchingMembers = await getDocs(query(
                    collection(db, "waiters"),
                    where("uid", "==", currentUser.uid),
                    where("active", "==", true),
                  ));
                }
                const memberData = memberSnapshot?.data() ?? matchingMembers?.docs[0]?.data();
                const matchedWaiterId = memberSnapshot?.id ?? matchingMembers?.docs[0]?.id ?? "";

                if (
                  memberData?.active === true &&
                  memberData.uid === currentUser.uid &&
                  memberData.email === currentUser.email &&
                  memberData.restaurantId === waiterRestaurantRouteId &&
                  matchedWaiterId
                ) {
                  setWaiterId(matchedWaiterId);
                  setRestaurantId(String(memberData.restaurantId || ""));
                  setAccess(memberData.mustChangePassword === true ? "waiter-password-change" : "waiter");
                } else {
                  setWaiterId("");
                  setAccessMessage("Não encontramos um cadastro ativo para esta conta. Abra o QR individual enviado pelo administrador.");
                  setAccess("blocked");
                }
              }
            }
          } catch (authError) {
            console.error("Erro ao validar acesso Servia:", authError);
            if (auth.currentUser?.uid === currentUser.uid) {
              const errorCode = typeof authError === "object" && authError && "code" in authError
                ? String((authError as { code: string }).code)
                : "";
              setAccessMessage(
                errorCode === "permission-denied"
                  ? "Não foi possível vincular o acesso. Confira se o QR pertence ao seu cadastro ativo."
                  : "Não foi possível validar esta conta no Firebase. Confira a conexão e tente novamente.",
              );
              setAccess("blocked");
            }
          } finally {
            if (auth.currentUser?.uid === currentUser.uid) {
              setLoading(false);
            }
          }
        },
      );

    return unsubscribe;
  }, [waiterRestaurantRouteId, waiterRouteId]);

  useEffect(() => {
    if (!user) {
      return;
    }

    // Não verificar pagamento se for o admin
    if (user.uid === ownerIdentity.uid && user.email === ownerIdentity.email) {
      return;
    }

    let expiryTimeout = 0;
    const unsubscribe = onSnapshot(doc(db, "restaurants", user.uid), (snapshot) => {
      const data = snapshot.data();
      const paidUntil = data?.monthlyPaidUntil?.toDate?.() as Date | undefined;
      const status = data?.status;
      const now = Date.now();
      const valid = status === "active" && paidUntil && paidUntil.getTime() > now;

      if (!valid) {
        setPendingPaymentAmount(paidUntil ? 100 : 600);
        setAccess("restaurant-pending");
        return;
      }

      // Se estava pending e agora é válido, mudar para restaurant
      if (access === "restaurant-pending" && valid) {
        setAccess("restaurant");
        // Forçar re-renderização imediata
        setTimeout(() => setAccess("restaurant"), 0);
      }

      window.clearTimeout(expiryTimeout);
      expiryTimeout = window.setTimeout(() => {
        setPendingPaymentAmount(100);
        setAccess("restaurant-pending");
      }, Math.max(0, paidUntil.getTime() - Date.now()));
    });

    return () => {
      window.clearTimeout(expiryTimeout);
      unsubscribe();
    };
  }, [user]);

  /*
   * IMPORTANTE:
   *
   * /mesa/5
   * /mesa/05
   *
   * são rotas públicas usadas pelo QR Code
   * e pelo NFC/Tap.
   *
   * Elas não exigem login administrativo.
   */

  const tableMatch =
    window.location.pathname.match(
      /^\/mesa\/([^/]+)\/(\d+)\/?$/,
    );

  if (tableMatch) {
    return (
      <CustomerTable
        restaurantId={tableMatch[1]}
        tableNumber={Number(tableMatch[2])}
      />
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">
          <UtensilsCrossed size={26} />
        </div>

        <div className="loading-spinner" />

        <span>
          Carregando Servia...
        </span>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen waiterMode={Boolean(waiterRouteId)} waiterEmail={waiterEmail} />;
  }

  if (access === "waiter-password-change") {
    return <WaiterPasswordChange user={user} waiterId={waiterId} onComplete={() => setAccess("waiter")} />;
  }

  if (access === "waiter") {
    return <WaiterPortal user={user} waiterId={waiterId} restaurantId={restaurantId} />;
  }

  if (access === "verification") {
    return <EmailVerificationPage user={user} />;
  }

  if (access === "restaurant-pending") {
    return (
      <div className="loading-screen restaurant-payment-gate">
        <div className="loading-logo"><CircleDollarSign size={26} /></div>
        <strong>{pendingRestaurantName}</strong>
        <span>Pagamento Pix pendente de confirmação do administrador.</span>
        <span>Valor para liberar/renovar: {formatCurrency(pendingPaymentAmount)}.</span>
        <strong>Chave Pix: finho60@hotmail.com</strong>
        <div className="payment-actions">
          <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
            Verificar pagamento
          </button>
          <button className="secondary-button" type="button" onClick={() => void signOut(auth)}>Sair</button>
        </div>
      </div>
    );
  }

  if (access !== "admin" && access !== "restaurant") {
    return <RestrictedAccessPage message={accessMessage} />;
  }

  return (
    <AdminApplication
      user={user}
      systemAdmin={user.uid === ownerIdentity.uid}
      restaurantId={restaurantId}
      onSelectRestaurant={selectRestaurant}
    />
  );
}
