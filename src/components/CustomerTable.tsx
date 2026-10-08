import { tableDocId } from "../utils/ids";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ShoppingBag,
  Plus,
  Minus,
  X,
  Send,
  Bell,
  Receipt,
  CheckCircle2,
  Star,
  UtensilsCrossed,
  CreditCard,
  Clock,
  Phone,
  ArrowRight,
} from "lucide-react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { customerAuth, customerDb } from "../firebase";
import { useMenuCatalog } from "../hooks/useMenuCatalog";
import type { Product } from "../types/menu";
import { formatCurrency } from "../utils/format";
import { cartItemKey } from "../utils/cart";
import { orderApi } from "../utils/employeeApi";

type CartItem = {
  product: Product;
  quantity: number;
  extraIds: string[];
  notes: string;
};

type WaiterChoice = { id: string; name: string; role: string };
type RequestType = "waiter" | "bill";

function itemPrice(item: CartItem) {
  const extrasTotal = item.product.extras
    .filter((extra) => item.extraIds.includes(extra.id))
    .reduce((sum, extra) => sum + extra.price, 0);

  return item.product.price + extrasTotal;
}

function getCartKey(item: CartItem) {
  return cartItemKey({ productId: item.product.id, extraIds: item.extraIds, notes: item.notes });
}

