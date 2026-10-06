import { useState, useEffect } from "react";
import {
  Store,
  Bell,
  CreditCard,
  Clock,
  Settings as SettingsIcon,
  Save,
  CheckCircle2,
  Building2,
  ChevronRight,
  Info,
  Printer,
  Moon,
  Sun,
  User,
  Lock,
} from "lucide-react";
import { updateProfile, updatePassword } from "firebase/auth";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";
import { testPrinter, getRestaurantPrinterSettings, getUserPrinterSettings, saveRestaurantPrinterSettings as savePrinterCache } from "../utils/printer";

type SettingsSection = "restaurant" | "payment" | "hours" | "notifications" | "printers" | "system" | "account";

type RestaurantSettings = {
  name: string;
  cnpj: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
};

type PaymentSettings = {
  pixKey: string;
  cardEnabled: boolean;
  cashEnabled: boolean;
  serviceFee: number;
  minimumOrder: number;
};

type HoursSettings = {
  monday: { open: string; close: string; closed: boolean };
  tuesday: { open: string; close: string; closed: boolean };
  wednesday: { open: string; close: string; closed: boolean };
  thursday: { open: string; close: string; closed: boolean };
  friday: { open: string; close: string; closed: boolean };
  saturday: { open: string; close: string; closed: boolean };
  sunday: { open: string; close: string; closed: boolean };
};

type NotificationSettings = {
  newOrderSound: boolean;
  readyOrderSound: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;
};

type SystemSettings = {
  theme: "dark" | "light";
  language: "pt-BR" | "en-US";
};

const daysOfWeek = [
  { key: "monday", label: "Segunda" },
  { key: "tuesday", label: "Terça" },
  { key: "wednesday", label: "Quarta" },
  { key: "thursday", label: "Quinta" },
  { key: "friday", label: "Sexta" },
  { key: "saturday", label: "Sábado" },
  { key: "sunday", label: "Domingo" },
];

