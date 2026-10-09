import { useEffect, useMemo, useState, useRef } from "react";
import {
  X,
  Plus,
  Minus,
  Search,
  Filter,
  Send,
  Loader2,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { useMenuCatalog } from "../../hooks/useMenuCatalog";
import type { Product } from "../../types/menu";
import { formatCurrency } from "../../utils/format";
import { orderApi } from "../../utils/employeeApi";
import { useRestaurantScope } from "../../contexts/RestaurantContext";

type CartItem = {
  product: Product;
  quantity: number;
  extraIds: string[];
  notes: string;
};

function itemPrice(item: CartItem): number {
  const extrasTotal = item.product.extras
    .filter((extra: { id: string; price: number }) => item.extraIds.includes(extra.id))
    .reduce((sum: number, extra: { price: number }) => sum + extra.price, 0);
  return item.product.price + extrasTotal;
}

function cartItemKey(item: CartItem): string {
  return `${item.product.id}|${item.extraIds.sort().join(",")}|${item.notes || ""}`;
}

export default function WaiterOrderComposer({
  tableNumber,
  tableId,
  accessToken,
  onClose,
  onSuccess,
}: {
  tableNumber: number;
  tableId: string;
  accessToken?: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { restaurantId } = useRestaurantScope();
  const { products, loading: menuLoading, error: menuError } = useMenuCatalog(restaurantId);

  const [cart, setCart] = useState<Record<string, CartItem>>({});
  const [activeCategory, setActiveCategory] = useState("Todos");
  const [searchQuery, setSearchQuery] = useState("");
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const pendingOrderRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (categoryRef.current && !categoryRef.current.contains(event.target as Node)) {
        setShowCategoryFilter(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(products.map((p: Product) => p.category)));
    return ["Todos", "Destaques", ...unique];
  }, [products]);

  const filteredProducts = useMemo(() => {
    let result = products.filter((p: Product) => p.available);
    if (activeCategory === "Destaques") {
      result = result.filter((p: Product) => p.featured);
    } else if (activeCategory !== "Todos") {
      result = result.filter((p: Product) => p.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((p: Product) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [products, activeCategory, searchQuery]);

  const cartItems = useMemo(() => Object.values(cart).filter((i: CartItem) => i.quantity > 0), [cart]);
  const totalItems = cartItems.reduce((sum: number, i: CartItem) => sum + i.quantity, 0);
  const total = cartItems.reduce((sum: number, i: CartItem) => sum + itemPrice(i) * i.quantity, 0);

  function upsertCart(item: CartItem) {
    const key = cartItemKey(item);
    setCart((current) => {
      if (item.quantity <= 0) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: { ...item, extraIds: [...item.extraIds].sort() } };
    });
  }

  function addSimpleProduct(product: Product) {
    if (product.extras.length > 0 || product.notesEnabled) {
      setCustomizing(product);
      return;
    }
    const key = cartItemKey({ product, quantity: 1, extraIds: [], notes: "" });
    const current = cart[key];
    upsertCart({ product, quantity: (current?.quantity || 0) + 1, extraIds: [], notes: "" });
  }

  function changeQuantity(key: string, delta: number) {
    const current = cart[key];
    if (!current) return;
    upsertCart({ ...current, quantity: current.quantity + delta });
  }

  async function sendOrder() {
    if (!cartItems.length || sending) return;
    setSending(true);
    setError("");

    try {
      const orderItems = cartItems.map((item: CartItem) => ({
        productId: item.product.id,
        quantity: item.quantity,
        extras: item.product.extras
          .filter((extra: { id: string }) => item.extraIds.includes(extra.id))
          .map((extra: { id: string }) => extra.id),
        notes: item.notes,
      }));

      const requestFingerprint = JSON.stringify({
        restaurantId,
        tableId,
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
        tableId,
        tableNumber,
        ...(accessToken ? { accessToken } : {}),
        idempotencyKey,
        items: orderItems,
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err: unknown) {
      console.error("Erro ao enviar pedido:", err);
      const code = typeof err === "object" && err && "code" in err
        ? String((err as { code: string }).code)
        : "";
      if (code === "resource-exhausted") {
        setError("Aguarde 30 segundos antes de enviar novo pedido para esta mesa.");
      } else if (code === "not-found") {
        setError("Produto ou adicional não encontrado no cardápio.");
      } else if (code === "permission-denied") {
        setError("Token de acesso inválido ou restaurante indisponível.");
      } else {
        setError("Não foi possível enviar o pedido. Verifique a conexão.");
      }
    } finally {
      setSending(false);
    }
  }

  if (menuLoading) {
    return (
      <div className="waiter-order-composer-overlay" onClick={onClose}>
        <div className="waiter-order-composer-modal" onClick={(e) => e.stopPropagation()}>
          <div className="composer-loading">
            <Loader2 className="spinning" size={24} />
            <p>Carregando cardápio...</p>
          </div>
        </div>
      </div>
    );
  }

  if (menuError) {
    return (
      <div className="waiter-order-composer-overlay" onClick={onClose}>
        <div className="waiter-order-composer-modal" onClick={(e) => e.stopPropagation()}>
          <div className="composer-error">
            <XCircle size={24} />
            <p>{menuError}</p>
            <button className="primary-button" type="button" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="waiter-order-composer-overlay" onClick={onClose}>
      <div className="waiter-order-composer-modal" onClick={(e) => e.stopPropagation()}>
        <header className="composer-header">
          <div>
            <h2>Novo Pedido · Mesa {tableNumber}</h2>
            <p className="composer-subtitle">{cartItems.length} item{cartItems.length !== 1 ? "s" : ""} · {formatCurrency(total)}</p>
          </div>
          <button className="composer-close" type="button" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        {customizing && (
          <div className="composer-customize-panel">
            <div className="customize-header">
              <h3>Personalizar: {customizing.name}</h3>
              <button type="button" onClick={() => setCustomizing(null)}><X size={20} /></button>
            </div>
            {customizing.extras.length > 0 && (
              <div className="customize-section">
                <label>Adicionais</label>
                <div className="extras-grid">
                  {customizing.extras.map((extra: { id: string; name: string; price: number }) => (
                    <label key={extra.id} className="extra-option">
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => {}}
                      />
                      <span>{extra.name}</span>
                      <strong>+{formatCurrency(extra.price)}</strong>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {customizing.notesEnabled && (
              <div className="customize-section">
                <label>Observações</label>
                <textarea
                  placeholder="Ex: sem cebola, ponto da carne..."
                  rows={2}
                />
              </div>
            )}
            <div className="customize-actions">
              <button className="secondary-button" type="button" onClick={() => setCustomizing(null)}>Cancelar</button>
              <button className="primary-button" type="button" onClick={() => {
                upsertCart({ product: customizing, quantity: 1, extraIds: [], notes: "" });
                setCustomizing(null);
              }}>Adicionar</button>
            </div>
          </div>
        )}

        <div className="composer-body">
          <aside className="composer-menu" aria-label="Cardápio">
            <div className="menu-search">
              <Search size={18} />
              <input
                type="search"
                placeholder="Buscar no cardápio..."
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="menu-categories" ref={categoryRef}>
              <button
                className={`category-trigger ${showCategoryFilter ? "open" : ""}`}
                type="button"
                onClick={() => setShowCategoryFilter(!showCategoryFilter)}
                aria-expanded={showCategoryFilter}
              >
                <Filter size={18} />
                <span>{activeCategory}</span>
                <ChevronDown size={16} />
              </button>
              {showCategoryFilter && (
                <div className="category-dropdown">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      className={`category-option ${activeCategory === cat ? "active" : ""}`}
                      onClick={() => { setActiveCategory(cat); setShowCategoryFilter(false); }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="menu-products">
              {filteredProducts.length === 0 ? (
                <p className="menu-empty">Nenhum produto encontrado.</p>
              ) : (
                filteredProducts.map((product) => (
                  <article key={product.id} className="menu-product-card">
                    <div className="product-info">
                      <strong>{product.name}</strong>
                      <span className="product-category">{product.category}</span>
                      {product.description && <p className="product-description">{product.description}</p>}
                      <div className="product-price">{formatCurrency(product.price)}</div>
                    </div>
                    <button
                      type="button"
                      className="add-to-cart"
                      onClick={() => addSimpleProduct(product)}
                      aria-label={`Adicionar ${product.name}`}
                    >
                      <Plus size={18} />
                    </button>
                  </article>
                ))
              )}
            </div>
          </aside>

          <aside className="composer-cart" aria-label="Carrinho">
            <div className="cart-header">
              <h3>Seu Pedido</h3>
              {cartItems.length > 0 && (
                <button type="button" className="clear-cart" onClick={() => setCart({})}>Limpar</button>
              )}
            </div>

            {cartItems.length === 0 ? (
              <div className="cart-empty">
                <Send size={32} />
                <p>Nenhum item no pedido</p>
                <span>Selecione produtos do cardápio</span>
              </div>
            ) : (
              <>
                <ul className="cart-items">
                  {cartItems.map((item: CartItem) => (
                    <li key={cartItemKey(item)} className="cart-item">
                      <div className="item-main">
                        <div className="item-info">
                          <strong>{item.product.name}</strong>
                          {item.extraIds.length > 0 && (
                            <span className="item-extras">
                              {item.product.extras.filter((e: { id: string; name: string }) => item.extraIds.includes(e.id)).map((e: { name: string }) => e.name).join(", ")}
                            </span>
                          )}
                          {item.notes && <span className="item-notes">"{item.notes}"</span>}
                        </div>
                        <strong className="item-total">{formatCurrency(itemPrice(item) * item.quantity)}</strong>
                      </div>
                      <div className="item-controls">
                        <button type="button" onClick={() => changeQuantity(cartItemKey(item), -1)} aria-label="Diminuir"><Minus size={16} /></button>
                        <span>{item.quantity}</span>
                        <button type="button" onClick={() => changeQuantity(cartItemKey(item), 1)} aria-label="Aumentar"><Plus size={16} /></button>
                        <button type="button" className="remove-item" onClick={() => upsertCart({ ...item, quantity: 0 })} aria-label="Remover"><XCircle size={16} /></button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="cart-summary">
                  <div className="summary-line">
                    <span>Subtotal ({totalItems} item{totalItems !== 1 ? "s" : ""})</span>
                    <strong>{formatCurrency(total)}</strong>
                  </div>
                  <button
                    type="button"
                    className="primary-button send-order"
                    onClick={sendOrder}
                    disabled={sending}
                  >
                    {sending ? <Loader2 className="spinning" size={18} /> : <Send size={18} />}
                    {sending ? "Enviando..." : "Enviar para a Cozinha"}
                  </button>
                  {error && <p className="cart-error" role="alert">{error}</p>}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}