export default function CustomerTable({
  tableNumber,
  restaurantId,
  accessToken,
}: {
  tableNumber: number;
  restaurantId: string;
  accessToken?: string;
}) {
  const { products, loading } = useMenuCatalog(restaurantId, customerDb);
  const waiterStorageKey = `servia-table-${restaurantId}-${tableNumber}-waiter`;

  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const pendingOrderRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [activeCategory, setActiveCategory] = useState("Todos");
  const [cartOpen, setCartOpen] = useState(false);
  const [customizing, setCustomizing] = useState<Product | null>(null);

  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [showPayment, setShowPayment] = useState(false);
  const [waiters, setWaiters] = useState<WaiterChoice[]>([]);
  const [waiterLoadError, setWaiterLoadError] = useState("");
  const [serviceRequestType, setServiceRequestType] = useState<RequestType | null>(null);
  const [assignedWaiterId, setAssignedWaiterId] = useState(() =>
    localStorage.getItem(waiterStorageKey) || "",
  );
  const [selectedWaiterId, setSelectedWaiterId] = useState(assignedWaiterId);
  const [customerUid, setCustomerUid] = useState<string | null>(null);
  const [pendingCall, setPendingCall] = useState(false);
  const [openOrders, setOpenOrders] = useState<Array<{ id: string; status: string; paymentStatus?: string; items: Array<{ productId: string; name: string; quantity: number; price: number }> }>>([]);

  const [actionLoading, setActionLoading] = useState<
    "order" | "waiter" | "bill" | "payment" | null
  >(null);

  const categories = useMemo(() => {
    const unique = Array.from(
      new Set(products.map((product) => product.category)),
    );

    return ["Todos", "Destaques", ...unique];
  }, [products]);

useEffect(() => {
    const unsubscribe = onAuthStateChanged(customerAuth, async (user) => {
      try {
        const customer = user?.isAnonymous ? user : (await signInAnonymously(customerAuth)).user;
        if (customer?.uid) {
          setCustomerUid(customer.uid);
        }
      } catch (error) {
        console.error("Não foi possível iniciar a sessão do cliente:", error);
        const code = typeof error === "object" && error && "code" in error
          ? String((error as { code: string }).code)
          : "";
        if (code === "auth/operation-not-allowed") {
          showMessage("O acesso anônimo está desativado no Firebase. Ative o provedor Anônimo para permitir pedidos pelo QR.");
        } else if (code === "auth/network-request-failed") {
          showMessage("Não foi possível conectar ao Firebase. Verifique sua conexão e tente novamente.");
        } else {
          showMessage("Não foi possível iniciar sua sessão. Tente atualizar a página.");
        }
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!customerUid) return;
    const pendingCalls = query(
      collection(customerDb, "tableCalls"),
      where("customerUid", "==", customerUid),
      where("tableId", "==", tableDocId(restaurantId, tableNumber)),
      where("status", "==", "pending"),
    );
    return onSnapshot(pendingCalls, (snapshot) => setPendingCall(!snapshot.empty), (error) => console.error("Erro ao consultar chamados pendentes:", error));
  }, [customerUid, restaurantId, tableNumber]);

  useEffect(() => {
    if (!customerUid) return;
    const orders = query(collection(customerDb, "orders"), where("restaurantId", "==", restaurantId), where("tableId", "==", `${tableDocId(restaurantId, tableNumber)}`), where("customerUid", "==", customerUid));
    return onSnapshot(orders, (snapshot) => setOpenOrders(snapshot.docs.map((item) => ({ id: item.id, status: String(item.data().status || "novo"), paymentStatus: item.data().paymentStatus, items: Array.isArray(item.data().items) ? item.data().items : [] })).filter((order) => order.status !== "cancelado")), (error) => console.error("Erro ao acompanhar pedidos:", error));
  }, [customerUid, restaurantId, tableNumber]);

  useEffect(() => {
    if (!customerUid) return;
    const activeWaiters = query(
      collection(customerDb, "waiterDirectory", restaurantId, "staff"),
      where("restaurantId", "==", restaurantId),
      where("active", "==", true),
    );
    return onSnapshot(
      activeWaiters,
      (snapshot) => {
        setWaiters(
          snapshot.docs
            .map((item) => ({
              id: item.id,
              name: String(item.data().name || "Garçom"),
              role: String(item.data().role || "Garçom"),
            }))
            .sort((first, second) => first.name.localeCompare(second.name, "pt-BR")),
        );
        setWaiterLoadError("");
      },
      (snapshotError) => {
        console.error("Erro ao carregar garçons disponíveis:", snapshotError);
        setWaiterLoadError("Não foi possível carregar os garçons.");
      },
    );
  }, [customerUid, restaurantId]);

  const filteredProducts = useMemo(() => {
    if (activeCategory === "Todos") {
      return products.filter((product) => product.available);
    }

    if (activeCategory === "Destaques") {
      return products.filter(
        (product) => product.available && product.featured,
      );
    }

    return products.filter(
      (product) =>
        product.available && product.category === activeCategory,
    );
  }, [activeCategory, products]);

  const cartItems = useMemo(
    () => Object.values(cart).filter((item) => item.quantity > 0),
    [cart],
  );

  const totalItems = useMemo(
    () =>
      cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems],
  );

  const total = useMemo(
    () =>
      cartItems.reduce(
        (sum, item) => sum + itemPrice(item) * item.quantity,
        0,
      ),
    [cartItems],
  );
  const accountTotal = useMemo(() => openOrders.filter((order) => order.paymentStatus !== "paid").reduce((sum, order) => sum + order.items.reduce((lineSum, item) => lineSum + Number(item.quantity || 0) * Number(item.price || 0), 0), 0), [openOrders]);
  const accountItemCount = useMemo(() => openOrders.filter((order) => order.paymentStatus !== "paid").reduce((sum, order) => sum + order.items.reduce((lineSum, item) => lineSum + Number(item.quantity || 0), 0), 0), [openOrders]);

  function upsertCart(item: CartItem) {
    const key = getCartKey(item);
    setCart((current) => {
      if (item.quantity <= 0) {
        const next = { ...current };
        delete next[key];
        return next;
      }

      return {
        ...current,
        [key]: { ...item, extraIds: [...item.extraIds].sort() },
      };
    });
  }

  function addSimpleProduct(product: Product) {
    if (product.extras.length > 0 || product.notesEnabled) {
      setCustomizing(product);
      return;
    }

    const current = cart[cartItemKey({ productId: product.id, extraIds: [], notes: "" })];

    upsertCart({
      product,
      quantity: (current?.quantity || 0) + 1,
      extraIds: [],
      notes: "",
    });
  }

  function changeQuantity(key: string, delta: number) {
    const current = cart[key];

    if (!current) {
      return;
    }

    upsertCart({
      ...current,
      quantity: current.quantity + delta,
    });
  }

  function showMessage(text: string) {
    setMessage(text);
  }

  async function sendOrder() {
    if (!cartItems.length || actionLoading) {
      return;
    }

    setActionLoading("order");
    setMessage("");

    try {
      if (!customerUid) throw new Error("A sessão anônima ainda não está pronta.");
      const orderItems = cartItems.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
          extras: item.product.extras
            .filter((extra) => item.extraIds.includes(extra.id))
            .map((extra) => extra.id),
          notes: item.notes,
        }));

      const requestFingerprint = JSON.stringify({
        restaurantId,
        tableId: `${tableDocId(restaurantId, tableNumber)}`,
        tableNumber,
        accessToken: accessToken || "",
        items: orderItems,
      });
      if (pendingOrderRef.current?.fingerprint !== requestFingerprint) {
        pendingOrderRef.current = { fingerprint: requestFingerprint, key: crypto.randomUUID() };
      }
      const idempotencyKey = pendingOrderRef.current.key;
      await orderApi("create", {
        restaurantId,
        tableId: `${tableDocId(restaurantId, tableNumber)}`,
        tableNumber,
        ...(accessToken ? { accessToken } : {}),
        idempotencyKey,
        items: orderItems,
      }, customerAuth);

      setSent(true);
      setCart({});
      setCartOpen(false);
      pendingOrderRef.current = null;
    } catch (error) {
      console.error("Erro ao enviar pedido:", error);

      const code = typeof error === "object" && error && "code" in error
        ? String((error as { code: string }).code)
        : "";
      if (code === "resource-exhausted") {
        showMessage("Aguarde 30 segundos antes de enviar novo pedido para esta mesa.");
      } else if (code === "not-found") {
        showMessage("Produto ou adicional não encontrado no cardápio.");
      } else if (code === "permission-denied") {
        showMessage("Token de acesso inválido ou restaurante indisponível.");
      } else {
        showMessage(
          "Não foi possível enviar o pedido agora. Verifique a conexão.",
        );
      }
    } finally {
      setActionLoading(null);
    }
  }

  function openServiceRequest(type: RequestType) {
    setSelectedWaiterId(assignedWaiterId);
    setServiceRequestType(type);
    setMessage("");
  }

  async function sendServiceRequest() {
    if (!serviceRequestType || !selectedWaiterId || actionLoading) {
      return;
    }

    const selectedWaiter = waiters.find((waiter) => waiter.id === selectedWaiterId);
    if (!selectedWaiter) {
      showMessage("Escolha um garçom ativo para continuar.");
      return;
    }

    const requestType = serviceRequestType;
    const requestCollection = requestType === "bill" ? "billRequests" : "tableCalls";
    setActionLoading(requestType);
    setMessage("");

try {
      const batch = writeBatch(customerDb);
      const requestRef = doc(customerDb, requestCollection, `${tableDocId(restaurantId, tableNumber)}_${requestType}`);
      if (!customerUid) throw new Error("Sessão do cliente não inicializada.");
      batch.set(requestRef, {
        restaurantId,
        tableId: `${tableDocId(restaurantId, tableNumber)}`,
        tableNumber,
        type: requestType,
        customerUid,
        ...(accessToken ? { accessToken } : {}),
        waiterId: selectedWaiter.id,
        waiterName: selectedWaiter.name,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      await batch.commit();

      setAssignedWaiterId(selectedWaiter.id);
      localStorage.setItem(waiterStorageKey, selectedWaiter.id);
      setServiceRequestType(null);
      showMessage(
        requestType === "waiter"
          ? `Chamado enviado para ${selectedWaiter.name}.`
          : `Pedido de conta enviado para ${selectedWaiter.name}.`,
      );
    } catch (error) {
      console.error("Erro ao enviar chamado:", error);
      showMessage("Não foi possível enviar a solicitação. Tente novamente.");
    } finally {
      setActionLoading(null);
    }
  }

  async function requestBill() {
    if (actionLoading) {
      return;
    }
    openServiceRequest("bill");
  }

  async function processPayment(method: "pix" | "card" | "cash") {
    if (actionLoading) {
      return;
    }

    setActionLoading("payment");
    setMessage("");

    try {
      // Sem integração com gateway, a solicitação não confirma que houve pagamento.
      await addDoc(collection(customerDb, "tableReleases"), {
        restaurantId,
        tableId: `${tableDocId(restaurantId, tableNumber)}`,
        tableNumber,
        totalAmount: accountTotal,
        paymentMethod: method,
        ...(accessToken ? { accessToken } : {}),
        status: "pending",
        createdAt: serverTimestamp(),
      });

      setShowPayment(false);
      setCart({});
      setCartOpen(false);

      showMessage(
        "Solicitação enviada. A confirmação do pagamento depende do estabelecimento.",
      );
    } catch (error) {
      console.error("Erro ao processar pagamento:", error);
      showMessage("Não foi possível processar o pagamento.");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="customer-page">
      <header className="customer-header">
        <div className="customer-brand">
          <div className="customer-logo">
            <UtensilsCrossed size={20} />
          </div>

          <div>
            <strong>Servia</strong>
            <span>Sistema de atendimento</span>
          </div>
        </div>

        <div className="customer-table-badge">
          <span>MESA</span>
          <strong>{tableNumber}</strong>
        </div>
      </header>

      <main className="customer-main">
        <section className="customer-hero">
          <div>
            <span>SEJA BEM-VINDO</span>

            <h1>
              Faça seu pedido
              <br />
              direto pela mesa.
            </h1>

            <p>
              Escolha seus pratos, envie o pedido e acompanhe seu
              atendimento sem precisar esperar.
            </p>
          </div>

          <div className="customer-table-number">
            <small>Você está na</small>
            <strong>Mesa {tableNumber}</strong>
          </div>
        </section>

        <div className="customer-actions">
          <button
            type="button"
            onClick={() => openServiceRequest("waiter")}
            disabled={actionLoading !== null || pendingCall}
          >
            <Bell size={19} />
            {actionLoading === "waiter" ? "Chamando..." : pendingCall ? "Chamado enviado, aguardando" : "Chamar garçom"}
          </button>

          <button
            type="button"
            onClick={requestBill}
            disabled={actionLoading !== null}
          >
            <Receipt size={19} />
            {actionLoading === "bill" ? "Solicitando..." : "Pedir a conta"}
          </button>

          {totalItems > 0 && !sent && (
            <button
              type="button"
              onClick={() => setShowPayment(true)}
              disabled={actionLoading !== null}
              className="payment-cta"
            >
              <CreditCard size={19} />
              Pagar agora
            </button>
          )}
        </div>

        {message && (
          <div className="customer-message">
            <CheckCircle2 size={18} />
            <span>{message}</span>
            <button
              type="button"
              onClick={() => setMessage("")}
              aria-label="Fechar mensagem"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {sent && (
          <div className="customer-success">
            <div className="customer-success-icon">
              <CheckCircle2 size={32} />
            </div>

            <h2>Pedido enviado!</h2>

            <p>
              Seu pedido foi enviado para a cozinha. A equipe já
              recebeu sua solicitação.
            </p>

            <button
              className="customer-primary"
              type="button"
              onClick={() => setSent(false)}
            >
              Continuar pedindo
            </button>
          </div>
        )}

        {!sent && (
          <>
            <div className="category-scroll">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={
                    activeCategory === category ? "active" : ""
                  }
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>

            <section className="customer-products">
              <div className="customer-section-title">
                <div>
                  <span>MENU</span>
                  <h2>
                    {activeCategory === "Todos"
                      ? "Escolha seu pedido"
                      : activeCategory}
                  </h2>
                </div>

                <span>
                  {loading
                    ? "Carregando..."
                    : `${filteredProducts.length} opções`}
                </span>
              </div>

              <div className="customer-product-grid">
                {filteredProducts.map((product) => {
          const quantity = Object.values(cart).filter((item) => item.product.id === product.id).reduce((sum, item) => sum + item.quantity, 0);

                  return (
                    <article
                      className="customer-product-card"
                      key={product.id}
                    >
                      <div className="product-placeholder">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt={product.name} />
                        ) : (
                          <UtensilsCrossed size={28} />
                        )}

                        {product.featured && (
                          <span className="customer-featured">
                            <Star size={12} />
                          </span>
                        )}
                      </div>

                      <div className="product-card-content">
                        <span>{product.category}</span>
                        <h3>{product.name}</h3>
                        <p>{product.description}</p>

                        <div className="product-card-footer">
                          <strong>{formatCurrency(product.price)}</strong>

                          {quantity === 0 ? (
                            <button
                              className="add-product"
                              type="button"
                              onClick={() => addSimpleProduct(product)}
                            >
                              <Plus size={18} />
                              Adicionar
                            </button>
                          ) : (
                            <div className="quantity-control">
                              <button
                                type="button"
                                onClick={() =>
                                  changeQuantity(product.id, -1)
                                }
                                aria-label={`Remover ${product.name}`}
                              >
                                <Minus size={16} />
                              </button>

                              <strong>{quantity}</strong>

                              <button
                                type="button"
                                onClick={() =>
                                  changeQuantity(product.id, 1)
                                }
                                aria-label={`Adicionar ${product.name}`}
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>

      {totalItems > 0 && !sent && (
        <button
          className="floating-cart"
          type="button"
          onClick={() => setCartOpen(true)}
        >
          <div className="floating-cart-icon">
            <ShoppingBag size={21} />
            <span>{totalItems}</span>
          </div>

          <div>
            <strong>Ver pedido</strong>
            <span>{formatCurrency(total)}</span>
          </div>

          <Send size={20} />
        </button>
      )}

      {cartOpen && (
        <div
          className="customer-cart-overlay"
          onClick={() => setCartOpen(false)}
          role="presentation"
        >
          <aside
            className="customer-cart"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-title"
          >
            <div className="cart-header">
              <div>
                <span>SEU PEDIDO</span>
                <h2 id="cart-title">Mesa {tableNumber}</h2>
              </div>

              <button
                type="button"
                onClick={() => setCartOpen(false)}
                aria-label="Fechar pedido"
              >
                <X size={20} />
              </button>
            </div>

            <div className="cart-items">
              {cartItems.map((item) => (
                <div className="cart-item" key={getCartKey(item)}>
                  <div>
                    <strong>{item.product.name}</strong>
                    <span>{formatCurrency(itemPrice(item))}</span>
                    {item.notes && <small>{item.notes}</small>}
                  </div>

                  <div className="cart-item-actions">
                    <button
                      type="button"
                      onClick={() =>
                        changeQuantity(getCartKey(item), -1)
                      }
                      aria-label={`Remover ${item.product.name}`}
                    >
                      <Minus size={15} />
                    </button>

                    <strong>{item.quantity}</strong>

                    <button
                      type="button"
                      onClick={() =>
                        changeQuantity(getCartKey(item), 1)
                      }
                      aria-label={`Adicionar ${item.product.name}`}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-footer">
              <div className="cart-total">
                <span>Total</span>
                <strong>{formatCurrency(total)}</strong>
              </div>

              <button
                className="customer-primary send-order-button"
                type="button"
                onClick={sendOrder}
                disabled={actionLoading !== null}
              >
                <Send size={18} />
                {actionLoading === "order"
                  ? "Enviando..."
                  : "Enviar pedido"}
              </button>

              <button
                className="customer-primary payment-button"
                type="button"
                onClick={() => setShowPayment(true)}
                disabled={actionLoading !== null}
              >
                <CreditCard size={18} />
                Pagar agora
              </button>
            </div>
          </aside>
        </div>
      )}

      {customizing && (
        <CustomizeModal
          product={customizing}
          current={Object.values(cart).find((item) => item.product.id === customizing.id)}
          onClose={() => setCustomizing(null)}
          onConfirm={(item) => {
            upsertCart(item);
            setCustomizing(null);
          }}
        />
      )}

      {showPayment && (
        <PaymentModal
          total={accountTotal}
          itemsCount={accountItemCount}
          onClose={() => setShowPayment(false)}
          onPayment={processPayment}
          loading={actionLoading === "payment"}
        />
      )}

      {serviceRequestType && (
        <div
          className="customer-waiter-overlay"
          onClick={() => setServiceRequestType(null)}
          role="presentation"
        >
          <section
            className="customer-waiter-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-waiter-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="customer-waiter-close"
              type="button"
              onClick={() => setServiceRequestType(null)}
              aria-label="Fechar seleção de garçom"
            >
              <X size={20} />
            </button>
            <span className="customer-waiter-eyebrow">MESA {tableNumber}</span>
            <h2 id="customer-waiter-title">
              {serviceRequestType === "waiter" ? "Quem vai atender você?" : "Para quem enviar a conta?"}
            </h2>
            <p>Escolha um garçom disponível no salão.</p>

            {waiterLoadError ? (
              <div className="customer-waiter-error">{waiterLoadError}</div>
            ) : waiters.length === 0 ? (
              <div className="customer-waiter-empty">Nenhum garçom está disponível no momento.</div>
            ) : (
              <label className="customer-waiter-select">
                <span>Garçom</span>
                <select
                  value={selectedWaiterId}
                  onChange={(event) => setSelectedWaiterId(event.target.value)}
                >
                  <option value="">Selecione um garçom</option>
                  {waiters.map((waiter) => (
                    <option key={waiter.id} value={waiter.id}>{waiter.name} · {waiter.role}</option>
                  ))}
                </select>
              </label>
            )}

            <button
              className="customer-primary customer-waiter-submit"
              type="button"
              onClick={() => void sendServiceRequest()}
              disabled={!waiters.some((waiter) => waiter.id === selectedWaiterId) || actionLoading !== null}
            >
              {actionLoading === serviceRequestType
                ? "Enviando..."
                : serviceRequestType === "waiter"
                  ? "Chamar garçom"
                  : "Solicitar conta"}
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function CustomizeModal({
  product,
  current,
  onClose,
  onConfirm,
}: {
  product: Product;
  current?: CartItem;
  onClose: () => void;
  onConfirm: (item: CartItem) => void;
}) {
  const [quantity, setQuantity] = useState(current?.quantity || 1);
  const [extraIds, setExtraIds] = useState<string[]>(
    current?.extraIds || [],
  );
  const [notes, setNotes] = useState(current?.notes || "");

  function toggleExtra(extraId: string) {
    setExtraIds((currentIds) =>
      currentIds.includes(extraId)
        ? currentIds.filter((id) => id !== extraId)
        : [...currentIds, extraId],
    );
  }

  const preview: CartItem = {
    product,
    quantity,
    extraIds,
    notes,
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal customer-customize-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          className="modal-close"
          type="button"
          onClick={onClose}
          aria-label="Fechar"
        >
          <X size={20} />
        </button>

        <div className="modal-title">
          <span>{product.category}</span>
          <h2>{product.name}</h2>
          <p>{product.description}</p>
        </div>

        {product.extras.length > 0 && (
          <div className="customize-extras">
            <strong>Adicionais</strong>

            {product.extras.map((extra) => (
              <label key={extra.id}>
                <input
                  type="checkbox"
                  checked={extraIds.includes(extra.id)}
                  onChange={() => toggleExtra(extra.id)}
                />
                <span>{extra.name}</span>
                <small>+ {formatCurrency(extra.price)}</small>
              </label>
            ))}
          </div>
        )}

        {product.notesEnabled && (
          <label className="form-field">
            <span>Observações</span>
            <textarea
              rows={3}
              placeholder="Ex.: sem cebola, ponto da carne..."
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        )}

        <div className="quantity-control customize-qty">
          <button
            type="button"
            onClick={() => setQuantity(Math.max(1, quantity - 1))}
          >
            <Minus size={16} />
          </button>
          <strong>{quantity}</strong>
          <button
            type="button"
            onClick={() => setQuantity(quantity + 1)}
          >
            <Plus size={16} />
          </button>
        </div>

        <button
          className="customer-primary"
          type="button"
          onClick={() => onConfirm(preview)}
        >
          Adicionar · {formatCurrency(itemPrice(preview) * quantity)}
        </button>
      </div>
    </div>
  );
}

function PaymentModal({
  total,
  itemsCount,
  onClose,
  onPayment,
  loading,
}: {
  total: number;
  itemsCount: number;
  onClose: () => void;
  onPayment: (method: "pix" | "card" | "cash") => void;
  loading: boolean;
}) {
  const [selectedMethod, setSelectedMethod] = useState<"pix" | "card" | "cash">("pix");

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal payment-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          className="modal-close"
          type="button"
          onClick={onClose}
          aria-label="Fechar pagamento"
        >
          <X size={20} />
        </button>

        <div className="modal-icon payment-modal-icon">
          <CreditCard size={25} />
        </div>

        <div className="modal-title">
          <span>PAGAMENTO</span>
          <h2>Pagar conta</h2>
          <p>
            {itemsCount} itens · {formatCurrency(total)}
          </p>
        </div>

        <div className="payment-methods">
          <button
            type="button"
            className={`payment-method-option ${selectedMethod === "pix" ? "active" : ""}`}
            onClick={() => setSelectedMethod("pix")}
          >
            <div className="payment-method-icon pix">
              <Phone size={24} />
            </div>
            <div>
              <strong>PIX</strong>
              <span>Pagamento instantâneo</span>
            </div>
            <ArrowRight size={16} />
          </button>

          <button
            type="button"
            className={`payment-method-option ${selectedMethod === "card" ? "active" : ""}`}
            onClick={() => setSelectedMethod("card")}
          >
            <div className="payment-method-icon card">
              <CreditCard size={24} />
            </div>
            <div>
              <strong>Cartão</strong>
              <span>Crédito ou débito</span>
            </div>
            <ArrowRight size={16} />
          </button>

          <button
            type="button"
            className={`payment-method-option ${selectedMethod === "cash" ? "active" : ""}`}
            onClick={() => setSelectedMethod("cash")}
          >
            <div className="payment-method-icon cash">
              <Receipt size={24} />
            </div>
            <div>
              <strong>Dinheiro</strong>
              <span>Pagamento em espécie</span>
            </div>
            <ArrowRight size={16} />
          </button>
        </div>

        <div className="payment-summary">
          <div className="payment-summary-row">
            <span>Subtotal</span>
            <strong>{formatCurrency(total)}</strong>
          </div>

          <div className="payment-summary-row">
            <span>Taxa de serviço (10%)</span>
            <strong>{formatCurrency(total * 0.1)}</strong>
          </div>

          <div className="payment-summary-row total">
            <span>Total</span>
            <strong>{formatCurrency(total * 1.1)}</strong>
          </div>
        </div>

        <div className="payment-info">
          <Clock size={16} />
          <span>Ao pagar, sua mesa será liberada automaticamente para o próximo cliente.</span>
        </div>

        <div className="modal-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={onClose}
          >
            Cancelar
          </button>

          <button
            className="primary-button"
            type="button"
            onClick={() => onPayment(selectedMethod)}
            disabled={loading}
          >
            {loading ? "Processando..." : `Pagar ${formatCurrency(total * 1.1)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
