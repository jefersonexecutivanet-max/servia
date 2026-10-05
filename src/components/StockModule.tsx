import { useState, useEffect } from "react";
import { Plus, Minus, Edit, Trash2, Search, Package, AlertTriangle } from "lucide-react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";

interface StockItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  minQuantity: number;
  price: number;
  lastUpdated: Date;
}

export default function StockModule() {
  const { restaurantId } = useRestaurantScope();
  const [items, setItems] = useState<StockItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("todos");
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    category: "",
    quantity: 0,
    unit: "un",
    minQuantity: 0,
    price: 0,
  });

  // Carregar itens reais do Firestore
  useEffect(() => {
    setItems([]);
    if (!restaurantId) {
      return;
    }

    const unsubscribe = onSnapshot(
      query(collection(db, "stock"), where("restaurantId", "==", restaurantId)),
      (snapshot) => {
        const stockItems = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            name: data.name || "",
            category: data.category || "",
            quantity: data.quantity || 0,
            unit: data.unit || "un",
            minQuantity: data.minQuantity || 0,
            price: data.price || 0,
            lastUpdated: data.lastUpdated?.toDate() || new Date(),
          } as StockItem;
        });
        setItems(stockItems);
      },
      (error) => {
        console.error("Erro ao carregar estoque:", error);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const filteredItems = items.filter(
    (item) =>
      (selectedCategory === "todos" || item.category === selectedCategory) &&
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const lowStockItems = items.filter((item) => item.quantity <= item.minQuantity);

  const handleAddItem = () => {
    setEditingItem(null);
    setFormData({
      name: "",
      category: "",
      quantity: 0,
      unit: "un",
      minQuantity: 0,
      price: 0,
    });
    setShowModal(true);
  };

  const handleEditItem = (item: StockItem) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit: item.unit,
      minQuantity: item.minQuantity,
      price: item.price,
    });
    setShowModal(true);
  };

  const handleDeleteItem = (id: string) => {
    if (window.confirm("Deseja excluir este item?")) {
      void deleteDoc(doc(db, "stock", id)).catch((error) => {
        console.error("Erro ao excluir item:", error);
        window.alert("Não foi possível excluir o item.");
      });
    }
  };

  const handleUpdateQuantity = (id: string, delta: number) => {
    const item = items.find((current) => current.id === id);
    if (!item) return;
    void updateDoc(doc(db, "stock", id), {
      quantity: Math.max(0, item.quantity + delta),
      lastUpdated: serverTimestamp(),
    }).catch((error) => {
      console.error("Erro ao atualizar quantidade:", error);
      window.alert("Não foi possível atualizar a quantidade.");
    });
  };

  const handleSaveItem = async () => {
    if (!formData.name || formData.quantity < 0) {
      alert("Preencha todos os campos obrigatórios");
      return;
    }

    if (!restaurantId) {
      window.alert("Selecione primeiro um restaurante ativo.");
      return;
    }

    try {
      const itemData = { ...formData, restaurantId, lastUpdated: serverTimestamp() };
      if (editingItem) {
        await updateDoc(doc(db, "stock", editingItem.id), itemData);
      } else {
        await addDoc(collection(db, "stock"), itemData);
      }
      setShowModal(false);
    } catch (error) {
      console.error("Erro ao salvar item:", error);
      window.alert("Não foi possível salvar o item.");
    }
  };

  return (
    <div className="stock-page">
      <div className="module-header">
        <div>
          <div className="eyebrow">ESTOQUE</div>
          <h1>Controle de Estoque</h1>
          <p>Gerencie ingredientes, bebidas e materiais do restaurante.</p>
        </div>

        <button className="primary-button" type="button" onClick={handleAddItem}>
          <Plus size={18} />
          Novo Item
        </button>
      </div>

      {/* Alertas de estoque baixo */}
      {lowStockItems.length > 0 && (
        <div className="stock-alerts">
          <div className="alert-header">
            <AlertTriangle size={20} />
            <strong>Estoque Baixo ({lowStockItems.length})</strong>
          </div>
          <div className="alert-list">
            {lowStockItems.map((item) => (
              <div key={item.id} className="alert-item">
                <strong>{item.name}</strong>
                <span>Quantidade: {item.quantity} {item.unit}</span>
                <span>Mínimo: {item.minQuantity} {item.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="stock-filters">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Buscar item..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-buttons">
          <button
            className={selectedCategory === "todos" ? "active" : ""}
            type="button"
            onClick={() => setSelectedCategory("todos")}
          >
            Todos
          </button>
          <button
            className={selectedCategory === "bebidas" ? "active" : ""}
            type="button"
            onClick={() => setSelectedCategory("bebidas")}
          >
            Bebidas
          </button>
          <button
            className={selectedCategory === "alimentos" ? "active" : ""}
            type="button"
            onClick={() => setSelectedCategory("alimentos")}
          >
            Alimentos
          </button>
          <button
            className={selectedCategory === "utensílios" ? "active" : ""}
            type="button"
            onClick={() => setSelectedCategory("utensílios")}
          >
            Utensílios
          </button>
          <button
            className={selectedCategory === "limpeza" ? "active" : ""}
            type="button"
            onClick={() => setSelectedCategory("limpeza")}
          >
            Limpeza
          </button>
        </div>
      </div>

      {/* Lista de itens */}
      <div className="stock-items">
        {filteredItems.length === 0 ? (
          <div className="empty-state">
            <Package size={48} />
            <strong>Nenhum item cadastrado</strong>
            <p>Clique em "Novo Item" para adicionar produtos ao estoque.</p>
          </div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className={`stock-item ${item.quantity <= item.minQuantity ? "low-stock" : ""}`}
            >
              <div className="item-icon">
                <Package size={24} />
              </div>

              <div className="item-info">
                <strong>{item.name}</strong>
                <span>{item.category}</span>
                <span>R$ {item.price.toFixed(2)} / {item.unit}</span>
              </div>

              <div className="item-quantity">
                <div className="quantity-controls">
                  <button
                    className="quantity-btn"
                    type="button"
                    onClick={() => handleUpdateQuantity(item.id, -1)}
                  >
                    <Minus size={16} />
                  </button>
                  <span className="quantity-value">{item.quantity} {item.unit}</span>
                  <button
                    className="quantity-btn"
                    type="button"
                    onClick={() => handleUpdateQuantity(item.id, 1)}
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <span className="min-quantity">Mín: {item.minQuantity} {item.unit}</span>
              </div>

              <div className="item-actions">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => handleEditItem(item)}
                >
                  <Edit size={18} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => handleDeleteItem(item.id)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>{editingItem ? "Editar Item" : "Novo Item"}</h2>

            <form>
              <div className="form-group">
                <label>Nome</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Coca-Cola 2L"
                />
              </div>

              <div className="form-group">
                <label>Categoria</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  <option value="bebidas">Bebidas</option>
                  <option value="alimentos">Alimentos</option>
                  <option value="utensílios">Utensílios</option>
                  <option value="limpeza">Limpeza</option>
                  <option value="outros">Outros</option>
                </select>
              </div>

              <div className="form-group">
                <label>Quantidade</label>
                <input
                  type="number"
                  min="0"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
                />
              </div>

              <div className="form-group">
                <label>Unidade</label>
                <select
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                >
                  <option value="un">Unidade</option>
                  <option value="kg">Quilograma</option>
                  <option value="l">Litro</option>
                  <option value="ml">Mililitro</option>
                  <option value="g">Grama</option>
                </select>
              </div>

              <div className="form-group">
                <label>Quantidade Mínima</label>
                <input
                  type="number"
                  min="0"
                  value={formData.minQuantity}
                  onChange={(e) => setFormData({ ...formData, minQuantity: parseInt(e.target.value) || 0 })}
                />
              </div>

              <div className="form-group">
                <label>Preço (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                />
              </div>

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowModal(false)}
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleSaveItem}
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
