import { lazy, Suspense, startTransition, useEffect, useState, type ElementType, type FormEvent } from "react";

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
  KeyRound,
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
  signInWithCustomToken,
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

import CustomerTable from "./components/CustomerTable";
const TablesModule = lazy(() => import("./components/TablesModule"));
const OrdersModule = lazy(() => import("./components/OrdersModule"));
const MenuModule = lazy(() => import("./components/MenuModule"));
const KitchenModule = lazy(() => import("./components/KitchenModule"));
const SettingsModule = lazy(() => import("./components/SettingsModule"));
const TableTurnoverModule = lazy(() => import("./components/TableTurnoverModule"));
const StockModule = lazy(() => import("./components/StockModule"));
const TeamModule = lazy(() => import("./components/TeamModule"));
const CashModule = lazy(() => import("./components/CashModule"));
const ReportsModule = lazy(() => import("./components/ReportsModule"));
const WaiterModule = lazy(() => import("./components/WaiterModule"));
const RestaurantsModule = lazy(() => import("./components/RestaurantsModule"));
import { RestaurantProvider } from "./contexts/RestaurantContext";

import { formatCurrency } from "./utils/format";
import type { TableStatus } from "./types/table";
import { normalizeStaffRole, type StaffRole } from "./types/roles";
import { calculateOrderTotal } from "./utils/orders";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { employeeApi } from "./utils/employeeApi";

type ModuleName =
  | "Dashboard"
  | "Mesas"
  | "Giro de Mesa"
  | "Pedidos"
  | "Atendimento"
  | "Restaurantes"
  | "CardÃ¡pio"
  | "Cozinha"
  | "Estoque"
  | "FuncionÃ¡rios"
  | "Caixa"
  | "RelatÃ³rios"
  | "ConfiguraÃ§Ãµes";

/* =========================================================
   FUNÃ‡Ã•ES AUXILIARES
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

const systemOwnerUid = "KVoJiEGKnnceyADEqFhcflynohr2";

function isSystemOwner(user: Pick<User, "uid" | "email"> | null | undefined): boolean {
  return user?.uid === systemOwnerUid;
}

/* =========================================================
   LOGIN
========================================================= */

function EmployeePinLogin({
  restaurantId = "",
  waiterId = "",
  onBack,
}: {
  restaurantId?: string;
  waiterId?: string;
  onBack: () => void;
}) {
  const isQrLogin = Boolean(restaurantId && waiterId);
  const [employeeCode, setEmployeeCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleEmployeeLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await employeeApi<{ token: string }>("login", isQrLogin
        ? { restaurantId, waiterId, pin }
        : { employeeCode, pin }, false);
      await signInWithCustomToken(auth, result.token);
    } catch (loginError) {
      const code = typeof loginError === "object" && loginError && "code" in loginError
        ? String((loginError as { code: string }).code)
        : "";
      setError(code.endsWith("resource-exhausted")
        ? "Muitas tentativas. Aguarde 15 minutos e tente novamente."
        : "Identificação ou PIN incorretos, ou o acesso está inativo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-background-glow glow-one" />
      <div className="login-background-glow glow-two" />
      <div className="login-container">
        <div className="login-brand"><strong>Servia</strong><span>Gestão para restaurantes</span></div>
        <div className="login-card">
          <div className="login-card-header">
            <div className="login-card-icon"><Users size={22} /></div>
            <div>
              <h1>Acesso do funcionário</h1>
              <p>{isQrLogin ? "Digite seu PIN para abrir o acesso indicado pelo QR." : "Entre com seu ID de funcionário e PIN."}</p>
            </div>
          </div>
          <form onSubmit={(event) => void handleEmployeeLogin(event)}>
            {!isQrLogin && <div className="form-field">
              <label htmlFor="employee-code">ID do funcionário</label>
              <div className="input-wrapper"><input id="employee-code" name="employeeCode" autoComplete="username" value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value.toUpperCase())} required placeholder="FUNC-..." /></div>
            </div>}
            <div className="form-field">
              <label htmlFor="employee-pin">PIN</label>
              <div className="input-wrapper"><input id="employee-pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} required minLength={6} maxLength={8} pattern="[0-9]{6,8}" /></div>
            </div>
            {error && <div className="login-error" role="alert">{error}</div>}
            <button className="login-submit" type="submit" disabled={busy || (!isQrLogin && !employeeCode.trim()) || pin.length < 6}>
              {busy ? "Verificando..." : "Entrar"}
            </button>
            <button className="login-switch-button" type="button" onClick={onBack}>Voltar ao login</button>
          </form>
        </div>
        <div className="login-footer"><span>Servia</span><span>·</span><span>Atendimento para restaurantes</span></div>
      </div>
    </div>
  );
}