export default function SettingsModule() {
  const { restaurantId } = useRestaurantScope();
  const [activeSection, setActiveSection] = useState<SettingsSection>("restaurant");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [connectionState, setConnectionState] = useState<"online" | "offline" | "syncing">(
    navigator.onLine ? "online" : "offline",
  );

  const [restaurant, setRestaurant] = useState<RestaurantSettings>({
    name: "Seu Restaurante",
    cnpj: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    zipCode: "",
  });

  const [payment, setPayment] = useState<PaymentSettings>({
    pixKey: import.meta.env.VITE_PIX_KEY || "",
    cardEnabled: true,
    cashEnabled: true,
    serviceFee: 10,
    minimumOrder: 0,
  });

  const [hours, setHours] = useState<HoursSettings>({
    monday: { open: "11:00", close: "23:00", closed: false },
    tuesday: { open: "11:00", close: "23:00", closed: false },
    wednesday: { open: "11:00", close: "23:00", closed: false },
    thursday: { open: "11:00", close: "23:00", closed: false },
    friday: { open: "11:00", close: "23:00", closed: false },
    saturday: { open: "11:00", close: "00:00", closed: false },
    sunday: { open: "12:00", close: "22:00", closed: false },
  });

  const [notifications, setNotifications] = useState<NotificationSettings>({
    newOrderSound: true,
    readyOrderSound: true,
    emailNotifications: false,
    smsNotifications: false,
  });

  // Load settings from localStorage on mount
  const getInitialSystemSettings = (): SystemSettings => {
    const savedSettings = localStorage.getItem("servia_settings");
    if (savedSettings) {
      try {
        const parsed = JSON.parse(savedSettings);
        return {
          theme: parsed.theme ?? "dark",
          language: parsed.language ?? "pt-BR",
        };
      } catch (error) {
        console.error("Erro ao carregar configurações:", error);
      }
    }
    return {
      theme: "dark",
      language: "pt-BR",
    };
  };

  const [system, setSystem] = useState<SystemSettings>(getInitialSystemSettings);

  // Restaurant printer settings (cozinha)
  const [restaurantPrinter, setRestaurantPrinter] = useState(getRestaurantPrinterSettings);

  useEffect(() => {
    if (!restaurantId) return;
    return onSnapshot(doc(db, "restaurants", restaurantId, "settings", "printer"), (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      const settings = { ...getRestaurantPrinterSettings(), ...data, printerType: "browser" as const };
      setRestaurantPrinter(settings);
      savePrinterCache(settings);
    }, (error) => console.error("Erro ao carregar configurações da impressora:", error));
  }, [restaurantId]);

  // User printer settings (caixa)
  const [userPrinter, setUserPrinter] = useState(getUserPrinterSettings);

  // Account settings
  const [passwordChange, setPasswordChange] = useState({
    newPassword: "",
    confirmPassword: "",
  });

  // Apply theme changes to document
  useEffect(() => {
    if (system.theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [system.theme]);

  const [userProfile, setUserProfile] = useState({
    displayName: auth.currentUser?.displayName || "",
    email: auth.currentUser?.email || "",
  });

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      return;
    }

    const unsubscribeRestaurant = onSnapshot(
      doc(db, "restaurants", currentUser.uid),
      { includeMetadataChanges: true },
      (snapshot) => {
        const data = snapshot.data();
        if (data?.restaurant) {
          setRestaurant((current) => ({ ...current, ...data.restaurant }));
        }
        if (data?.payment) {
          setPayment((current) => ({ ...current, ...data.payment }));
        }
        if (data?.hours) {
          setHours((current) => ({ ...current, ...data.hours }));
        }
        if (data?.notifications) {
          setNotifications((current) => ({ ...current, ...data.notifications }));
        }

        setConnectionState(
          snapshot.metadata.hasPendingWrites
            ? "syncing"
            : snapshot.metadata.fromCache
              ? "offline"
              : "online",
        );
      },
      (loadError) => {
        console.error("Erro ao carregar dados do restaurante:", loadError);
        setConnectionState("offline");
      },
    );

    function markOffline() {
      setConnectionState("offline");
    }

    function markOnline() {
      setConnectionState("syncing");
    }

    window.addEventListener("offline", markOffline);
    window.addEventListener("online", markOnline);
    return () => {
      unsubscribeRestaurant();
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", markOnline);
    };
  }, []);

  function showMessage(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 4000);
  }

  function saveRestaurantSection(
    section: "restaurant" | "payment" | "hours" | "notifications",
    value: RestaurantSettings | PaymentSettings | HoursSettings | NotificationSettings,
    successMessage: string,
  ) {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      showMessage("Entre novamente para salvar as configurações.");
      return;
    }

    setBusy(true);
    setConnectionState("syncing");
    const write = setDoc(
      doc(db, "restaurants", currentUser.uid),
      { [section]: value, updatedAt: serverTimestamp() },
      { merge: true },
    );

    if (!navigator.onLine) {
      setBusy(false);
      setConnectionState("offline");
      showMessage("Salvo neste dispositivo. Será sincronizado quando a conexão voltar.");
    } else {
      showMessage("Sincronizando alterações...");
    }

    void write
      .then(() => {
        setBusy(false);
        setConnectionState("online");
        showMessage(successMessage);
      })
      .catch((saveError) => {
        console.error("Erro ao salvar dados do restaurante:", saveError);
        setBusy(false);
        setConnectionState("offline");
        showMessage("Alteração mantida neste dispositivo; aguardando conexão para sincronizar.");
      });
  }

  function saveRestaurantSettings() {
    saveRestaurantSection("restaurant", restaurant, "Dados do restaurante sincronizados.");
  }

  function savePaymentSettings() {
    saveRestaurantSection("payment", payment, "Pagamentos sincronizados.");
  }

  function saveHoursSettings() {
    saveRestaurantSection("hours", hours, "Horários sincronizados.");
  }

  function saveNotificationSettings() {
    saveRestaurantSection("notifications", notifications, "Notificações sincronizadas.");
  }

  async function saveSystemSettings() {
    setBusy(true);
    try {
      // Save to localStorage for persistence
      localStorage.setItem("servia_settings", JSON.stringify(system));
      showMessage("Configurações do sistema salvas com sucesso!");
    } catch (error) {
      console.error("Erro ao salvar configurações:", error);
      showMessage("Erro ao salvar configurações do sistema.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRestaurantPrinterSettings() {
    setBusy(true);
    try {
      if (!restaurantId) throw new Error("Nenhum restaurante selecionado.");
      await setDoc(doc(db, "restaurants", restaurantId, "settings", "printer"), restaurantPrinter, { merge: true });
      savePrinterCache(restaurantPrinter);
      showMessage("Configurações da impressora da cozinha salvas com sucesso!");
    } catch (error) {
      console.error("Erro ao salvar configurações da impressora da cozinha:", error);
      showMessage("Erro ao salvar configurações da impressora da cozinha.");
    } finally {
      setBusy(false);
    }
  }

  async function saveUserPrinterSettings() {
    setBusy(true);
    try {
      localStorage.setItem("servia_user_printer", JSON.stringify(userPrinter));
      showMessage("Configurações da impressora do caixa salvas com sucesso!");
    } catch (error) {
      console.error("Erro ao salvar configurações da impressora do caixa:", error);
      showMessage("Erro ao salvar configurações da impressora do caixa.");
    } finally {
      setBusy(false);
    }
  }

  async function saveUserProfile() {
    setBusy(true);
    try {
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, {
          displayName: userProfile.displayName.trim(),
        });
        showMessage("Perfil atualizado com sucesso!");
      }
    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);
      showMessage("Erro ao atualizar perfil.");
    } finally {
      setBusy(false);
    }
  }

  function updateDayHours(day: keyof HoursSettings, field: "open" | "close", value: string) {
    setHours((current) => ({
      ...current,
      [day]: {
        ...current[day],
        [field]: value,
      },
    }));
  }

  function toggleDayClosed(day: keyof HoursSettings) {
    setHours((current) => ({
      ...current,
      [day]: {
        ...current[day],
        closed: !current[day].closed,
      },
    }));
  }

  return (
    <div className="settings-page">
      <div className="module-header">
        <div>
          <div className="eyebrow">SISTEMA</div>

          <h1>Configurações</h1>

          <p>
            Personalize seu restaurante, pagamentos, horários e notificações.
          </p>
        </div>
        <div className={`connection-status ${connectionState}`} role="status">
          <span />
          {connectionState === "online"
            ? "Online"
            : connectionState === "syncing"
              ? "Sincronizando"
              : "Offline · alterações na fila"}
        </div>
      </div>

      {message && (
        <div className="settings-message success">
          <CheckCircle2 size={18} />
          <span>{message}</span>
        </div>
      )}

      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-sidebar-header">
            <h3>Configurações</h3>
            <p>Gerencie seu sistema</p>
          </div>

          <nav className="settings-nav">
            <button
              className={`settings-nav-item ${activeSection === "restaurant" ? "active" : ""}`}
              onClick={() => setActiveSection("restaurant")}
            >
              <Store size={18} />
              <span>Restaurante</span>
              {activeSection === "restaurant" && <ChevronRight size={16} />}
            </button>

            <button
              className={`settings-nav-item ${activeSection === "payment" ? "active" : ""}`}
              onClick={() => setActiveSection("payment")}
            >
              <CreditCard size={18} />
              <span>Pagamentos</span>
              {activeSection === "payment" && <ChevronRight size={16} />}
            </button>

            <button
              className={`settings-nav-item ${activeSection === "hours" ? "active" : ""}`}
              onClick={() => setActiveSection("hours")}
            >
              <Clock size={18} />
              <span>Horários</span>
              {activeSection === "hours" && <ChevronRight size={16} />}
            </button>

            <button
              className={`settings-nav-item ${activeSection === "notifications" ? "active" : ""}`}
              onClick={() => setActiveSection("notifications")}
            >
              <Bell size={18} />
              <span>Notificações</span>
              {activeSection === "notifications" && <ChevronRight size={16} />}
            </button>

            <button
              className={`settings-nav-item ${activeSection === "printers" ? "active" : ""}`}
              onClick={() => setActiveSection("printers")}
            >
              <Printer size={18} />
              <span>Impressoras</span>
              {activeSection === "printers" && <ChevronRight size={16} />}
            </button>

            <button
              className={`settings-nav-item ${activeSection === "account" ? "active" : ""}`}
              onClick={() => setActiveSection("account")}
            >
              <User size={18} />
              <span>Conta</span>
              {activeSection === "account" && <ChevronRight size={16} />}
            </button>

            <button
              className={`settings-nav-item ${activeSection === "system" ? "active" : ""}`}
              onClick={() => setActiveSection("system")}
            >
              <SettingsIcon size={18} />
              <span>Sistema</span>
              {activeSection === "system" && <ChevronRight size={16} />}
            </button>
          </nav>
        </aside>

        <main className="settings-content">
          {activeSection === "restaurant" && (
            <section className="settings-section">
              <div className="settings-section-header">
                <div className="section-icon restaurant-icon">
                  <Building2 size={24} />
                </div>
                <div>
                  <h2>Dados do Restaurante</h2>
                  <p>Informações que aparecem nos tickets e faturas.</p>
                </div>
              </div>

              <div className="settings-grid">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Informações Básicas</h3>
                  </div>

                  <div className="settings-form">
                    <label className="form-field">
                      <span>Nome do restaurante</span>
                      <input
                        type="text"
                        value={restaurant.name}
                        onChange={(e) => setRestaurant({ ...restaurant, name: e.target.value })}
                      />
                    </label>

                    <label className="form-field">
                      <span>CNPJ</span>
                      <input
                        type="text"
                        value={restaurant.cnpj}
                        onChange={(e) => setRestaurant({ ...restaurant, cnpj: e.target.value })}
                        placeholder="00.000.000/0000-00"
                      />
                    </label>

                    <label className="form-field">
                      <span>Telefone</span>
                      <input
                        type="tel"
                        value={restaurant.phone}
                        onChange={(e) => setRestaurant({ ...restaurant, phone: e.target.value })}
                        placeholder="(11) 99999-9999"
                      />
                    </label>

                    <label className="form-field">
                      <span>E-mail</span>
                      <input
                        type="email"
                        value={restaurant.email}
                        onChange={(e) => setRestaurant({ ...restaurant, email: e.target.value })}
                        placeholder="contato@restaurante.com"
                      />
                    </label>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={saveRestaurantSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar dados"}
                    </button>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Endereço</h3>
                  </div>

                  <div className="settings-form">
                    <label className="form-field">
                      <span>Endereço</span>
                      <input
                        type="text"
                        value={restaurant.address}
                        onChange={(e) => setRestaurant({ ...restaurant, address: e.target.value })}
                        placeholder="Rua Exemplo, 123"
                      />
                    </label>

                    <div className="form-row">
                      <label className="form-field">
                        <span>Cidade</span>
                        <input
                          type="text"
                          value={restaurant.city}
                          onChange={(e) => setRestaurant({ ...restaurant, city: e.target.value })}
                        />
                      </label>

                      <label className="form-field">
                        <span>Estado</span>
                        <input
                          type="text"
                          value={restaurant.state}
                          onChange={(e) => setRestaurant({ ...restaurant, state: e.target.value })}
                          placeholder="SP"
                        />
                      </label>
                    </div>

                    <label className="form-field">
                      <span>CEP</span>
                      <input
                        type="text"
                        value={restaurant.zipCode}
                        onChange={(e) => setRestaurant({ ...restaurant, zipCode: e.target.value })}
                        placeholder="00000-000"
                      />
                    </label>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={saveRestaurantSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar dados"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "payment" && (
            <section className="settings-section">
              <div className="settings-section-header">
                <div className="section-icon payment-icon">
                  <CreditCard size={24} />
                </div>
                <div>
                  <h2>Pagamentos</h2>
                  <p>Configure as formas de pagamento aceitas no restaurante.</p>
                </div>
              </div>

              <div className="settings-grid">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>PIX</h3>
                  </div>

                  <div className="settings-form">
                    <label className="form-field">
                      <span>Chave PIX</span>
                      <input
                        type="text"
                        value={payment.pixKey}
                        onChange={(e) => setPayment({ ...payment, pixKey: e.target.value })}
                        placeholder="00020126580014br.gov.bc.pix.pix0123456789"
                      />
                    </label>

                    <div className="settings-info">
                      <Info size={16} />
                      <span>A chave PIX aparecerá nos tickets de pagamento.</span>
                    </div>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={savePaymentSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Formas de Pagamento</h3>
                  </div>

                  <div className="settings-form">
                    <div className="settings-toggles">
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={payment.cardEnabled}
                          onChange={(e) => setPayment({ ...payment, cardEnabled: e.target.checked })}
                        />
                        <div>
                          <strong>Cartão de crédito/débito</strong>
                          <span>Aceitar pagamentos com cartão</span>
                        </div>
                      </label>

                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={payment.cashEnabled}
                          onChange={(e) => setPayment({ ...payment, cashEnabled: e.target.checked })}
                        />
                        <div>
                          <strong>Dinheiro</strong>
                          <span>Aceitar pagamentos em dinheiro</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={savePaymentSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Taxas e Limites</h3>
                  </div>

                  <div className="settings-form">
                    <label className="form-field">
                      <span>Taxa de serviço (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        step="0.5"
                        value={payment.serviceFee}
                        onChange={(e) => setPayment({ ...payment, serviceFee: Number(e.target.value) })}
                      />
                    </label>

                    <label className="form-field">
                      <span>Pedido mínimo (R$)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={payment.minimumOrder}
                        onChange={(e) => setPayment({ ...payment, minimumOrder: Number(e.target.value) })}
                      />
                    </label>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={savePaymentSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "hours" && (
            <section className="settings-section">
              <div className="settings-section-header">
                <div className="section-icon hours-icon">
                  <Clock size={24} />
                </div>
                <div>
                  <h2>Horário de Funcionamento</h2>
                  <p>Defina os horários de abertura e fechamento para cada dia da semana.</p>
                </div>
              </div>

              <div className="settings-form">
                {daysOfWeek.map((day) => (
                  <div key={day.key} className="hours-day-card">
                    <div className="hours-day-header">
                      <strong>{day.label}</strong>
                      <label className="closed-toggle">
                        <input
                          type="checkbox"
                          checked={hours[day.key as keyof HoursSettings].closed}
                          onChange={() => toggleDayClosed(day.key as keyof HoursSettings)}
                        />
                        <span>Fechado</span>
                      </label>
                    </div>

                    {!hours[day.key as keyof HoursSettings].closed && (
                      <div className="hours-day-inputs">
                        <label className="form-field">
                          <span>Abertura</span>
                          <input
                            type="time"
                            value={hours[day.key as keyof HoursSettings].open}
                            onChange={(e) => updateDayHours(day.key as keyof HoursSettings, "open", e.target.value)}
                          />
                        </label>

                        <label className="form-field">
                          <span>Fechamento</span>
                          <input
                            type="time"
                            value={hours[day.key as keyof HoursSettings].close}
                            onChange={(e) => updateDayHours(day.key as keyof HoursSettings, "close", e.target.value)}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                ))}

                <div className="settings-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={saveHoursSettings}
                    disabled={busy}
                  >
                    <Save size={18} />
                    {busy ? "Salvando..." : "Salvar horários"}
                  </button>
                </div>
              </div>
            </section>
          )}

          {activeSection === "notifications" && (
            <section className="settings-section">
              <div className="settings-section-header">
                <div className="section-icon notifications-icon">
                  <Bell size={24} />
                </div>
                <div>
                  <h2>Notificações</h2>
                  <p>Configure alertas sonoros e notificações para novos pedidos.</p>
                </div>
              </div>

              <div className="settings-grid">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Alertas Sonoros</h3>
                  </div>

                  <div className="settings-form">
                    <div className="settings-toggles">
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={notifications.newOrderSound}
                          onChange={(e) => setNotifications({ ...notifications, newOrderSound: e.target.checked })}
                        />
                        <div>
                          <strong>Novo pedido</strong>
                          <span>Alerta sonoro ao receber novo pedido</span>
                        </div>
                      </label>

                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={notifications.readyOrderSound}
                          onChange={(e) => setNotifications({ ...notifications, readyOrderSound: e.target.checked })}
                        />
                        <div>
                          <strong>Pedido pronto</strong>
                          <span>Alerta sonoro quando pedido ficar pronto</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={saveNotificationSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Notificações Push</h3>
                  </div>

                  <div className="settings-form">
                    <div className="settings-toggles">
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={notifications.emailNotifications}
                          onChange={(e) => setNotifications({ ...notifications, emailNotifications: e.target.checked })}
                        />
                        <div>
                          <strong>E-mail</strong>
                          <span>Receba notificações por e-mail</span>
                        </div>
                      </label>

                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={notifications.smsNotifications}
                          onChange={(e) => setNotifications({ ...notifications, smsNotifications: e.target.checked })}
                        />
                        <div>
                          <strong>SMS</strong>
                          <span>Receba notificações por SMS</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={saveNotificationSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "printers" && (
            <section className="settings-section">
              <div className="settings-section-header">
                <div className="section-icon system-icon">
                  <Printer size={24} />
                </div>
                <div>
                  <h2>Configuração de Impressoras</h2>
                  <p>Configure impressoras separadas para cozinha e caixa.</p>
                </div>
              </div>

              <div className="settings-grid">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Impressora da Cozinha</h3>
                    <p>Imprime comandas na impressora padrão do computador da cozinha</p>
                  </div>

                  <div className="settings-form">
                    <div className="settings-toggles">
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={restaurantPrinter.printerEnabled}
                          onChange={(e) => setRestaurantPrinter({ ...restaurantPrinter, printerEnabled: e.target.checked })}
                        />
                        <div>
                          <strong>Habilitar impressora</strong>
                          <span>Ativar impressora de cozinha</span>
                        </div>
                      </label>

                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={restaurantPrinter.autoPrintOrders}
                          onChange={(e) => setRestaurantPrinter({ ...restaurantPrinter, autoPrintOrders: e.target.checked })}
                          disabled={!restaurantPrinter.printerEnabled}
                        />
                        <div>
                          <strong>Impressão automática</strong>
                          <span>Imprimir comandas ao receber pedidos</span>
                        </div>
                      </label>
                    </div>

                    <label className="form-field">
                      <span>Impressora</span>
                      <select value={restaurantPrinter.printerType} disabled>
                        <option value="browser">Impressora definida neste computador</option>
                      </select>
                    </label>

                    {restaurantPrinter.printerType === "network" && (
                      <div className="form-row">
                        <label className="form-field">
                          <span>Endereço IP</span>
                          <input
                            type="text"
                            value={restaurantPrinter.printerIp}
                            onChange={(e) => setRestaurantPrinter({ ...restaurantPrinter, printerIp: e.target.value })}
                            placeholder="192.168.1.100"
                            disabled={!restaurantPrinter.printerEnabled}
                          />
                        </label>

                        <label className="form-field">
                          <span>Porta</span>
                          <input
                            type="number"
                            value={restaurantPrinter.printerPort}
                            onChange={(e) => setRestaurantPrinter({ ...restaurantPrinter, printerPort: parseInt(e.target.value) || 9100 })}
                            disabled={!restaurantPrinter.printerEnabled}
                          />
                        </label>
                      </div>
                    )}

                    <label className="form-field">
                      <span>Largura do papel</span>
                      <select
                        value={restaurantPrinter.paperWidth}
                        onChange={(e) => setRestaurantPrinter({ ...restaurantPrinter, paperWidth: parseInt(e.target.value) as 58 | 80 })}
                        disabled={!restaurantPrinter.printerEnabled}
                      >
                        <option value="58">58mm (compacto)</option>
                        <option value="80">80mm (padrão)</option>
                      </select>
                    </label>

                    <div className="settings-info"><Info size={16} /><span>Usa a impressora definida como padrão neste computador. Para imprimir sem janela, inicie o Chrome ou Edge com --kiosk-printing.</span></div>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={async () => {
                        setBusy(true);
                        const result = await testPrinter();
                        setBusy(false);
                        if (result) {
                          showMessage("Teste realizado com sucesso!");
                        } else {
                          showMessage("Falha no teste");
                        }
                      }}
                      disabled={busy || !restaurantPrinter.printerEnabled}
                    >
                      <Printer size={18} />
                      {busy ? "Testando..." : "Testar impressora"}
                    </button>

                    <button
                      className="primary-button"
                      type="button"
                      onClick={saveRestaurantPrinterSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Impressora do Caixa</h3>
                    <p>Imprime contas quando mesas são fechadas (configuração por usuário)</p>
                  </div>

                  <div className="settings-form">
                    <div className="settings-toggles">
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={userPrinter.printerEnabled}
                          onChange={(e) => setUserPrinter({ ...userPrinter, printerEnabled: e.target.checked })}
                        />
                        <div>
                          <strong>Habilitar impressora</strong>
                          <span>Ativar impressora do caixa</span>
                        </div>
                      </label>
                    </div>

                    <label className="form-field">
                      <span>Impressora</span>
                      <select value={userPrinter.printerType} disabled>
                        <option value="browser">Impressora definida neste computador</option>
                      </select>
                    </label>

                    {userPrinter.printerType === "network" && (
                      <div className="form-row">
                        <label className="form-field">
                          <span>Endereço IP</span>
                          <input
                            type="text"
                            value={userPrinter.printerIp}
                            onChange={(e) => setUserPrinter({ ...userPrinter, printerIp: e.target.value })}
                            placeholder="192.168.1.100"
                            disabled={!userPrinter.printerEnabled}
                          />
                        </label>

                        <label className="form-field">
                          <span>Porta</span>
                          <input
                            type="number"
                            value={userPrinter.printerPort}
                            onChange={(e) => setUserPrinter({ ...userPrinter, printerPort: parseInt(e.target.value) || 9100 })}
                            disabled={!userPrinter.printerEnabled}
                          />
                        </label>
                      </div>
                    )}

                    <label className="form-field">
                      <span>Largura do papel</span>
                      <select
                        value={userPrinter.paperWidth}
                        onChange={(e) => setUserPrinter({ ...userPrinter, paperWidth: parseInt(e.target.value) as 58 | 80 })}
                        disabled={!userPrinter.printerEnabled}
                      >
                        <option value="58">58mm (compacto)</option>
                        <option value="80">80mm (padrão)</option>
                      </select>
                    </label>

                    <div className="settings-info">
                      <Info size={16} />
                      <span>
                        Esta configuração é específica para o usuário atual. Cada caixa pode ter sua própria impressora configurada.
                      </span>
                    </div>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={async () => {
                        setBusy(true);
                        const result = await testPrinter();
                        setBusy(false);
                        if (result) {
                          showMessage("Teste realizado com sucesso!");
                        } else {
                          showMessage("Falha no teste");
                        }
                      }}
                      disabled={busy || !userPrinter.printerEnabled}
                    >
                      <Printer size={18} />
                      {busy ? "Testando..." : "Testar impressora"}
                    </button>

                    <button
                      className="primary-button"
                      type="button"
                      onClick={saveUserPrinterSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "account" && (
            <section className="settings-section">
              <div className="settings-section-header">
                <div className="section-icon system-icon">
                  <User size={24} />
                </div>
                <div>
                  <h2>Configurações da Conta</h2>
                  <p>Gerencie sua senha e informações de acesso.</p>
                </div>
              </div>

              <div className="settings-grid">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Alterar Senha</h3>
                  </div>

                  <div className="settings-form">
                    <label className="form-field">
                      <span>Nova senha</span>
                      <input
                        type="password"
                        value={passwordChange.newPassword}
                        onChange={(e) => setPasswordChange({ ...passwordChange, newPassword: e.target.value })}
                        placeholder="Mínimo 6 caracteres"
                      />
                    </label>

                    <label className="form-field">
                      <span>Confirmar nova senha</span>
                      <input
                        type="password"
                        value={passwordChange.confirmPassword}
                        onChange={(e) => setPasswordChange({ ...passwordChange, confirmPassword: e.target.value })}
                        placeholder="Digite a nova senha novamente"
                      />
                    </label>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={async () => {
                        if (!passwordChange.newPassword || !passwordChange.confirmPassword) {
                          showMessage("Preencha a nova senha e a confirmação.");
                          return;
                        }
                        if (passwordChange.newPassword.length < 6) {
                          showMessage("A nova senha deve ter pelo menos 6 caracteres.");
                          return;
                        }
                        if (passwordChange.newPassword !== passwordChange.confirmPassword) {
                          showMessage("As senhas não coincidem.");
                          return;
                        }
                        setBusy(true);
                        try {
                          const user = auth.currentUser;
                          if (!user) {
                            showMessage("Usuário não autenticado.");
                            setBusy(false);
                            return;
                          }
                          await updatePassword(user, passwordChange.newPassword);
                          setPasswordChange({ newPassword: "", confirmPassword: "" });
                          showMessage("Senha alterada com sucesso!");
                        } catch (error) {
                          console.error("Erro ao alterar senha:", error);
                          const code = typeof error === "object" && error && "code" in error
                            ? String((error as { code: string }).code)
                            : "";
                          if (code === "auth/requires-recent-login") {
                            showMessage("Faça login novamente para alterar a senha por segurança.");
                          } else {
                            showMessage("Erro ao alterar senha. Tente novamente.");
                          }
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                    >
                      <Lock size={18} />
                      {busy ? "Alterando..." : "Alterar Senha"}
                    </button>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Informações da Conta</h3>
                  </div>

                  <div className="settings-form">
                    <label className="form-field">
                      <span>E-mail</span>
                      <input
                        type="email"
                        value={auth.currentUser?.email || ""}
                        disabled
                      />
                    </label>

                    <label className="form-field">
                      <span>UID</span>
                      <input
                        type="text"
                        value={auth.currentUser?.uid || ""}
                        disabled
                      />
                    </label>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "system" && (
            <section className="settings-section">
              <div className="settings-section-header">
                <div className="section-icon system-icon">
                  <SettingsIcon size={24} />
                </div>
                <div>
                  <h2>Configurações do Sistema</h2>
                  <p>Preferências do sistema e tema.</p>
                </div>
              </div>

              <div className="settings-grid">
                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Aparência</h3>
                  </div>

                  <div className="settings-form">
                    <div className="theme-selector">
                      <button
                        type="button"
                        className={`theme-option ${system.theme === "dark" ? "active" : ""}`}
                        onClick={() => setSystem({ ...system, theme: "dark" })}
                      >
                        <Moon size={24} />
                        <div>
                          <strong>Escuro</strong>
                          <span>Tema escuro por padrão</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className={`theme-option ${system.theme === "light" ? "active" : ""}`}
                        onClick={() => setSystem({ ...system, theme: "light" })}
                      >
                        <Sun size={24} />
                        <div>
                          <strong>Claro</strong>
                          <span>Tema claro para ambientes claros</span>
                        </div>
                      </button>
                    </div>

                    <label className="form-field">
                      <span>Idioma</span>
                      <select
                        value={system.language}
                        onChange={(e) => setSystem({ ...system, language: e.target.value as "pt-BR" | "en-US" })}
                      >
                        <option value="pt-BR">Português (Brasil)</option>
                        <option value="en-US">English (US)</option>
                      </select>
                    </label>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={saveSystemSettings}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>

                <div className="settings-card">
                  <div className="settings-card-header">
                    <h3>Perfil do Administrador</h3>
                  </div>

                  <div className="settings-form">
                    <label className="form-field">
                      <span>Nome de exibição</span>
                      <input
                        type="text"
                        value={userProfile.displayName}
                        onChange={(e) => setUserProfile({ ...userProfile, displayName: e.target.value })}
                      />
                    </label>

                    <label className="form-field">
                      <span>E-mail</span>
                      <input
                        type="email"
                        value={userProfile.email}
                        disabled
                      />
                    </label>
                  </div>

                  <div className="settings-card-actions">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={saveUserProfile}
                      disabled={busy}
                    >
                      <Save size={18} />
                      {busy ? "Atualizando..." : "Atualizar perfil"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
