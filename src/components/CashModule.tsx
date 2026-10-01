import { useState } from "react";
import { Plus, Edit, Trash2, Search, DollarSign, TrendingUp, TrendingDown, Wallet, CreditCard } from "lucide-react";

interface CashTransaction {
  id: string;
  type: "entrada" | "saida";
  category: string;
  description: string;
  amount: number;
  paymentMethod: "dinheiro" | "cartao" | "pix" | "transferencia";
  date: Date;
  reference?: string;
}

const mockTransactions: CashTransaction[] = [
  {
    id: "1",
    type: "entrada",
    category: "vendas",
    description: "Venda do dia - Mesa 5",
    amount: 198.40,
    paymentMethod: "cartao",
    date: new Date(),
    reference: "Mesa 5",
  },
  {
    id: "2",
    type: "entrada",
    category: "vendas",
    description: "Venda do dia - Mesa 7",
    amount: 245.80,
    paymentMethod: "pix",
    date: new Date(),
    reference: "Mesa 7",
  },
  {
    id: "3",
    type: "saida",
    category: "fornecedor",
    description: "Compra de ingredientes",
    amount: 1200.00,
    paymentMethod: "transferencia",
    date: new Date(),
    reference: "Fornecedor ABC",
  },
  {
    id: "4",
    type: "saida",
    category: "salário",
    description: "Pagamento funcionários",
    amount: 11600.00,
    paymentMethod: "transferencia",
    date: new Date(),
  },
  {
    id: "5",
    type: "entrada",
    category: "vendas",
    description: "Venda do dia - Mesa 1",
    amount: 156.90,
    paymentMethod: "dinheiro",
    date: new Date(),
    reference: "Mesa 1",
  },
];