function LoginScreen({ waiterMode = false, waiterEmail = "", onEmployeeLogin }: { waiterMode?: boolean; waiterEmail?: string; onEmployeeLogin?: () => void } = {}) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");

  const [name, setName] = useState("");
  const [email, setEmail] = useState(waiterEmail);
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
      setNotice("E-mail de recuperaÃ§Ã£o enviado. Verifique sua caixa de entrada.");
      setMode("login");
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err && "code" in err
          ? String((err as { code: string }).code)
          : "";

      if (code === "auth/user-not-found") {
        setError("E-mail nÃ£o encontrado.");
      } else if (code === "auth/invalid-email") {
        setError("E-mail invÃ¡lido.");
      } else {
        setError("NÃ£o foi possÃ­vel enviar o e-mail de recuperaÃ§Ã£o.");
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
        setError(waiterMode ? "Senha temporÃ¡ria ou atual incorreta." : "E-mail ou senha incorretos.");
      } else if (code === "auth/email-already-in-use") {
        if (waiterMode && mode === "register") {
          setMode("login");
          setError("Este e-mail jÃ¡ tem uma conta. Entre com a senha que vocÃª criou.");
        } else {
          setError("Este e-mail jÃ¡ estÃ¡ cadastrado.");
        }
      } else if (code === "auth/weak-password") {
        setError(
          "A senha precisa ter pelo menos 6 caracteres.",
        );
      } else if (code === "auth/invalid-email") {
        setError("Digite um e-mail vÃ¡lido.");
      } else if (code === "auth/network-request-failed") {
        setError(
          "NÃ£o foi possÃ­vel conectar ao Firebase. Verifique sua internet.",
        );
      } else {
        setError(
          "NÃ£o foi possÃ­vel realizar a operaÃ§Ã£o. Tente novamente.",
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
            <span>Sistema de gestÃ£o para restaurantes</span>
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
                    ? "Enviaremos um link de recuperaÃ§Ã£o para o e-mail cadastrado pelo gestor."
                    : "Entre com a senha temporÃ¡ria fornecida pelo gestor. No primeiro acesso, vocÃª vai criar sua senha pessoal."
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
                    id="registration-name"
                    name="name"
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
                  id="account-email"
                  name="email"
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
                  <input id="waiter-account-email" name="email" type="email" value={email} readOnly aria-label="E-mail da conta cadastrada" />
                </div>
              </div>
            )}

            <div className="form-field">
              <label>{waiterMode ? "Senha temporÃ¡ria ou atual" : "Senha"}</label>

              <div className="input-wrapper">
                <span className="password-dot">â€¢â€¢â€¢</span>

                <input
                  id="account-password"
                  name="password"
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

          {!waiterMode && mode === "login" && onEmployeeLogin && (
            <button type="button" className="login-switch-button" onClick={onEmployeeLogin}>
              Entrar como funcionário com PIN
            </button>
          )}

          {mode === "reset" && (
            <div className="password-reset-form">
              <h3>Recuperar Senha</h3>
              <p>Digite seu e-mail para receber um link de redefiniÃ§Ã£o de senha.</p>
              
              {!waiterMode && <div className="form-field">
                <label>E-mail</label>
                <div className="input-wrapper">
                  <span className="input-at">@</span>
                  <input
                    id="recovery-email"
                    name="recoveryEmail"
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
                {loading ? "Enviando..." : "Enviar E-mail de RecuperaÃ§Ã£o"}
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
                  : "JÃ¡ possui uma conta?"}
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
          <span>â€¢</span>
          <span>GestÃ£o inteligente para restaurantes</span>
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
  staffRole,
}: {
  active: ModuleName;
  setActive: (value: ModuleName) => void;
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (value: boolean) => void;
  user: User;
  systemAdmin: boolean;
  staffRole?: StaffRole | null;
}) {
  const baseMainMenu: {
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
      label: "RelatÃ³rios",
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
      label: "CardÃ¡pio",
      icon: BookOpen,
    },
    {
      label: "Cozinha",
      icon: ChefHat,
    },
  ];

  const baseManagementMenu: {
    label: ModuleName;
    icon: ElementType;
  }[] = systemAdmin ? [] : [
    {
      label: "Estoque",
      icon: Box,
    },
    {
      label: "FuncionÃ¡rios",
      icon: Users,
    },
    {
      label: "Caixa",
      icon: CircleDollarSign,
    },
    {
      label: "RelatÃ³rios",
      icon: BarChart3,
    },
  ];

  const mainMenu = staffRole === "FLOOR_MANAGER"
    ? baseMainMenu.filter((item) => ["Mesas", "Pedidos", "Atendimento"].includes(item.label))
    : staffRole === "KITCHEN"
      ? baseMainMenu.filter((item) => item.label === "Cozinha")
      : staffRole === "CASHIER"
        ? baseMainMenu.filter((item) => item.label === "Mesas")
        : baseMainMenu;
  const managementMenu = staffRole === "FLOOR_MANAGER" || staffRole === "KITCHEN"
    ? []
    : staffRole === "CASHIER"
      ? [{ label: "Caixa" as ModuleName, icon: CircleDollarSign }]
      : baseManagementMenu;
  const systemMenu: {
    label: ModuleName;
    icon: ElementType;
  }[] = systemAdmin || staffRole === "KITCHEN" || staffRole === "CASHIER" || staffRole === "FLOOR_MANAGER" ? [] : [
    {
      label: "ConfiguraÃ§Ãµes",
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
                {systemAdmin ? "GESTÃƒO FINANCEIRA" : "PRINCIPAL"}
              </span>
            )}

        {mainMenu.map(renderItem)}
          </div>

          {managementMenu.length > 0 && (
            <div className="sidebar-section">
              {!collapsed && (
                <span className="sidebar-section-title">
                  GESTÃƒO
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
  onChangePin,
}: {
  active: ModuleName;
  user: User;
  onLogout: () => void;
  onOpenMobile: () => void;
  onChangePin?: () => void;
}) {
  const online = useOnlineStatus();

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
        {onChangePin && <button className="notification-button" title="Alterar PIN" aria-label="Alterar PIN" onClick={onChangePin}><KeyRound size={18} /></button>}
        <div className={`connection-status ${online ? "online" : "offline"}`} role="status">
          <span />
          {online ? "Online" : "Offline"}
        </div>
        <button
          className="notification-button"
          title="NotificaÃ§Ãµes"
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
    // Dashboard de gestÃ£o financeira para administrador
    return (
      <div className="dashboard-page">
        <div className="dashboard-heading">
          <div>
            <span className="eyebrow">
              GESTÃƒO FINANCEIRA
            </span>

            <h1>Bom dia, administrador.</h1>

            <p>
              VisÃ£o geral financeira dos restaurantes cadastrados no Servia.
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
            </div>
          </div>

          <div className="dashboard-stat">
            <div className="stat-icon orange">
              <Store size={20} />
            </div>

            <div>
              <span>Restaurantes Ativos</span>

              <strong>0</strong>
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
                5 aguardando confirmaÃ§Ã£o
              </small>
            </div>
          </div>

          <div className="dashboard-stat">
            <div className="stat-icon purple">
              <Users size={20} />
            </div>

            <div>
              <span>Total de UsuÃ¡rios</span>

              <strong>0</strong>

              <small className="positive">
                +12 novos usuÃ¡rios
              </small>
            </div>
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-card">
            <div className="card-header">
              <div>
                <h3>AÃ§Ãµes RÃ¡pidas</h3>
                <p>Gerencie seus restaurantes e finanÃ§as</p>
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
                <span>Ver MovimentaÃ§Ãµes</span>
                <small>Consultar entradas e saÃ­das</small>
              </button>

              <button
                className="dashboard-action-btn"
                onClick={() => setActive("RelatÃ³rios")}
              >
                <BarChart3 size={24} />
                <span>RelatÃ³rios Financeiros</span>
                <small>AnÃ¡lise de receitas e despesas</small>
              </button>
            </div>
          </div>

          <div className="dashboard-card">
            <div className="card-header">
              <div>
                <h3>Ãšltimos Pagamentos</h3>
                <p>Restaurantes que pagaram recentemente</p>
              </div>
            </div>

            <div className="payment-list">
              <div className="empty-state">Nenhum pagamento registrado.</div>
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
      ? { ...table, status: "ocupada", total: tableOrders.reduce((sum, order) => sum + calculateOrderTotal(Array.isArray(order.items) ? order.items : []), 0) }
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
            VISÃƒO GERAL
          </span>

          <h1>Bom dia, administrador.</h1>

          <p>
            Aqui estÃ¡ o resumo da operaÃ§Ã£o do seu
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
              {completedToday.length} venda(s) concluÃ­da(s)
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
              {free} livres Â· {reserved} reservadas
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
              {formatCurrency(openTablesTotal)} em pedidos nÃ£o pagos
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
                Acompanhe o salÃ£o em tempo real.
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
                <p>Cadastre mesas no mÃ³dulo Mesas para visualizar o mapa.</p>
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
                      <span>DisponÃ­vel</span>
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
                Ãšltimas movimentaÃ§Ãµes.
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
                <p>Os pedidos aparecerÃ£o aqui quando forem criados.</p>
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
                      Mesa {order.tableNumber} Â·{" "}
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
            <h2>AÃ§Ãµes rÃ¡pidas</h2>

            <p>
              Acesse as principais funÃ§Ãµes.
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
              QR Code Â· Tap Â· Comanda
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
              setActive("CardÃ¡pio")
            }
          >
            <BookOpen size={20} />

            <span>Editar cardÃ¡pio</span>

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
   MÃ“DULOS
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
        "VisÃ£o geral do restaurante.",
    },

    Mesas: {
      icon: Grid3X3,
      description: "Controle de mesas.",
    },

    "Giro de Mesa": {
      icon: Timer,
      description: "OtimizaÃ§Ã£o de tempo de mesa.",
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

    ["CardÃ¡pio"]: {
      icon: BookOpen,
      description:
        "Produtos e categorias.",
    },

    Cozinha: {
      icon: ChefHat,
      description:
        "OperaÃ§Ã£o da cozinha.",
    },

    Estoque: {
      icon: Box,
      description:
        "Controle de estoque.",
    },

    ["FuncionÃ¡rios"]: {
      icon: Users,
      description:
        "Cadastre funcionÃ¡rios e gerencie os acessos por QR code.",
    },

    Caixa: {
      icon: CircleDollarSign,
      description:
        "Controle financeiro.",
    },

    ["RelatÃ³rios"]: {
      icon: BarChart3,
      description:
        "RelatÃ³rios e indicadores.",
    },

    ["ConfiguraÃ§Ãµes"]: {
      icon: Settings,
      description:
        "ConfiguraÃ§Ãµes do restaurante.",
    },

    Restaurantes: {
      icon: Store,
      description: "Cadastro, cobranÃ§a e liberaÃ§Ã£o de acesso.",
    },
  };

  const Icon = config[title].icon;

  return (
    <div className="empty-module-page">
      <div className="empty-module-icon">
        <Icon size={30} />
      </div>

      <span className="eyebrow">
        MÃ“DULO SERVIA
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
   APLICAÃ‡ÃƒO ADMINISTRATIVA
========================================================= */

function AdminApplication({
  user,
  systemAdmin,
  staffRole,
  restaurantId,
  onSelectRestaurant,
}: {
  user: User;
  systemAdmin: boolean;
  staffRole?: StaffRole | null;
  restaurantId: string;
  onSelectRestaurant: (restaurantId: string) => void;
}) {
  const [showPinChange, setShowPinChange] = useState(false);
  const [active, setActive] =
    useState<ModuleName>(
      systemAdmin
        ? "Restaurantes"
        : staffRole === "KITCHEN"
          ? "Cozinha"
          : staffRole === "FLOOR_MANAGER"
            ? "Mesas"
          : staffRole === "CASHIER"
            ? "Caixa"
            : window.location.pathname.replace(/\/+$/, "").toLowerCase() === "/cozinha"
          ? "Cozinha"
          : "Dashboard",
    );

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
    const allowedModules = staffRole === "CASHIER"
      ? ["Mesas", "Caixa"]
      : staffRole === "KITCHEN"
        ? ["Cozinha"]
        : staffRole === "FLOOR_MANAGER"
          ? ["Mesas", "Pedidos", "Atendimento"]
          : null;
    if (allowedModules && !allowedModules.includes(active)) {
      return <RestrictedAccessPage message="Este módulo não está disponível para a função vinculada à sua conta." />;
    }

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
      return <WaiterModule user={user} showTurnover={staffRole !== "FLOOR_MANAGER"} />;
    }

    if (active === "CardÃ¡pio") {
      return <MenuModule />;
    }

    if (active === "Cozinha") {
      return <KitchenModule />;
    }

    if (active === "ConfiguraÃ§Ãµes") {
      return <SettingsModule />;
    }

    if (active === "Estoque") {
      return <StockModule />;
    }

    if (active === "FuncionÃ¡rios") {
      return <TeamModule />;
    }

    if (active === "Caixa") {
      return <CashModule />;
    }

    if (active === "RelatÃ³rios") {
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
        staffRole={staffRole}
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
          onChangePin={staffRole ? () => setShowPinChange(true) : undefined}
        />

        <main className="content-area">
          <Suspense fallback={<div className="loading-screen"><div className="loading-spinner" /><span>Carregando módulo...</span></div>}>{renderContent()}</Suspense>
        </main>
      </div>
    </div>
    {showPinChange && <EmployeePinChangeDialog onClose={() => setShowPinChange(false)} />}
    </RestaurantProvider>
  );
}

function EmployeePinChangeDialog({ onClose }: { onClose: () => void }) {
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPin !== confirmPin) { setMessage("Os PINs novos não coincidem."); return; }
    setBusy(true);
    try {
      await employeeApi("change-pin", { oldPin, newPin });
      setMessage("PIN alterado com sucesso.");
      setOldPin(""); setNewPin(""); setConfirmPin("");
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
      setMessage(code.endsWith("resource-exhausted") ? "Muitas tentativas. Aguarde e tente novamente." : "PIN atual incorreto ou não foi possível alterar agora.");
    } finally { setBusy(false); }
  }
  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="staff-pin-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><h2 id="staff-pin-title">Alterar meu PIN</h2><button type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button></div>
      <form onSubmit={(event) => void submit(event)}><div className="modal-body">
        <div className="form-field"><label htmlFor="staff-current-pin">PIN atual</label><input id="staff-current-pin" name="oldPin" type="password" inputMode="numeric" autoComplete="current-password" value={oldPin} onChange={(event) => setOldPin(event.target.value)} required minLength={6} maxLength={8} pattern="[0-9]{6,8}" /></div>
        <div className="form-field"><label htmlFor="staff-new-pin">Novo PIN</label><input id="staff-new-pin" name="newPin" type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(event) => setNewPin(event.target.value)} required minLength={6} maxLength={8} pattern="[0-9]{6,8}" /></div>
        <div className="form-field"><label htmlFor="staff-confirm-pin">Confirme o novo PIN</label><input id="staff-confirm-pin" name="confirmPin" type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} required minLength={6} maxLength={8} pattern="[0-9]{6,8}" /></div>
        {message && <div className="team-feedback" role="status">{message}</div>}
      </div><div className="modal-footer"><button className="secondary-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar PIN"}</button></div></form>
    </div>
  </div>;
}

