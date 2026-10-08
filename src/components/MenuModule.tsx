import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  BookOpen,
  CheckCircle2,
  Pencil,
  Plus,
  Star,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { MENU_CATEGORIES } from "../data/menuCatalog";
import { useMenuCatalog } from "../hooks/useMenuCatalog";
import type { Product, ProductExtra, ProductRecipeItem } from "../types/menu";
import { formatCurrency } from "../utils/format";
import { useRestaurantScope } from "../contexts/RestaurantContext";
import { db } from "../firebase";

function createEmptyProduct(): Product {
  return {
    id: `prod-${Date.now()}`,
    name: "",
    description: "",
    price: 0,
    category: MENU_CATEGORIES[0],
    imageUrl: "",
    available: true,
    featured: false,
    extras: [],
    notesEnabled: true,
    recipe: [],
  };
}

export default function MenuModule() {
  const { restaurantId } = useRestaurantScope();
  const {
    products,
    fromRemote,
    loading,
    error,
    saveProduct,
    deleteProduct,
    publishCatalog,
  } = useMenuCatalog(restaurantId);

  const [filter, setFilter] = useState("Todos");
  const [editing, setEditing] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [stockItems, setStockItems] = useState<Array<{ id: string; name: string; unit: string }>>([]);

  useEffect(() => {
    setStockItems([]);
    if (!restaurantId) return;
    return onSnapshot(query(collection(db, "stock"), where("restaurantId", "==", restaurantId)), (snapshot) => {
      setStockItems(snapshot.docs.map((item) => ({ id: item.id, name: String(item.data().name || "Ingrediente"), unit: String(item.data().unit || "un") })));
    }, (loadError) => console.error("Erro ao carregar ingredientes do estoque:", loadError));
  }, [restaurantId]);

  const categories = useMemo(
    () => ["Todos", ...MENU_CATEGORIES],
    [],
  );

  const visibleProducts = useMemo(() => {
    if (filter === "Todos") {
      return products;
    }

    return products.filter((product) => product.category === filter);
  }, [filter, products]);

  async function handleSave(product: Product) {
    setBusy(true);
    setMessage("");

    try {
      await saveProduct(product);
      setEditing(null);
      setMessage("Produto salvo no cardápio.");
    } catch (saveError) {
      console.error(saveError);
      setMessage("Não foi possível salvar o produto.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(product: Product) {
    const confirmed = window.confirm(
      `Excluir "${product.name}" do cardápio?`,
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      if (!fromRemote) {
        setMessage(
          "Publique o cardápio primeiro para poder excluir produtos sincronizados.",
        );
        return;
      }

      await deleteProduct(product.id);
      setMessage("Produto removido.");
    } catch (deleteError) {
      console.error(deleteError);
      setMessage("Não foi possível excluir o produto.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    setBusy(true);
    setMessage("");

    try {
      await publishCatalog(products);
      setMessage("Cardápio publicado para as mesas e o QR Code.");
    } catch (publishError) {
      console.error(publishError);
      setMessage("Não foi possível publicar o cardápio.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFlag(
    product: Product,
    field: "available" | "featured",
  ) {
    setBusy(true);
    setMessage("");

    try {
      await saveProduct({
        ...product,
        [field]: !product[field],
      });
    } catch (toggleError) {
      console.error(toggleError);
      setMessage("Não foi possível atualizar o produto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="menu-page">
      <div className="module-header">
        <div>
          <div className="eyebrow">OPERAÇÃO</div>
          <h1>Cardápio</h1>
          <p>
            Cadastre produtos, categorias, preços e disponibilidade
            usados nas mesas e no pedido pelo QR Code.
          </p>
        </div>

        <div className="module-header-actions">
          {!fromRemote && (
            <button
              className="secondary-button"
              type="button"
              onClick={handlePublish}
              disabled={busy}
            >
              Publicar cardápio
            </button>
          )}

          <button
            className="primary-button"
            type="button"
            onClick={() => setEditing(createEmptyProduct())}
            disabled={busy}
          >
            <Plus size={18} />
            Novo produto
          </button>
        </div>
      </div>

      {error && <div className="menu-banner">{error}</div>}
      {message && <div className="menu-banner success">{message}</div>}

      <div className="menu-summary">
        <div className="menu-summary-card">
          <strong>{products.length}</strong>
          <span>Produtos</span>
        </div>

        <div className="menu-summary-card">
          <strong>
            {products.filter((product) => product.available).length}
          </strong>
          <span>Disponíveis</span>
        </div>

        <div className="menu-summary-card">
          <strong>
            {products.filter((product) => product.featured).length}
          </strong>
          <span>Destaques</span>
        </div>

        <div className="menu-summary-card">
          <strong>{MENU_CATEGORIES.length}</strong>
          <span>Categorias</span>
        </div>
      </div>

      <div className="menu-filters">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={filter === category ? "active" : ""}
            onClick={() => setFilter(category)}
          >
            {category}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="menu-empty">
          <BookOpen size={28} />
          <h3>Carregando cardápio</h3>
          <p>Buscando produtos cadastrados no Servia.</p>
        </div>
      ) : visibleProducts.length === 0 ? (
        <div className="menu-empty">
          <UtensilsCrossed size={28} />
          <h3>Nenhum produto nesta categoria</h3>
          <p>Cadastre um item para começar a montar o cardápio.</p>
        </div>
      ) : (
        <div className="menu-grid">
          {visibleProducts.map((product) => (
            <article className="menu-card" key={product.id}>
              <div className="menu-card-media">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} />
                ) : (
                  <UtensilsCrossed size={28} />
                )}

                {product.featured && (
                  <span className="menu-featured">
                    <Star size={12} />
                    Destaque
                  </span>
                )}
              </div>

              <div className="menu-card-body">
                <span>{product.category}</span>
                <h3>{product.name}</h3>
                <p>{product.description}</p>

                <strong>{formatCurrency(product.price)}</strong>

                {product.extras.length > 0 && (
                  <small>
                    {product.extras.length} adicionais
                  </small>
                )}

                <div className="menu-card-flags">
                  <button
                    type="button"
                    className={product.available ? "on" : ""}
                    onClick={() => toggleFlag(product, "available")}
                    disabled={busy}
                  >
                    {product.available ? "Disponível" : "Indisponível"}
                  </button>

                  <button
                    type="button"
                    className={product.featured ? "on" : ""}
                    onClick={() => toggleFlag(product, "featured")}
                    disabled={busy}
                  >
                    Destaque
                  </button>
                </div>

                <div className="menu-card-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setEditing(product)}
                  >
                    <Pencil size={16} />
                    Editar
                  </button>

                  <button
                    className="icon-button danger-icon"
                    type="button"
                    onClick={() => handleDelete(product)}
                    aria-label={`Excluir ${product.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <ProductFormModal
          product={editing}
          stockItems={stockItems}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function ProductFormModal({
  product,
  stockItems,
  busy,
  onClose,
  onSave,
}: {
  product: Product;
  stockItems: Array<{ id: string; name: string; unit: string }>;
  busy: boolean;
  onClose: () => void;
  onSave: (product: Product) => void;
}) {
  const [form, setForm] = useState<Product>(product);
  const [extraName, setExtraName] = useState("");
  const [extraPrice, setExtraPrice] = useState("");
  const [recipeStockId, setRecipeStockId] = useState("");
  const [recipeQuantity, setRecipeQuantity] = useState("");

  function addExtra() {
    if (!extraName.trim()) {
      return;
    }

    const extra: ProductExtra = {
      id: `extra-${Date.now()}`,
      name: extraName.trim(),
      price: Number(extraPrice || 0),
    };

    setForm((current) => ({
      ...current,
      extras: [...current.extras, extra],
    }));

    setExtraName("");
    setExtraPrice("");
  }

  function removeExtra(extraId: string) {
    setForm((current) => ({
      ...current,
      extras: current.extras.filter((extra) => extra.id !== extraId),
    }));
  }

  function addRecipeItem() {
    const quantity = Number(recipeQuantity);
    if (!recipeStockId || !Number.isFinite(quantity) || quantity <= 0) return;
    setForm((current) => ({ ...current, recipe: [...(current.recipe || []), { stockId: recipeStockId, quantity }] }));
    setRecipeQuantity("");
  }

  function removeRecipeItem(stockId: string) {
    setForm((current) => ({ ...current, recipe: (current.recipe || []).filter((item) => item.stockId !== stockId) }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      window.alert("Informe o nome do produto.");
      return;
    }

    if (form.price < 0) {
      window.alert("O preço não pode ser negativo.");
      return;
    }

    onSave({
      ...form,
      name: form.name.trim(),
      description: form.description.trim(),
      imageUrl: form.imageUrl.trim(),
    });
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal menu-form-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          className="modal-close"
          type="button"
          onClick={onClose}
          aria-label="Fechar formulário"
        >
          <X size={20} />
        </button>

        <div className="modal-icon table-form-icon">
          <UtensilsCrossed size={24} />
        </div>

        <div className="modal-title">
          <span>CARDÁPIO</span>
          <h2>
            {product.name ? "Editar produto" : "Novo produto"}
          </h2>
          <p>Esses dados aparecem no pedido da mesa.</p>
        </div>

        <form className="table-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Nome</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              required
            />
          </label>

          <label className="form-field">
            <span>Descrição</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>

          <div className="form-row">
            <label className="form-field">
              <span>Preço</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) =>
                  setForm({
                    ...form,
                    price: Number(event.target.value),
                  })
                }
              />
            </label>

            <label className="form-field">
              <span>Categoria</span>
              <select
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
              >
                {MENU_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="form-field">
            <span>URL da imagem</span>
            <input
              type="url"
              placeholder="https://"
              value={form.imageUrl}
              onChange={(event) =>
                setForm({ ...form, imageUrl: event.target.value })
              }
            />
          </label>

          <div className="menu-form-toggles">
            <label>
              <input
                type="checkbox"
                checked={form.available}
                onChange={(event) =>
                  setForm({
                    ...form,
                    available: event.target.checked,
                  })
                }
              />
              Disponível
            </label>

            <label>
              <input
                type="checkbox"
                checked={form.featured}
                onChange={(event) =>
                  setForm({
                    ...form,
                    featured: event.target.checked,
                  })
                }
              />
              Destaque
            </label>

            <label>
              <input
                type="checkbox"
                checked={form.notesEnabled}
                onChange={(event) =>
                  setForm({
                    ...form,
                    notesEnabled: event.target.checked,
                  })
                }
              />
              Permitir observações
            </label>
          </div>

          <div className="menu-extras-editor">
            <span>Ficha técnica · quantidade por unidade</span>

            {(form.recipe || []).map((ingredient: ProductRecipeItem) => {
              const stockItem = stockItems.find((item) => item.id === ingredient.stockId);
              return <div className="menu-extra-row" key={ingredient.stockId}>
                <strong>{stockItem?.name || "Ingrediente indisponível"}</strong>
                <span>{ingredient.quantity} {stockItem?.unit || "un"}</span>
                <button type="button" onClick={() => removeRecipeItem(ingredient.stockId)}>Remover</button>
              </div>;
            })}

            <div className="menu-extra-inputs">
              <select aria-label="Ingrediente da ficha técnica" value={recipeStockId} onChange={(event) => setRecipeStockId(event.target.value)}>
                <option value="">Selecionar ingrediente</option>
                {stockItems.filter((item) => !(form.recipe || []).some((recipe) => recipe.stockId === item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>)}
              </select>
              <input type="number" min="0.001" step="0.001" placeholder="Quantidade" value={recipeQuantity} onChange={(event) => setRecipeQuantity(event.target.value)} />
              <button type="button" onClick={addRecipeItem} disabled={!recipeStockId || !recipeQuantity}>Adicionar</button>
            </div>
          </div>

          <div className="menu-extras-editor">
            <span>Adicionais</span>

            {form.extras.map((extra) => (
              <div className="menu-extra-row" key={extra.id}>
                <strong>{extra.name}</strong>
                <span>{formatCurrency(extra.price)}</span>
                <button
                  type="button"
                  onClick={() => removeExtra(extra.id)}
                >
                  Remover
                </button>
              </div>
            ))}

            <div className="menu-extra-inputs">
              <input
                type="text"
                placeholder="Nome do adicional"
                value={extraName}
                onChange={(event) => setExtraName(event.target.value)}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Preço"
                value={extraPrice}
                onChange={(event) => setExtraPrice(event.target.value)}
              />
              <button type="button" onClick={addExtra}>
                Adicionar
              </button>
            </div>
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
              type="submit"
              disabled={busy}
            >
              <CheckCircle2 size={18} />
              Salvar produto
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