export default function CashModule() {
  const [transactions, setTransactions] = useState<CashTransaction[]>(mockTransactions);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState("todos");
  const [showModal, setShowModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<CashTransaction | null>(null);
  const [formData, setFormData] = useState({
    type: "entrada" as "entrada" | "saida",
    category: "",
    description: "",
    amount: 0,
    paymentMethod: "dinheiro" as "dinheiro" | "cartao" | "pix" | "transferencia",
    reference: "",
  });

  const filteredTransactions = transactions.filter(
    (transaction) =>
      (selectedType === "todos" || transaction.type === selectedType) &&
      transaction.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalEntradas = transactions
    .filter((t) => t.type === "entrada")
    .reduce((sum, t) => sum + t.amount, 0);

  const totalSaidas = transactions
    .filter((t) => t.type === "saida")
    .reduce((sum, t) => sum + t.amount, 0);

  const saldo = totalEntradas - totalSaidas;

  const handleAddTransaction = () => {
    setEditingTransaction(null);
    setFormData({
      type: "entrada",
      category: "vendas",
      description: "",
      amount: 0,
      paymentMethod: "dinheiro",
      reference: "",
    });
    setShowModal(true);
  };

  const handleEditTransaction = (transaction: CashTransaction) => {
    setEditingTransaction(transaction);
    setFormData({
      type: transaction.type,
      category: transaction.category,
      description: transaction.description,
      amount: transaction.amount,
      paymentMethod: transaction.paymentMethod,
      reference: transaction.reference || "",
    });
    setShowModal(true);
  };

  const handleDeleteTransaction = (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta transação?")) {
      setTransactions(transactions.filter((t) => t.id !== id));
    }
  };

  const handleSaveTransaction = () => {
    if (!formData.description.trim() || formData.amount <= 0) return;

    if (editingTransaction) {
      setTransactions(
        transactions.map((t) =>
          t.id === editingTransaction.id
            ? {
                ...t,
                type: formData.type,
                category: formData.category,
                description: formData.description,
                amount: formData.amount,
                paymentMethod: formData.paymentMethod,
                reference: formData.reference,
              }
            : t
        )
      );
    } else {
      const newTransaction: CashTransaction = {
        id: Date.now().toString(),
        type: formData.type,
        category: formData.category,
        description: formData.description,
        amount: formData.amount,
        paymentMethod: formData.paymentMethod,
        date: new Date(),
        reference: formData.reference,
      };
      setTransactions([...transactions, newTransaction]);
    }
    setShowModal(false);
  };

  const getPaymentMethodIcon = (method: string) => {
    switch (method) {
      case "cartao":
        return <CreditCard size={16} />;
      case "pix":
        return "💠";
      case "transferencia":
        return "🏦";
      default:
        return <Wallet size={16} />;
    }
  };

  return (
    <div className="module-page">
      <div className="module-header">
        <div>
          <h1>Controle Financeiro</h1>
          <p>Gerencie o fluxo de caixa do restaurante</p>
        </div>
        <button className="primary-button" onClick={handleAddTransaction}>
          <Plus size={18} />
          Nova Transação
        </button>
      </div>

      <div className="cash-dashboard">
        <div className="stat-card success">
          <div className="stat-icon">
            <TrendingUp size={24} />
          </div>
          <div>
            <span>Total Entradas</span>
            <strong>R$ {totalEntradas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
          </div>
        </div>

        <div className="stat-card danger">
          <div className="stat-icon">
            <TrendingDown size={24} />
          </div>
          <div>
            <span>Total Saídas</span>
            <strong>R$ {totalSaidas.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
          </div>
        </div>

        <div className={`stat-card ${saldo >= 0 ? "success" : "danger"}`}>
          <div className="stat-icon">
            <DollarSign size={24} />
          </div>
          <div>
            <span>Saldo Atual</span>
            <strong>R$ {saldo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
          </div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input">
          <Search size={18} />
          <input
            type="text"
            placeholder="Buscar transação..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="category-filters">
          <button
            className={`filter-button ${selectedType === "todos" ? "active" : ""}`}
            onClick={() => setSelectedType("todos")}
          >
            Todos
          </button>
          <button
            className={`filter-button ${selectedType === "entrada" ? "active" : ""}`}
            onClick={() => setSelectedType("entrada")}
          >
            Entradas
          </button>
          <button
            className={`filter-button ${selectedType === "saida" ? "active" : ""}`}
            onClick={() => setSelectedType("saida")}
          >
            Saídas
          </button>
        </div>
      </div>

      <div className="transactions-list">
        {filteredTransactions.map((transaction) => (
          <div
            key={transaction.id}
            className={`transaction-card ${transaction.type}`}
          >
            <div className="transaction-left">
              <div className={`transaction-icon ${transaction.type}`}>
                {transaction.type === "entrada" ? (
                  <TrendingUp size={20} />
                ) : (
                  <TrendingDown size={20} />
                )}
              </div>

              <div className="transaction-info">
                <h3>{transaction.description}</h3>
                <div className="transaction-meta">
                  <span className="category-badge">{transaction.category}</span>
                  {transaction.reference && (
                    <span className="reference-badge">{transaction.reference}</span>
                  )}
                  <span className="date-badge">
                    {new Date(transaction.date).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>
            </div>

            <div className="transaction-right">
              <div className="transaction-amount">
                <strong>
                  {transaction.type === "entrada" ? "+" : "-"}
                  R$ {transaction.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                </strong>
                <div className="payment-method">
                  {getPaymentMethodIcon(transaction.paymentMethod)}
                  <span>{transaction.paymentMethod}</span>
                </div>
              </div>

              <div className="transaction-actions">
                <button onClick={() => handleEditTransaction(transaction)} title="Editar">
                  <Edit size={16} />
                </button>
                <button onClick={() => handleDeleteTransaction(transaction.id)} title="Excluir">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>{editingTransaction ? "Editar Transação" : "Nova Transação"}</h2>
              <button onClick={() => setShowModal(false)}>
                <Trash2 size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-field">
                <label>Tipo de Transação</label>
                <div className="type-selector">
                  <button
                    className={`type-option ${formData.type === "entrada" ? "active" : ""}`}
                    onClick={() => setFormData({ ...formData, type: "entrada" })}
                  >
                    <TrendingUp size={18} />
                    Entrada
                  </button>
                  <button
                    className={`type-option ${formData.type === "saida" ? "active" : ""}`}
                    onClick={() => setFormData({ ...formData, type: "saida" })}
                  >
                    <TrendingDown size={18} />
                    Saída
                  </button>
                </div>
              </div>

              <div className="form-field">
                <label>Categoria</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="vendas">Vendas</option>
                  <option value="pagamento">Pagamento</option>
                  <option value="fornecedor">Fornecedor</option>
                  <option value="salário">Salário</option>
                  <option value="imposto">Imposto</option>
                  <option value="outros">Outros</option>
                </select>
              </div>

              <div className="form-field">
                <label>Descrição</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Ex: Venda do dia - Mesa 5"
                />
              </div>

              <div className="form-field">
                <label>Valor (R$)</label>
                <input
                  type="number"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: Number(e.target.value) })}
                  min="0"
                  step="0.01"
                />
              </div>

              <div className="form-field">
                <label>Forma de Pagamento</label>
                <select
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value as any })}
                >
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cartao">Cartão</option>
                  <option value="pix">PIX</option>
                  <option value="transferencia">Transferência</option>
                </select>
              </div>

              <div className="form-field">
                <label>Referência (opcional)</label>
                <input
                  type="text"
                  value={formData.reference}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  placeholder="Ex: Mesa 5, Fornecedor ABC"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setShowModal(false)}>
                Cancelar
              </button>
              <button className="primary-button" onClick={handleSaveTransaction}>
                {editingTransaction ? "Atualizar" : "Adicionar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}