function WaiterPortal({ user, waiterId, restaurantId }: { user: User; waiterId: string; restaurantId: string }) {
  const [showPinChange, setShowPinChange] = useState(false);
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinMessage, setPinMessage] = useState("");
  const [pinBusy, setPinBusy] = useState(false);

  async function handlePinChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPinMessage("");
    if (!/^\d{6,8}$/.test(newPin) || newPin !== confirmPin) {
      setPinMessage(newPin !== confirmPin ? "Os PINs novos não coincidem." : "O PIN precisa ter de 6 a 8 números.");
      return;
    }
    setPinBusy(true);
    try {
      await employeeApi("change-pin", { oldPin, newPin });
      setPinMessage("PIN alterado com sucesso.");
      setOldPin("");
      setNewPin("");
      setConfirmPin("");
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
      setPinMessage(code.endsWith("resource-exhausted") ? "Muitas tentativas. Aguarde e tente novamente." : "PIN atual incorreto ou não foi possível alterar agora.");
    } finally {
      setPinBusy(false);
    }
  }

  return (
    <RestaurantProvider value={{ restaurantId, systemAdmin: false, setRestaurantId: () => undefined }}>
    <div className="waiter-mobile-shell">
      <header className="waiter-mobile-header">
        <div>
          <strong>Servia</strong>
          <span>{user.displayName || "Atendimento do salÃ£o"}</span>
        </div>
        <ConnectionStatus />
        <button type="button" onClick={() => { setPinMessage(""); setShowPinChange(true); }} aria-label="Alterar PIN" title="Alterar PIN">
          <KeyRound size={19} />
        </button>
        <button type="button" onClick={() => void signOut(auth)} aria-label="Sair">
          <LogOut size={19} />
        </button>
      </header>
      <main className="waiter-mobile-content">
        <Suspense fallback={<div className="loading-screen"><div className="loading-spinner" /></div>}><WaiterModule user={user} waiterId={waiterId} /></Suspense>
      </main>
      {showPinChange && <div className="modal-overlay" onClick={() => setShowPinChange(false)}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="employee-pin-change-title" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header"><h2 id="employee-pin-change-title">Alterar meu PIN</h2><button type="button" onClick={() => setShowPinChange(false)} aria-label="Fechar"><X size={18} /></button></div>
          <form onSubmit={(event) => void handlePinChange(event)}>
            <div className="modal-body">
              <div className="form-field"><label htmlFor="current-employee-pin">PIN atual</label><input id="current-employee-pin" name="oldPin" type="password" inputMode="numeric" autoComplete="current-password" value={oldPin} onChange={(event) => setOldPin(event.target.value)} required minLength={6} maxLength={8} pattern="[0-9]{6,8}" /></div>
              <div className="form-field"><label htmlFor="new-employee-pin">Novo PIN</label><input id="new-employee-pin" name="newPin" type="password" inputMode="numeric" autoComplete="new-password" value={newPin} onChange={(event) => setNewPin(event.target.value)} required minLength={6} maxLength={8} pattern="[0-9]{6,8}" /></div>
              <div className="form-field"><label htmlFor="confirm-employee-pin">Confirme o novo PIN</label><input id="confirm-employee-pin" name="confirmPin" type="password" inputMode="numeric" autoComplete="new-password" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} required minLength={6} maxLength={8} pattern="[0-9]{6,8}" /></div>
              {pinMessage && <div className="team-feedback" role="status">{pinMessage}</div>}
            </div>
            <div className="modal-footer"><button className="secondary-button" type="button" onClick={() => setShowPinChange(false)}>Cancelar</button><button className="primary-button" type="submit" disabled={pinBusy}>{pinBusy ? "Salvando..." : "Salvar PIN"}</button></div>
          </form>
        </div>
      </div>}
    </div>
    </RestaurantProvider>
  );
}

