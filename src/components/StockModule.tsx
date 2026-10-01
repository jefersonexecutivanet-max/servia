import { useState } from "react";
import { Plus, Minus, Edit, Trash2, Search, Package, AlertTriangle } from "lucide-react";

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

const mockItems: StockItem[] = [
  {
    id: "1",
    name: "Coca-Cola 2L",
    category: "bebidas",
    quantity: 24,
    unit: "un",
    minQuantity: 10,
    price: 8.50,
    lastUpdated: new Date(),
  },
  {
    id: "2",
    name: "Carne Bovina (kg)",
    category: "alimentos",
    quantity: 15,
    unit: "kg",
    minQuantity: 20,
    price: 45.00,
    lastUpdated: new Date(),
  },
  {
    id: "3",
    name: "Pratos Descartáveis",
    category: "utensílios",
    quantity: 100,
    unit: "un",
    minQuantity: 50,
    price: 0.30,
    lastUpdated: new Date(),
  },
  {
    id: "4",
    name: "Detergente",
    category: "limpeza",
    quantity: 5,
    unit: "un",
    minQuantity: 10,
    price: 2.50,
    lastUpdated: new Date(),
  },
  {
    id: "5",
    name: "Cerveja Lata",
    category: "bebidas",
    quantity: 48,
    unit: "un",
    minQuantity: 24,
    price: 6.00,
    lastUpdated: new Date(),
  },
];

export default function StockModule() {
  const [items, setItems] = useState<StockItem[]>(mockItems);
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

  const categories = ["todos", "bebidas", "alimentos", "utensílios", "limpeza", "outros"];

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
      category: "alimentos",
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
    if (confirm("Tem certeza que deseja excluir este item?")) {
      setItems(items.filter((item) => item.id !== id));
    }
  };

  const handleSaveItem = () => {
    if (!formData.name.trim()) return;

    if (editingItem) {
      setItems(
        items.map((item) =>
          item.id === editingItem.id
            ? {
                ...item,
                name: formData.name,
                category: formData.category,
                quantity: formData.quantity,
                unit: formData.unit,
                minQuantity: formData.minQuantity,
                price: formData.price,
                lastUpdated: new Date(),
              }
            : item
        )
      );
    } else {
      const newItem: StockItem = {
        id: Date.now().toString(),
        name: formData.name,
        category: formData.category,
        quantity: formData.quantity,
        unit: formData.unit,
        minQuantity: formData.minQuantity,
        price: formData.price,
        lastUpdated: new Date(),
      };
      setItems([...items, newItem]);
    }
    setShowModal(false);
  };

  const handleUpdateQuantity = (id: string, change: number) => {
    setItems(
      items.map((item) =>
        item.id === id
          ? { ...item, quantity: Math.max(0, item.quantity + change), lastUpdated: new Date() }
          : item
      )
    );
  };

  return (
    <div className="module-page">
      <div className="module-header">
        <div>
          <h1>Controle de Estoque</h1>
          <p>Gerencie ingredientes e produtos do restaurante</p>
        </div>
        <button className="primary-button" onClick={handleAddItem}>
          <Plus size={18} />
          Adicionar Item
        </button>
      </div>

      <div className="stock-dashboard">
        <div className="stat-card warning">
          <div className="stat-icon">
            <AlertTriangle size={24} />
          </div>
          <div>
            <span>Estoque Baixo</span>
            <strong>{lowStockItems.length} itens</strong>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            <Package size={24} />
          </div>
          <div>
            <span>Total de Itens</span>
            <strong>{items.length}</strong>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">
            <Package size={24} />
          </div>
          <div>
            <span>Valor Total</span>
            <strong>
              R$ {items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)}
            </strong>
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input">
          <Search size={18} />
          <input
            type="text"
            placeholder="Buscar item..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="category-filters">
          {categories.map((category) => (
            <button
              key={category}
              className={`filter-button ${selectedCategory === category ? "active" : ""}`}
              onClick={() => setSelectedCategory(category)}
            >
              {category === "todos" ? "Todos" : category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {lowStockItems.length > 0 && (
        <div className="alert-banner warning">
          <AlertTriangle size={20} />
          <span>
            {lowStockItems.length} item(ns) com estoque abaixo do mínimo:{" "}
            {lowStockItems.map((item) => item.name).join(", ")}
          </span>
        </div>
      )}

      <div className="stock-grid">
        {filteredItems.map((item) => (
          <div
            key={item.id}
            className={`stock-card ${item.quantity <= item.minQuantity ? "low-stock" : ""}`}
          >
            <div className="stock-card-header">
              <div>
                <h3>{item.name}</h3>
                <span className="category-badge">{item.category}</span>
              </div>
              <div className="stock-actions">
                <button onClick={() => handleEditItem(item)} title="Editar">
                  <Edit size={16} />
                </button>
                <button onClick={() => handleDeleteItem(item.id)} title="Excluir">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="stock-card-body">
              <div className="stock-quantity">
                <span className="quantity-label">Quantidade</span>
                <div className="quantity-control">
                  <button onClick={() => handleUpdateQuantity(item.id, -1)}>
                    <Minus size={16} />
                  </button>
                  <span className="quantity-value">
                    {item.quantity} {item.unit}
                  </span>
                  <button onClick={() => handleUpdateQuantity(item.id, 1)}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              <div className="stock-details">
                <div>
                  <span>Preço unitário</span>
                  <strong>R$ {item.price.toFixed(2)}</strong>
                </div>
                <div>
                  <span>Valor total</span>
                  <strong>R$ {(item.price * item.quantity).toFixed(2)}</strong>
                </div>
                <div>
                  <span>Mínimo</span>
                  <strong>{item.minQuantity} {item.unit}</strong>
                </div>
              </div>
            </div>

            {item.quantity <= item.minQuantity && (
              <div className="stock-warning">
                <AlertTriangle size={14} />
                <span>Estoque baixo</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>{editingItem ? "Editar Item" : "Adicionar Item"}</h2>
              <button onClick={() => setShowModal(false)}>
                <Trash2 size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-field">
                <label>Nome do item</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Coca-Cola 2L"
                />
              </div>

              <div className="form-field">
                <label>Categoria</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="bebidas">Bebidas</option>
                  <option value="alimentos">Alimentos</option>
                  <option value="utensílios">Utensílios</option>
                  <option value="limpeza">Limpeza</option>
                  <option value="outros">Outros</option>
                </select>
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label>Quantidade</label>
                  <input
                    type="number"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                    min="0"
                  />
                </div>

                <div className="form-field">
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
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label>Quantidade Mínima</label>
                  <input
                    type="number"
                    value={formData.minQuantity}
                    onChange={(e) => setFormData({ ...formData, minQuantity: Number(e.target.value) })}
                    min="0"
                  />
                </div>

                <div className="form-field">
                  <label>Preço Unitário (R$)</label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button className="primary-button" onClick={handleSaveItem}>
                {editingItem ? "Atualizar" : "Adicionar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}