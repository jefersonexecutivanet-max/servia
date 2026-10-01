import { useEffect, useState } from "react";
import {
  Check,
  CircleDollarSign,
  Copy,
  Plus,
  Search,
  Store,
  UserRoundPlus,
  X,
} from "lucide-react";
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
} from "firebase/auth";
import { db, auth, restaurantProvisioningAuth } from "../firebase";
import { formatCurrency } from "../utils/format";

type RestaurantAccount = {
  id: string;
  name: string;
  cnpj: string;
  ownerName: string;
  ownerEmail: string;
  status: "pending_payment" | "active";
  paymentStatus: "pending" | "paid";
  setupFee: number;
  monthlyFee: number;
  monthlyPaidUntil?: Date;
  createdAt?: Date;
};

type FormState = {
  name: string;
  cnpj: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
};

const PIX_KEY = "finho60@hotmail.com";
const SETUP_FEE = 500;
const MONTHLY_FEE = 100;

const emptyForm: FormState = {
  name: "",
  cnpj: "",
  ownerName: "",
  ownerEmail: "",
  password: "",
};

function parseRestaurant(id: string, data: Record<string, unknown>): RestaurantAccount {
  const createdAt = data.createdAt as { toDate?: () => Date } | undefined;
  const monthlyPaidUntil = data.monthlyPaidUntil as { toDate?: () => Date } | undefined;
  return {
    id,
    name: String(data.name || "Restaurante"),
    cnpj: String(data.cnpj || ""),
    ownerName: String(data.ownerName || ""),
    ownerEmail: String(data.ownerEmail || ""),
    status: data.status === "active" ? "active" : "pending_payment",
    paymentStatus: data.paymentStatus === "paid" ? "paid" : "pending",
    setupFee: Number(data.setupFee ?? SETUP_FEE),
    monthlyFee: Number(data.monthlyFee ?? MONTHLY_FEE),
    monthlyPaidUntil: monthlyPaidUntil?.toDate?.(),
    createdAt: createdAt?.toDate?.(),
  };
}

function subscriptionIsCurrent(restaurant: RestaurantAccount) {
  return restaurant.status === "active"
    && Boolean(restaurant.monthlyPaidUntil && restaurant.monthlyPaidUntil.getTime() > Date.now());
}

function paymentAmount(restaurant: RestaurantAccount) {
  return restaurant.monthlyPaidUntil
    ? restaurant.monthlyFee
    : restaurant.setupFee + restaurant.monthlyFee;
}