function ConnectionStatus() {
  const online = useOnlineStatus();

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
      setMessage("Enviamos um novo e-mail de confirmaÃ§Ã£o.");
    } catch {
      setMessage("NÃ£o foi possÃ­vel enviar o e-mail agora.");
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
            Reenviar confirmaÃ§Ã£o
          </button>
          <button className="login-secondary-action" type="button" disabled={busy} onClick={() => void checkVerification()}>
            JÃ¡ confirmei
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
      <strong>Acesso nÃ£o autorizado</strong>
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
      setError("As senhas nÃ£o sÃ£o iguais.");
      return;
    }

    setBusy(true);
    try {
      await updatePassword(user, password);
      await updateDoc(doc(db, "waiters", waiterId), { mustChangePassword: false });
      onComplete();
    } catch (changeError) {
      console.error("NÃ£o foi possÃ­vel alterar a senha temporÃ¡ria:", changeError);
      setError("NÃ£o foi possÃ­vel atualizar sua senha. Entre novamente com a senha temporÃ¡ria e tente outra vez.");
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
              <p>A senha temporÃ¡ria do gestor sÃ³ pode ser usada neste primeiro acesso.</p>
            </div>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label>Nova senha</label>
              <div className="input-wrapper">
                <input id="new-password" name="newPassword" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} placeholder="MÃ­nimo de 6 caracteres" />
              </div>
            </div>
            <div className="form-field">
              <label>Confirme a nova senha</label>
              <div className="input-wrapper">
                <input id="confirm-new-password" name="confirmNewPassword" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={6} placeholder="Digite a senha novamente" />
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
  const [employeePinMode, setEmployeePinMode] = useState(() => Boolean(waiterRouteId && !waiterEmail));
  const [user, setUser] =
    useState<User | null>(null);

  const [loading, setLoading] =
    useState(true);
  const [access, setAccess] = useState<"admin" | "restaurant" | "restaurant-pending" | "waiter" | "staff" | "waiter-password-change" | "verification" | "blocked" | "signed-out">("signed-out");
  const [waiterId, setWaiterId] = useState("");
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null);
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

          if (currentUser.isAnonymous) {
            setAccess("signed-out");
            setWaiterId("");
            setLoading(false);
            return;
          }

          const tokenResult = await currentUser.getIdTokenResult();
          const isPinEmployee = tokenResult.claims.employee === true;

          if (waiterRouteId && !waiterEmail && !isPinEmployee) {
            await signOut(auth);
            setUser(null);
            setEmployeePinMode(true);
            setLoading(false);
            return;
          }

          if (waiterRouteId && waiterEmail && !currentUser.emailVerified) {
            setAccess("verification");
            setLoading(false);
            return;
          }

          startTransition(() => setLoading(true));
          try {
            if (isSystemOwner(currentUser)) {
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
                setAccess((currentAccess) =>
                  currentAccess === "restaurant" || isPaid
                    ? "restaurant"
                    : "restaurant-pending",
                );
              } else {
                let memberSnapshot;
                let matchingMembers;
                let staffData: Record<string, unknown> | undefined;
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
                  const staffSnapshot = await getDoc(doc(db, "restaurantStaff", currentUser.uid));
                  if (staffSnapshot.exists()) {
                    staffData = staffSnapshot.data();
                    if (staffData.active === true && typeof staffData.waiterId === "string") {
                      memberSnapshot = await getDoc(doc(db, "waiters", staffData.waiterId));
                    }
                  } else {
                    matchingMembers = await getDocs(query(
                      collection(db, "waiters"),
                      where("uid", "==", currentUser.uid),
                      where("active", "==", true),
                    ));
                  }
                }
                const memberData = memberSnapshot?.data() ?? matchingMembers?.docs[0]?.data();
                const matchedWaiterId = memberSnapshot?.id ?? matchingMembers?.docs[0]?.id ?? "";

                if (
                  memberData?.active === true &&
                  memberData.uid === currentUser.uid &&
                  (isPinEmployee
                    ? tokenResult.claims.employeeId === matchedWaiterId
                      && tokenResult.claims.restaurantId === memberData.restaurantId
                      && tokenResult.claims.role === (staffData?.role ?? memberData.role)
                    : memberData.email === currentUser.email) &&
                  memberData.restaurantId === (waiterRestaurantRouteId || staffData?.restaurantId) &&
                  matchedWaiterId
                ) {
                  setWaiterId(matchedWaiterId);
                  setRestaurantId(String(memberData.restaurantId || ""));
                  const resolvedRole = normalizeStaffRole(staffData?.role ?? memberData.role);
                  setStaffRole(resolvedRole);
                  setAccess(memberData.mustChangePassword === true
                    ? "waiter-password-change"
                    : resolvedRole === "WAITER" ? "waiter" : "staff");
                } else {
                  setWaiterId("");
                  setAccessMessage("NÃ£o encontramos um cadastro ativo para esta conta. Abra o QR individual enviado pelo administrador.");
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
                  ? "NÃ£o foi possÃ­vel vincular o acesso. Confira se o QR pertence ao seu cadastro ativo."
                  : "NÃ£o foi possÃ­vel validar esta conta no Firebase. Confira a conexÃ£o e tente novamente.",
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
    if (!user || staffRole) {
      return;
    }

    // NÃ£o verificar pagamento se for o admin
    if (isSystemOwner(user)) {
      return;
    }

    let expiryTimeout = 0;
    const unsubscribe = onSnapshot(doc(db, "restaurants", user.uid), (snapshot) => {
      const data = snapshot.data();
      if (!snapshot.exists() || data?.ownerEmail !== user.email) {
        return;
      }
      const paidUntil = data?.monthlyPaidUntil?.toDate?.() as Date | undefined;
      const status = data?.status;
      const now = Date.now();
      const valid = status === "active" && paidUntil && paidUntil.getTime() > now;

      if (!valid) {
        setPendingPaymentAmount(paidUntil ? 100 : 600);
        setAccess("restaurant-pending");
        return;
      }

      // Se estava pending e agora Ã© vÃ¡lido, mudar para restaurant
      if (valid) {
        setAccess("restaurant");
        // ForÃ§ar re-renderizaÃ§Ã£o imediata
        setTimeout(() => setAccess("restaurant"), 0);
      }

      window.clearTimeout(expiryTimeout);
      expiryTimeout = window.setTimeout(() => {
        setPendingPaymentAmount(100);
        setAccess("restaurant-pending");
      }, Math.max(0, paidUntil.getTime() - Date.now()));
    }, (snapshotError) => {
      console.error("NÃ£o foi possÃ­vel acompanhar o estado da assinatura:", snapshotError);
      if (snapshotError.code === "permission-denied") {
        setAccessMessage("Sua conta nÃ£o tem acesso ao estado de assinatura deste restaurante.");
      }
    });

    return () => {
      window.clearTimeout(expiryTimeout);
      unsubscribe();
    };
  }, [staffRole, user]);

  /*
   * IMPORTANTE:
   *
   * /mesa/5
   * /mesa/05
   *
   * sÃ£o rotas pÃºblicas usadas pelo QR Code
   * e pelo NFC/Tap.
   *
   * Elas nÃ£o exigem login administrativo.
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
        accessToken={new URLSearchParams(window.location.search).get("t") || undefined}
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
    if (employeePinMode) {
      return <EmployeePinLogin
        restaurantId={waiterRestaurantRouteId}
        waiterId={waiterRouteId}
        onBack={() => {
          if (waiterRouteId) window.location.assign("/");
          else setEmployeePinMode(false);
        }}
      />;
    }
    return <LoginScreen
      waiterMode={Boolean(waiterRouteId && waiterEmail)}
      waiterEmail={waiterEmail}
      onEmployeeLogin={() => setEmployeePinMode(true)}
    />;
  }

  if (access === "waiter-password-change") {
    return <WaiterPasswordChange user={user} waiterId={waiterId} onComplete={() => setAccess("waiter")} />;
  }

  if (access === "waiter") {
    return <WaiterPortal user={user} waiterId={waiterId} restaurantId={restaurantId} />;
  }

  if (access === "staff") {
    return <AdminApplication user={user} systemAdmin={false} staffRole={staffRole} restaurantId={restaurantId} onSelectRestaurant={selectRestaurant} />;
  }

  if (access === "verification") {
    return <EmailVerificationPage user={user} />;
  }

  if (access === "restaurant-pending") {
    return (
      <div className="loading-screen restaurant-payment-gate">
        <div className="loading-logo"><CircleDollarSign size={26} /></div>
        <strong>{pendingRestaurantName}</strong>
        <span>Pagamento Pix pendente de confirmaÃ§Ã£o do administrador.</span>
        <span>Valor para liberar/renovar: {formatCurrency(pendingPaymentAmount)}.</span>
        <strong>Chave Pix: {import.meta.env.VITE_PIX_KEY || "consulte o administrador"}</strong>
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
      systemAdmin={isSystemOwner(user)}
      staffRole={staffRole}
      restaurantId={restaurantId}
      onSelectRestaurant={selectRestaurant}
    />
  );
}
