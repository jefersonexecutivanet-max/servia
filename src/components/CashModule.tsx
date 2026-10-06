import { useState, useEffect } from "react";
import { Plus, RotateCcw, Search, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { collection, doc, onSnapshot, query, where, addDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";

interface CashTransaction {
  id: string;
  type: "entrada" | "saida" | "estorno";
  category: string;
  description: string;
  amount: number;
  paymentMethod: "dinheiro" | "cartao" | "pix" | "transferencia";
  date: Date;
  reference?: string;
}

export default function CashModule() {
  const { restaurantId } = useRestaurantScope();
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState("todos");
  const [showModal, setShowModal] = useState(false);

  const [formData, setFormData] = useState({
    type: "entrada" as "entrada" | "saida",
    category: "",
    description: "",
    amount: 0,
    paymentMethod: "dinheiro" as "dinheiro" | "cartao" | "pix" | "transferencia",
    reference: "",
  });

  // Carregar transações reais do Firestore
  useEffect(() => {
    setTransactions([]);
    if (!restaurantId) {
      return;
    }

    const unsubscribe = onSnapshot(
      query(collection(db, "cashTransactions"), where("restaurantId", "==", restaurantId)),
      (snapshot) => {
        const txs = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            type: data.type || "entrada",
            category: data.category || "",
            description: data.description || "",
            amount: data.amount || 0,
            paymentMethod: data.paymentMethod || "dinheiro",
            date: data.createdAt?.toDate() || new Date(),
            reference: data.reference,
          } as CashTransaction;
        });
        setTransactions(txs);
      },
      (error) => {
        console.error("Erro ao carregar transações:", error);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const filteredTransactions = transactions.filter(
    (transaction) =>
      (selectedType === "todos" || transaction.type === selectedType) &&
      transaction.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const effectiveType = (transaction: CashTransaction) => {
    if (transaction.type !== "estorno") return transaction.type;
    const original = transactions.find((item) => item.id === transaction.reference);
    return original?.type === "saida" ? "entrada" : "saida";
  };

  const totalEntradas = transactions
    .filter((transaction) => effectiveType(transaction) === "entrada")
    .reduce((sum, t) => sum + t.amount, 0);

  const totalSaidas = transactions
    .filter((transaction) => effectiveType(transaction) === "saida")
    .reduce((sum, t) => sum + t.amount, 0);

  const saldo = totalEntradas - totalSaidas;

  const handleAddTransaction = () => {

    setFormData({
      type: "entrada",
      category: "",
      description: "",
      amount: 0,
      paymentMethod: "dinheiro",
      reference: "",
    });
    setShowModal(true);
  };

  const handleReverseTransaction = async (transaction: CashTransaction) => {
    if (!restaurantId || !auth.currentUser || transaction.type === "estorno") return;
    if (transactions.some((item) => item.type === "estorno" && item.reference === transaction.id)) return;
    try {
      await setDoc(doc(db, "cashTransactions", `estorno_${transaction.id}`), {
        restaurantId,
        type: "estorno",
        category: transaction.category,
        description: `Estorno: ${transaction.description}`,
        amount: transaction.amount,
        paymentMethod: transaction.paymentMethod,
        reference: transaction.id,
        createdBy: auth.currentUser.uid,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Erro ao estornar transação:", error);
      window.alert("Não foi possível registrar o estorno.");
    }
  };

  const handleSaveTransaction = async () => {
    if (!formData.description || formData.amount <= 0) {
      alert("Preencha todos os campos obrigatórios");
      return;
    }

    if (!restaurantId) {
      window.alert("Selecione primeiro um restaurante ativo.");
      return;
    }

    try {
      await addDoc(collection(db, "cashTransactions"), { ...formData, restaurantId, createdAt: serverTimestamp() });
      setShowModal(false);
    } catch (error) {
      console.error("Erro ao salvar transação:", error);
      window.alert("Não foi possível salvar a transação.");
    }
  };

  return (
    <div className="cash-page">
      <div className="module-header">
        <div>
          <div className="eyebrow">CAIXA</div>
          <h1>Controle Financeiro</h1>
          <p>Gerencie entradas, saídas e saldo do caixa em tempo real.</p>
        </div>

        <button className="primary-button" type="button" onClick={handleAddTransaction}>
          <Plus size={18} />
          Nova Transação
        </button>
      </div>

      {/* Resumo */}
      <div className="cash-summary">
        <div className="summary-card">
          <div className="summary-icon entrada">
            <TrendingUp size={24} />
          </div>
          <div>
            <strong>{totalEntradas.toFixed(2)}</strong>
            <span>Entradas</span>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon saida">
            <TrendingDown size={24} />
          </div>
          <div>
            <strong>{totalSaidas.toFixed(2)}</strong>
            <span>Saídas</span>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon saldo">
            <Wallet size={24} />
          </div>
          <div>
            <strong>{saldo.toFixed(2)}</strong>
            <span>Saldo</span>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="cash-filters">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder="Buscar transação..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="filter-buttons">
          <button
            className={selectedType === "todos" ? "active" : ""}
            type="button"
            onClick={() => setSelectedType("todos")}
          >
            Todos
          </button>
          <button
            className={selectedType === "entrada" ? "active" : ""}
            type="button"
            onClick={() => setSelectedType("entrada")}
          >
            Entradas
          </button>
          <button
            className={selectedType === "saida" ? "active" : ""}
            type="button"
            onClick={() => setSelectedType("saida")}
          >
            Saídas
          </button>
        </div>
      </div>

      {/* Lista de transações */}
      <div className="cash-transactions">
        {filteredTransactions.length === 0 ? (
          <div className="empty-state">
            <Wallet size={48} />
            <strong>Nenhuma transação registrada</strong>
            <p>Clique em "Nova Transação" para adicionar movimentações financeiras.</p>
          </div>
        ) : (
          filteredTransactions.map((transaction) => (
            <div key={transaction.id} className="transaction-item">
              <div className={`transaction-icon ${effectiveType(transaction)}`}>
                {effectiveType(transaction) === "entrada" ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
              </div>

              <div className="transaction-info">
                <strong>{transaction.description}</strong>
                <span>{transaction.category}</span>
                {transaction.reference && <span>{transaction.reference}</span>}
              </div>

              <div className="transaction-details">
                <strong className={effectiveType(transaction) === "entrada" ? "text-green" : "text-red"}>
                  {effectiveType(transaction) === "entrada" ? "+" : "-"}R$ {transaction.amount.toFixed(2)}
                </strong>
                <span>{transaction.date.toLocaleDateString("pt-BR")}</span>
                <span>{transaction.paymentMethod}</span>
              </div>

              <div className="transaction-actions">
                {transaction.type !== "estorno" && !transactions.some((item) => item.type === "estorno" && item.reference === transaction.id) && (
                  <button className="icon-button" type="button" onClick={() => void handleReverseTransaction(transaction)} aria-label="Estornar transação">
                    <RotateCcw size={18} />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Nova transacao</h2>

            <form>
              <div className="form-group">
                <label>Tipo</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as "entrada" | "saida" })}
                >
                  <option value="entrada">Entrada</option>
                  <option value="saida">Saída</option>
                </select>
              </div>

              <div className="form-group">
                <label>Categoria</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="">Selecione...</option>
                  <option value="vendas">Vendas</option>
                  <option value="fornecedor">Fornecedor</option>
                  <option value="salário">Salário</option>
                  <option value="aluguel">Aluguel</option>
                  <option value="luz">Luz</option>
                  <option value="água">Água</option>
                  <option value="outros">Outros</option>
                </select>
              </div>

              <div className="form-group">
                <label>Descrição</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Ex: Venda do dia - Mesa 5"
                />
              </div>

              <div className="form-group">
                <label>Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                />
              </div>

              <div className="form-group">
                <label>Método de Pagamento</label>
                <select
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value as "dinheiro" | "cartao" | "pix" | "transferencia" })}
                >
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cartao">Cartão</option>
                  <option value="pix">Pix</option>
                  <option value="transferencia">Transferência</option>
                </select>
              </div>

              <div className="form-group">
                <label>Referência (opcional)</label>
                <input
                  type="text"
                  value={formData.reference}
                  onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                  placeholder="Ex: Mesa 5, Fornecedor ABC"
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
                  onClick={handleSaveTransaction}
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
