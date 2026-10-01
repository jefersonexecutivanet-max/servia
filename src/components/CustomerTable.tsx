import { useEffect, useMemo, useState } from "react";
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
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";
import { useMenuCatalog } from "../hooks/useMenuCatalog";
import type { Product } from "../types/menu";
import { formatCurrency } from "../utils/format";

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

export default function CustomerTable({
  tableNumber,
  restaurantId,
}: {
  tableNumber: number;
  restaurantId: string;
}) {
  const { products, loading } = useMenuCatalog(restaurantId);
  const waiterStorageKey = `servia-table-${restaurantId}-${tableNumber}-waiter`;

  const [cart, setCart] = useState<Record<string, CartItem>>({});
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
    const activeWaiters = query(
      collection(db, "waiterDirectory"),
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
  }, [restaurantId]);

  useEffect(() => {
    const assignmentRef = doc(db, "waiterTables", `${restaurantId}_${tableNumber}`);
    return onSnapshot(
      assignmentRef,
      (snapshot) => {
        const waiterId = String(snapshot.data()?.waiterId || "");
        setAssignedWaiterId(waiterId);
        if (waiterId) {
          localStorage.setItem(waiterStorageKey, waiterId);
        }
      },
      (assignmentError) => {
        console.error("Erro ao carregar o garçom da mesa:", assignmentError);
      },
    );
  }, [restaurantId, tableNumber, waiterStorageKey]);

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

  function upsertCart(item: CartItem) {
    setCart((current) => {
      if (item.quantity <= 0) {
        const next = { ...current };
        delete next[item.product.id];
        return next;
      }

      return {
        ...current,
        [item.product.id]: item,
      };
    });
  }

  function addSimpleProduct(product: Product) {
    if (product.extras.length > 0 || product.notesEnabled) {
      setCustomizing(product);
      return;
    }

    const current = cart[product.id];

    upsertCart({
      product,
      quantity: (current?.quantity || 0) + 1,
      extraIds: [],
      notes: "",
    });
  }

  function changeQuantity(productId: string, delta: number) {
    const current = cart[productId];

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
      let currentWaiterId = assignedWaiterId;
      try {
        const assignment = await getDoc(
          doc(db, "waiterTables", `${restaurantId}_${tableNumber}`),
        );
        currentWaiterId = String(assignment.data()?.waiterId || currentWaiterId);
      } catch (assignmentError) {
        console.warn("Usando o garçom salvo neste dispositivo:", assignmentError);
        currentWaiterId = localStorage.getItem(waiterStorageKey) || currentWaiterId;
      }
      setAssignedWaiterId(currentWaiterId);

      await addDoc(collection(db, "orders"), {
        restaurantId,
        tableNumber,
        ...(currentWaiterId ? { waiterId: currentWaiterId } : {}),
        status: "novo",
        source: "qrcode",
        items: cartItems.map((item) => ({
          productId: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          price: itemPrice(item),
          extras: item.product.extras
            .filter((extra) => item.extraIds.includes(extra.id))
            .map((extra) => extra.name),
          notes: item.notes,
        })),
        total,
        createdAt: serverTimestamp(),
      });

      setSent(true);
      setCart({});
      setCartOpen(false);
    } catch (error) {
      console.error("Erro ao enviar pedido:", error);

      showMessage(
        "Não foi possível enviar o pedido agora. Verifique a conexão.",
      );
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
      const batch = writeBatch(db);
      const requestRef = doc(collection(db, requestCollection));
      const assignmentRef = doc(db, "waiterTables", `${restaurantId}_${tableNumber}`);
      batch.set(requestRef, {
        restaurantId,
        tableNumber,
        type: requestType,
        waiterId: selectedWaiter.id,
        waiterName: selectedWaiter.name,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      batch.set(assignmentRef, {
        restaurantId,
        tableNumber,
        waiterId: selectedWaiter.id,
        waiterName: selectedWaiter.name,
        updatedAt: serverTimestamp(),
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
      // Aqui você integraria com o gateway de pagamento real
      // Por enquanto, vamos simular o processo
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Registrar pagamento no Firebase
      await addDoc(collection(db, "payments"), {
        restaurantId,
        tableNumber,
        method,
        amount: total,
        items: cartItems.length,
        status: "completed",
        createdAt: serverTimestamp(),
      });

      // Solicitar liberação da mesa
      await addDoc(collection(db, "tableReleases"), {
        restaurantId,
        tableNumber,
        totalAmount: total,
        paymentMethod: method,
        status: "pending",
        createdAt: serverTimestamp(),
      });

      setShowPayment(false);
      setSent(true);
      setCart({});
      setCartOpen(false);

      showMessage(
        "Pagamento realizado! Sua mesa será liberada em breve.",
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
            disabled={actionLoading !== null}
          >
            <Bell size={19} />
            {actionLoading === "waiter" ? "Chamando..." : "Chamar garçom"}
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
                  const quantity = cart[product.id]?.quantity || 0;

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
                <div className="cart-item" key={item.product.id}>
                  <div>
                    <strong>{item.product.name}</strong>
                    <span>{formatCurrency(itemPrice(item))}</span>
                    {item.notes && <small>{item.notes}</small>}
                  </div>

                  <div className="cart-item-actions">
                    <button
                      type="button"
                      onClick={() =>
                        changeQuantity(item.product.id, -1)
                      }
                      aria-label={`Remover ${item.product.name}`}
                    >
                      <Minus size={15} />
                    </button>

                    <strong>{item.quantity}</strong>

                    <button
                      type="button"
                      onClick={() =>
                        changeQuantity(item.product.id, 1)
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
          current={cart[customizing.id]}
          onClose={() => setCustomizing(null)}
          onConfirm={(item) => {
            upsertCart(item);
            setCustomizing(null);
          }}
        />
      )}

      {showPayment && (
        <PaymentModal
          total={total}
          itemsCount={totalItems}
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