export default function RestaurantsModule({
  onOpenRestaurant,
}: {
  onOpenRestaurant: (restaurantId: string) => void;
}) {
  const [restaurants, setRestaurants] = useState<RestaurantAccount[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [lastCredentials, setLastCredentials] = useState<{ email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const restaurantsQuery = query(collection(db, "restaurants"), orderBy("createdAt", "desc"));
    return onSnapshot(
      restaurantsQuery,
      (snapshot) => {
        setRestaurants(snapshot.docs.map((item) => parseRestaurant(item.id, item.data())));
        setError("");
      },
      (snapshotError) => {
        console.error("Erro ao carregar restaurantes:", snapshotError);
        setError("Não foi possível carregar os restaurantes.");
      },
    );
  }, []);

  const visibleRestaurants = restaurants.filter((restaurant) =>
    `${restaurant.name} ${restaurant.cnpj} ${restaurant.ownerEmail}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const pendingCount = restaurants.filter((item) => !subscriptionIsCurrent(item)).length;
  const activeCount = restaurants.filter(subscriptionIsCurrent).length;

  function openNewForm() {
    setError("");
    setNotice("");
    setForm(emptyForm);
    setShowForm(true);
  }

  async function createRestaurant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const normalizedCnpj = form.cnpj.replace(/\D/g, "");
    const normalizedEmail = form.ownerEmail.trim().toLowerCase();
    if (normalizedCnpj.length !== 14) {
      setError("Informe um CNPJ válido com 14 números.");
      return;
    }
    if (form.password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (!navigator.onLine) {
      setError("A criação da conta exige internet. Os dados não foram enviados.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const duplicateCnpj = await getDocs(query(
        collection(db, "restaurants"),
        where("cnpj", "==", normalizedCnpj),
      ));
      if (!duplicateCnpj.empty) {
        throw new Error("Esse CNPJ já está cadastrado.");
      }

      const existingAccount = await getDocs(query(
        collection(db, "restaurants"),
        where("ownerEmail", "==", normalizedEmail),
      ));
      if (!existingAccount.empty) {
        throw new Error("Esse e-mail já está vinculado a um restaurante.");
      }

      const account = await createUserWithEmailAndPassword(
        restaurantProvisioningAuth,
        normalizedEmail,
        form.password,
      );
      const accountUid = account.user.uid;

      try {
        await setDoc(doc(db, "restaurants", accountUid), {
          name: form.name.trim(),
          cnpj: normalizedCnpj,
          ownerName: form.ownerName.trim(),
          ownerEmail: normalizedEmail,
          status: "pending_payment",
          paymentStatus: "pending",
          setupFee: SETUP_FEE,
          monthlyFee: MONTHLY_FEE,
          firstPaymentAmount: SETUP_FEE + MONTHLY_FEE,
          pixKey: PIX_KEY,
          createdBy: auth.currentUser?.uid || "",
          createdAt: serverTimestamp(),
        });
        await signOut(restaurantProvisioningAuth);
      } catch (saveError) {
        await deleteUser(account.user).catch(() => undefined);
        await signOut(restaurantProvisioningAuth).catch(() => undefined);
        throw saveError;
      }

      setLastCredentials({ email: normalizedEmail, password: form.password });
      setForm(emptyForm);
      setShowForm(false);
      setNotice("Restaurante cadastrado. O acesso ficará bloqueado até a confirmação do Pix.");
    } catch (createError) {
      console.error("Erro ao cadastrar restaurante:", createError);
      const code = typeof createError === "object" && createError && "code" in createError
        ? String((createError as { code: string }).code)
        : "";
      setError(
        createError instanceof Error && !code
          ? createError.message
          : code === "auth/email-already-in-use"
            ? "Esse e-mail já possui uma conta no Firebase. Use outro e-mail do responsável."
            : "Não foi possível criar a conta. Confira os dados e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmPayment(restaurant: RestaurantAccount) {
    if (!window.confirm(`Confirmar o Pix de ${restaurant.name} e liberar o acesso?`)) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      await updateDoc(doc(db, "restaurants", restaurant.id), {
        paymentStatus: "paid",
        status: "active",
        paidAt: serverTimestamp(),
        activatedAt: serverTimestamp(),
        monthlyPaidUntil: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      setNotice(`Pagamento registrado. ${restaurant.name} está liberado por mais 30 dias.`);
    } catch (paymentError) {
      console.error("Erro ao confirmar pagamento:", paymentError);
      setError("Não foi possível liberar o acesso.");
    } finally {
      setBusy(false);
    }
  }

  async function copyPixKey() {
    try {
      await navigator.clipboard.writeText(PIX_KEY);
      setCopied(true);
    } catch {
      setError("Não foi possível copiar a chave Pix neste dispositivo.");
    }
  }

  return (
    <section className="restaurants-page">
      <header className="module-header">
        <div>
          <div className="eyebrow">ADMINISTRAÇÃO DO SERVIA</div>
          <h1>Restaurantes</h1>
          <p>Cadastre contas, acompanhe o Pix e libere o acesso.</p>
        </div>
        <button className="primary-button" type="button" onClick={openNewForm}>
          <Plus size={18} /> Cadastrar restaurante
        </button>
      </header>

      {error && <div className="team-feedback error" role="alert">{error}</div>}
      {notice && <div className="team-feedback" role="status">{notice}</div>}

      <div className="restaurant-summary">
        <div><span>Restaurantes</span><strong>{restaurants.length}</strong></div>
        <div><span>Aguardando Pix</span><strong>{pendingCount}</strong></div>
        <div><span>Acessos liberados</span><strong>{activeCount}</strong></div>
      </div>

      <div className="filters-bar">
        <div className="search-input">
          <Search size={18} />
          <input
            type="search"
            placeholder="Buscar por restaurante, CNPJ ou e-mail..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {visibleRestaurants.length === 0 ? (
        <div className="team-empty">{search ? "Nenhum restaurante encontrado." : "Nenhum restaurante cadastrado."}</div>
      ) : (
        <div className="restaurant-list">
          {visibleRestaurants.map((restaurant) => (
            (() => {
              const accessIsCurrent = subscriptionIsCurrent(restaurant);
              const dueAmount = paymentAmount(restaurant);
              return (
            <article className="restaurant-row" key={restaurant.id}>
              <div className="restaurant-row-icon"><Store size={20} /></div>
              <div className="restaurant-row-main">
                <strong>{restaurant.name}</strong>
                <span>CNPJ {restaurant.cnpj} · {restaurant.ownerEmail}</span>
                <small>Responsável: {restaurant.ownerName || "Não informado"}</small>
              </div>
              <div className="restaurant-billing">
                <strong>{accessIsCurrent ? "Pix confirmado" : "Aguardando Pix"}</strong>
                <span>{restaurant.monthlyPaidUntil ? "Mensalidade" : "Implantação + 1ª mensalidade"} · {formatCurrency(dueAmount)}</span>
              </div>
              <div className={`status-badge ${accessIsCurrent ? "ativo" : "inativo"}`}>
                {accessIsCurrent ? "Acesso liberado" : "Acesso bloqueado"}
              </div>
              <div className="restaurant-row-actions">
                {accessIsCurrent ? (
                  <button className="secondary-button" type="button" onClick={() => onOpenRestaurant(restaurant.id)}>
                    Abrir painel
                  </button>
                ) : (
                  <button className="primary-button" type="button" disabled={busy} onClick={() => void confirmPayment(restaurant)}>
                    <Check size={17} /> Confirmar Pix {restaurant.monthlyPaidUntil ? "mensal" : "e liberar"}
                  </button>
                )}
              </div>
            </article>
              );
            })()
          ))}
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => !busy && setShowForm(false)}>
          <form className="modal restaurant-create-modal" onSubmit={(event) => void createRestaurant(event)} onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><span className="eyebrow">NOVO CADASTRO</span><h2>Criar conta do restaurante</h2></div>
              <button type="button" onClick={() => setShowForm(false)} aria-label="Fechar" disabled={busy}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <label className="form-field"><span>Nome do restaurante</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required autoFocus /></label>
              <label className="form-field"><span>CNPJ</span><input value={form.cnpj} onChange={(event) => setForm({ ...form, cnpj: event.target.value })} placeholder="00.000.000/0000-00" required /></label>
              <label className="form-field"><span>Responsável</span><input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} required /></label>
              <label className="form-field"><span>Usuário (e-mail)</span><input type="email" value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} required /></label>
              <label className="form-field"><span>Senha inicial</span><input type="password" autoComplete="new-password" minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>
              <div className="restaurant-pix-box">
                <div><CircleDollarSign size={19} /><strong>Solicitação Pix</strong></div>
                <p>Implantação {formatCurrency(SETUP_FEE)} + primeira mensalidade {formatCurrency(MONTHLY_FEE)} = <strong>{formatCurrency(SETUP_FEE + MONTHLY_FEE)}</strong></p>
                <span>Chave Pix: {PIX_KEY}</span>
                <button className="secondary-button" type="button" onClick={() => void copyPixKey()}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Chave copiada" : "Copiar chave Pix"}
                </button>
              </div>
              {error && <div className="team-feedback error" role="alert">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="secondary-button" type="button" onClick={() => setShowForm(false)} disabled={busy}>Cancelar</button>
              <button className="primary-button" type="submit" disabled={busy}>
                <UserRoundPlus size={18} /> {busy ? "Criando conta..." : "Criar conta e solicitar Pix"}
              </button>
            </div>
          </form>
        </div>
      )}

      {lastCredentials && (
        <div className="modal-overlay" onClick={() => setLastCredentials(null)}>
          <section className="modal restaurant-credentials-modal" role="dialog" aria-modal="true" aria-labelledby="restaurant-credentials-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header"><h2 id="restaurant-credentials-title">Conta criada · aguardando Pix</h2><button type="button" onClick={() => setLastCredentials(null)} aria-label="Fechar"><X size={18} /></button></div>
            <div className="modal-body">
              <p>Compartilhe as credenciais iniciais com o responsável. O acesso ficará bloqueado até você confirmar o pagamento.</p>
              <div className="restaurant-credential-value"><span>Usuário</span><strong>{lastCredentials.email}</strong></div>
              <div className="restaurant-credential-value"><span>Senha inicial</span><strong>{lastCredentials.password}</strong></div>
              <div className="restaurant-pix-box"><strong>Pix a receber: {formatCurrency(SETUP_FEE + MONTHLY_FEE)}</strong><span>Chave Pix: {PIX_KEY}</span></div>
            </div>
            <div className="modal-footer"><button className="primary-button" type="button" onClick={() => setLastCredentials(null)}>Concluído</button></div>
          </section>
        </div>
      )}
    </section>
  );
}
