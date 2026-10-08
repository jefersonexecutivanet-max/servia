import { useState, useEffect } from "react";
import { Plus, ReceiptText, RotateCcw, Search, TrendingUp, TrendingDown, Wallet, X } from "lucide-react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";
import { cashApi, paymentApi } from "../utils/employeeApi";
import { generatePrintContent, printContent as printToPrinter, getUserPrinterSettings } from "../utils/printer";

interface CashTransaction {
  id: string;
  type: "entrada" | "saida" | "estorno";
  category: string;
  description: string;
  amount: number;
  amountCents?: number;
  paymentMethod: string;
  date: Date;
  reference?: string;
  sessionId?: string;
  createdBy?: string;
  reason?: string;
  reversesType?: string;
}

interface CashSession {
  id: string;
  status: "open" | "closed";
  openingAmount: number;
  openingAmountCents: number;
  openedAt?: Date;
  closedAt?: Date;
  operatorName?: string;
  closeReport?: Record<string, unknown>;
}

interface PaymentPart {
  method: "cash" | "pix" | "debit" | "credit" | "other";
  amount: string;
  label: string;
}

export default function CashModule() {
  const { restaurantId } = useRestaurantScope();
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [payments, setPayments] = useState<Array<Record<string, any>>>([]);
  const [activeSession, setActiveSession] = useState<CashSession | null>(null);
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [pendingBills, setPendingBills] = useState<Array<{ id: string; tableNumber: number; status: string; createdAt?: Date }>>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedType, setSelectedType] = useState("todos");
  const [showModal, setShowModal] = useState(false);
  const [showCloseTableModal, setShowCloseTableModal] = useState(false);
  const [tableNumber, setTableNumber] = useState("");
  const [closingTable, setClosingTable] = useState(false);
  const [showOpenSessionModal, setShowOpenSessionModal] = useState(false);
  const [showCloseSessionModal, setShowCloseSessionModal] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movementType, setMovementType] = useState<"sangria" | "suprimento" | "despesa">("sangria");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [quotedBill, setQuotedBill] = useState<{ amount: number; subtotal: number; discount: number; discountReason?: string; discountAuthorizedBy?: string; netSubtotal?: number; serviceFee: number; items: Array<{ name: string; quantity: number; price: number; extras?: string[]; notes?: string }> } | null>(null);
  const [paymentRows, setPaymentRows] = useState<PaymentPart[]>([{ method: "pix", amount: "", label: "" }]);
  const [cashReceived, setCashReceived] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [supervisorCode, setSupervisorCode] = useState("");
  const [supervisorPin, setSupervisorPin] = useState("");

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
    setPayments([]);
    setSessions([]);
    setPendingBills([]);
    setActiveSession(null);
    if (!restaurantId) {
      return;
    }

    const stopTransactions = onSnapshot(
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
            amountCents: data.amountCents,
            paymentMethod: data.paymentMethod || "dinheiro",
            date: data.createdAt?.toDate() || new Date(),
            reference: data.reference,
            sessionId: data.sessionId,
            createdBy: data.createdBy,
            reason: data.reason,
            reversesType: data.reversesType,
          } as CashTransaction;
        });
        setTransactions(txs);
      },
      (error) => {
        console.error("Erro ao carregar transações:", error);
      }
    );

    const stopPayments = onSnapshot(
      query(collection(db, "payments"), where("restaurantId", "==", restaurantId)),
      (snapshot) => setPayments(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (error) => console.error("Erro ao carregar pagamentos do Caixa:", error),
    );
    const stopHistory = onSnapshot(
      query(collection(db, "cashSessions"), where("restaurantId", "==", restaurantId)),
      (snapshot) => setSessions(snapshot.docs.map((item) => {
        const data = item.data();
        return { id: item.id, ...data, openedAt: data.openedAt?.toDate?.(), closedAt: data.closedAt?.toDate?.() } as CashSession;
      }).sort((first, second) => (second.openedAt?.getTime() || 0) - (first.openedAt?.getTime() || 0))),
      (error) => console.error("Erro ao carregar sessões do Caixa:", error),
    );
    const stopBills = onSnapshot(
      query(collection(db, "billRequests"), where("restaurantId", "==", restaurantId)),
      (snapshot) => setPendingBills(snapshot.docs.map((item) => ({
        id: item.id,
        tableNumber: Number(item.data().tableNumber || 0),
        status: String(item.data().status || "pending"),
        createdAt: item.data().createdAt?.toDate?.(),
      })).filter((item) => item.status !== "completed").sort((first, second) => (first.createdAt?.getTime() || 0) - (second.createdAt?.getTime() || 0))),
      (error) => console.error("Erro ao carregar contas solicitadas:", error),
    );
    let stopActiveSession = () => {};
    const stopRegister = onSnapshot(doc(db, "cashRegisters", restaurantId), (snapshot) => {
      stopActiveSession();
      const sessionId = snapshot.data()?.activeSessionId;
      if (!sessionId) { setActiveSession(null); return; }
      stopActiveSession = onSnapshot(doc(db, "cashSessions", String(sessionId)), (sessionSnapshot) => {
        if (!sessionSnapshot.exists()) { setActiveSession(null); return; }
        const data = sessionSnapshot.data();
        setActiveSession({ id: sessionSnapshot.id, ...data, openedAt: data.openedAt?.toDate?.(), closedAt: data.closedAt?.toDate?.() } as CashSession);
      }, (error) => console.error("Erro ao acompanhar o Caixa aberto:", error));
    }, (error) => console.error("Erro ao consultar Caixa aberto:", error));
    return () => { stopTransactions(); stopPayments(); stopHistory(); stopBills(); stopRegister(); stopActiveSession(); };
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

  const sessionPayments = activeSession ? payments.filter((payment) => payment.cashSessionId === activeSession.id && payment.status === "completed") : [];
  const sessionTransactions = activeSession ? transactions.filter((transaction) => transaction.sessionId === activeSession.id) : [];
  const sessionSales = sessionPayments.reduce((sum, payment) => sum + (Number(payment.amountCents) || Math.round((Number(payment.amount) || 0) * 100)) / 100, 0);
  const sessionCashSalesCents = sessionPayments.reduce((sum, payment) => sum + (Array.isArray(payment.paymentParts)
    ? payment.paymentParts.filter((part: Record<string, unknown>) => part.method === "cash").reduce((partSum: number, part: Record<string, unknown>) => partSum + (Number(part.amountCents) || 0), 0)
    : 0), 0);
  const sessionCashMovementsCents = sessionTransactions.reduce((sum, transaction) => {
    if (transaction.paymentMethod !== "dinheiro" && transaction.paymentMethod !== "cash") return sum;
    const amount = Number(transaction.amountCents) || Math.round(transaction.amount * 100);
    if (transaction.type === "estorno") return sum + (transaction.reversesType === "entrada" ? -amount : amount);
    return sum + (transaction.type === "entrada" ? amount : -amount);
  }, 0);
  const expectedCashCents = activeSession ? activeSession.openingAmountCents + sessionCashSalesCents + sessionCashMovementsCents : 0;

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
    if (!restaurantId || transaction.type === "estorno") return;
    if (transactions.some((item) => item.type === "estorno" && item.reference === transaction.id)) return;
    const reason = window.prompt("Informe o motivo do estorno:")?.trim();
    if (!reason || reason.length < 4) return;
    try {
      await cashApi("reverse", { restaurantId, transactionId: transaction.id, reason });
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
      await cashApi("movement", {
        restaurantId,
        type: formData.type,
        category: formData.category || "outros",
        amount: formData.amount,
        reason: `${formData.description}${formData.reference ? ` · Referência: ${formData.reference}` : ""}`,
        paymentMethod: formData.paymentMethod,
        idempotencyKey: crypto.randomUUID(),
      });
      setShowModal(false);
    } catch (error) {
      console.error("Erro ao salvar transação:", error);
      window.alert("Não foi possível salvar a transação.");
    }
  };

  const handleOpenSession = async () => {
    if (!restaurantId || openingAmount === "") { window.alert("Informe o fundo de troco inicial."); return; }
    setSessionBusy(true);
    try {
      await cashApi("open", { restaurantId, openingAmount, notes: sessionNotes });
      setShowOpenSessionModal(false);
      setOpeningAmount("");
      setSessionNotes("");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível abrir o caixa.");
    } finally { setSessionBusy(false); }
  };

  const handleRegisterMovement = async () => {
    if (!restaurantId || !movementAmount || movementReason.trim().length < 4) { window.alert("Informe o valor e o motivo da movimentação."); return; }
    setSessionBusy(true);
    try {
      await cashApi("movement", { restaurantId, type: movementType, amount: movementAmount, reason: movementReason, paymentMethod: "cash", idempotencyKey: crypto.randomUUID() });
      setShowMovementModal(false);
      setMovementAmount("");
      setMovementReason("");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível registrar a movimentação.");
    } finally { setSessionBusy(false); }
  };

  const handleCloseSession = async () => {
    if (!restaurantId || countedCash === "") { window.alert("Informe o dinheiro contado."); return; }
    if (!window.confirm("Fechar o Caixa? O servidor calculará vendas e movimentações desta sessão.")) return;
    setSessionBusy(true);
    try {
      const report = await cashApi<{ expectedCashCents: number; countedCashCents: number; differenceCents: number }>("close", {
        restaurantId, countedCash, notes: sessionNotes, idempotencyKey: crypto.randomUUID(),
      });
      const difference = Number(report.differenceCents || 0) / 100;
      window.alert(`Caixa fechado. Esperado: R$ ${(report.expectedCashCents / 100).toFixed(2)} · Contado: R$ ${(report.countedCashCents / 100).toFixed(2)} · ${difference < 0 ? "Falta" : "Sobra"}: R$ ${Math.abs(difference).toFixed(2)}.`);
      setShowCloseSessionModal(false);
      setCountedCash("");
      setSessionNotes("");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível fechar o caixa.");
    } finally { setSessionBusy(false); }
  };

  const currentDiscountRequest = () => {
    if (!discountValue.trim() || Number(discountValue) === 0) return undefined;
    const value = Number(discountValue);
    if (!Number.isFinite(value) || value < 0) throw new Error("Informe um valor de desconto válido.");
    return { type: discountType, value, reason: discountReason.trim(), supervisorCode: supervisorCode.trim(), supervisorPin };
  };

  const handleCloseTable = async () => {
    const number = Number(tableNumber);
    if (!restaurantId || !Number.isInteger(number) || number < 1 || number > 9999) {
      window.alert("Informe um número de mesa válido.");
      return;
    }
    if (!quotedBill) { window.alert("Confira a conta no servidor antes de receber."); return; }
    let discountRequest;
    try { discountRequest = currentDiscountRequest(); } catch (error) { window.alert(error instanceof Error ? error.message : "Desconto inválido."); return; }
    const requestedParts = paymentRows.map((part) => ({ method: part.method, amount: Number(part.amount), ...(part.method === "other" ? { label: part.label } : {}) }));
    if (requestedParts.some((part) => !Number.isFinite(part.amount) || part.amount <= 0)) { window.alert("Informe o valor de cada forma de pagamento."); return; }
    const inputTotalCents = requestedParts.reduce((sum, part) => sum + Math.round(part.amount * 100), 0);
    if (inputTotalCents !== Math.round(quotedBill.amount * 100)) { window.alert("A soma das formas de pagamento deve ser igual ao total da conta."); return; }
    if (!window.confirm(`Receber e fechar a conta da mesa ${number} no valor de R$ ${quotedBill.amount.toFixed(2)}?`)) return;
    setClosingTable(true);
    try {
      const hasCash = requestedParts.some((part) => part.method === "cash");
      const result = await paymentApi<{ amount?: number; change?: number; discount?: number; discountReason?: string; discountAuthorizedBy?: string; items?: Array<{ name: string; quantity: number; price: number; extras?: string[]; notes?: string }>; serviceFee?: number; waiterName?: string }>("close", {
        restaurantId,
        tableNumber: number,
        paymentParts: requestedParts,
        ...(discountRequest ? { discount: discountRequest } : {}),
        ...(hasCash ? { cashReceived: cashReceived || requestedParts.filter((part) => part.method === "cash").reduce((sum, part) => sum + part.amount, 0) } : {}),
      });
      const amount = Number(result?.amount);
      const change = Number(result?.change || 0);
      try {
        const printer = getUserPrinterSettings();
        if (printer.printerEnabled && result.items) {
          const content = generatePrintContent("COMPROVANTE DE PAGAMENTO", String(Date.now()).slice(-8), number, result.items, amount, {
            Pagamentos: requestedParts.map((part) => `${part.method}: R$ ${part.amount.toFixed(2)}`).join(" · "),
            "Taxa de serviço": `R$ ${Number(result.serviceFee || 0).toFixed(2)}`,
            Troco: `R$ ${change.toFixed(2)}`,
          }, printer.paperWidth);
          await printToPrinter(content, printer);
        }
      } catch (printError) { console.error("Pagamento concluído; impressão não disponível:", printError); }
      window.alert(amount > 0 ? `Conta fechada. Total recebido: R$ ${amount.toFixed(2)}.${change > 0 ? ` Troco: R$ ${change.toFixed(2)}.` : ""}` : "Conta fechada.");
      setShowCloseTableModal(false);
      setTableNumber("");
      setQuotedBill(null);
      setPaymentRows([{ method: "pix", amount: "", label: "" }]);
      setCashReceived("");
    } catch (error) {
      console.error("Erro ao fechar conta:", error);
      window.alert(error instanceof Error ? error.message : "Não foi possível fechar a conta da mesa.");
    } finally {
      setClosingTable(false);
    }
  };

  const handleQuoteTable = async () => {
    const number = Number(tableNumber);
    if (!restaurantId || !Number.isInteger(number) || number < 1 || number > 9999) { window.alert("Informe um número de mesa válido."); return; }
    setQuotedBill(null);
    setClosingTable(true);
    try {
      let discountRequest;
      try { discountRequest = currentDiscountRequest(); } catch (error) { window.alert(error instanceof Error ? error.message : "Desconto inválido."); return; }
      const quote = await paymentApi<{ amount: number; subtotal: number; discount: number; discountReason?: string; discountAuthorizedBy?: string; netSubtotal?: number; serviceFee: number; items: Array<{ name: string; quantity: number; price: number; extras?: string[]; notes?: string }> }>("quote", { restaurantId, tableNumber: number, ...(discountRequest ? { discount: discountRequest } : {}) });
      setQuotedBill(quote);
      setPaymentRows([{ method: "pix", amount: quote.amount.toFixed(2), label: "" }]);
      setCashReceived("");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível consultar a conta.");
    } finally { setClosingTable(false); }
  };

  return (
    <div className="cash-page">
      <div className="module-header">
        <div>
          <div className="eyebrow">CAIXA</div>
          <h1>Controle Financeiro</h1>
          <p>Gerencie entradas, saídas e saldo do caixa em tempo real.</p>
        </div>

        <div className="module-actions">
          {!activeSession ? (
            <button className="primary-button" type="button" onClick={() => setShowOpenSessionModal(true)}><Wallet size={18} />Abrir caixa</button>
          ) : (
            <>
              <button className="secondary-button" type="button" onClick={() => setShowMovementModal(true)}><Plus size={18} />Sangria / suprimento</button>
              <button className="secondary-button" type="button" onClick={() => setShowCloseTableModal(true)}><ReceiptText size={18} />Receber mesa</button>
              <button className="secondary-button" type="button" onClick={() => setShowCloseSessionModal(true)}><Wallet size={18} />Fechar caixa</button>
              <button className="primary-button" type="button" onClick={handleAddTransaction}><Plus size={18} />Nova movimentação</button>
            </>
          )}
        </div>
      </div>

      {/* Resumo */}
      <div className="cash-summary">
        <div className="summary-card">
          <div className="summary-icon entrada">
            <TrendingUp size={24} />
          </div>
          <div>
            <strong>R$ {sessionSales.toFixed(2)}</strong>
            <span>Vendas desta sessão</span>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon saida">
            <TrendingDown size={24} />
          </div>
          <div>
            <strong>R$ {activeSession ? (expectedCashCents / 100).toFixed(2) : "0,00"}</strong>
            <span>Dinheiro esperado</span>
          </div>
        </div>

        <div className="summary-card">
          <div className="summary-icon saldo">
            <Wallet size={24} />
          </div>
          <div>
            <strong>R$ {activeSession ? activeSession.openingAmount.toFixed(2) : "0,00"}</strong>
            <span>Fundo inicial</span>
          </div>
        </div>
      </div>
      {pendingBills.length > 0 && (
        <section className="cash-transactions" aria-label="Contas solicitadas">
          <h2>Contas solicitadas</h2>
          {pendingBills.map((bill) => (
            <div className="transaction-item" key={bill.id}>
              <div className="transaction-icon saida"><ReceiptText size={20} /></div>
              <div className="transaction-info"><strong>Mesa {bill.tableNumber}</strong><span>Solicitada {bill.createdAt?.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) || "agora"}</span></div>
              <div className="transaction-actions"><button className="secondary-button" type="button" disabled={!activeSession} onClick={() => { setTableNumber(String(bill.tableNumber)); setQuotedBill(null); setPaymentRows([{ method: "pix", amount: "", label: "" }]); setShowCloseTableModal(true); }}>Conferir e receber</button></div>
            </div>
          ))}
        </section>
      )}
      {activeSession && (
        <div className="transaction-item">
          <div className="transaction-icon entrada"><Wallet size={20} /></div>
          <div className="transaction-info"><strong>Caixa aberto · {activeSession.operatorName || "Operador"}</strong><span>Iniciado em {activeSession.openedAt?.toLocaleString("pt-BR") || "agora"}</span></div>
          <div className="transaction-details"><strong>{sessionPayments.length} pagamentos</strong><span>PIX/débito/crédito/dinheiro incluídos na sessão</span></div>
        </div>
      )}

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
            <p>{activeSession ? "Registre sangrias, suprimentos e outras movimentações na sessão aberta." : "Abra o Caixa para iniciar uma sessão e registrar vendas."}</p>
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
      {showCloseTableModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Receber conta da mesa</h2>
            <div className="form-group">
              <label>Número da mesa</label>
              <input type="number" min="1" max="9999" step="1" value={tableNumber} onChange={(event) => { setTableNumber(event.target.value); setQuotedBill(null); }} />
            </div>
            <div className="form-group"><label>Desconto</label><div className="cash-payment-part"><select value={discountType} onChange={(event) => { setDiscountType(event.target.value as "percent" | "fixed"); setQuotedBill(null); }}><option value="percent">Percentual (%)</option><option value="fixed">Valor (R$)</option></select><input type="number" min="0.01" step="0.01" value={discountValue} onChange={(event) => { setDiscountValue(event.target.value); setQuotedBill(null); }} placeholder="Sem desconto, deixe vazio" /></div></div>
            {discountValue.trim() && Number(discountValue) > 0 && <><div className="form-group"><label>Motivo obrigatório</label><input maxLength={120} value={discountReason} onChange={(event) => { setDiscountReason(event.target.value); setQuotedBill(null); }} /></div><div className="form-group"><label>Código do gerente autorizador</label><input autoComplete="off" maxLength={25} value={supervisorCode} onChange={(event) => { setSupervisorCode(event.target.value.toUpperCase()); setQuotedBill(null); }} placeholder="FUNC-..." /></div><div className="form-group"><label>PIN do gerente</label><input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={supervisorPin} onChange={(event) => { setSupervisorPin(event.target.value); setQuotedBill(null); }} /></div></>}
            {!quotedBill ? (
              <button className="secondary-button" type="button" disabled={closingTable} onClick={() => void handleQuoteTable()}>{closingTable ? "Consultando..." : "Conferir conta no servidor"}</button>
            ) : (
              <>
                <div className="closing-summary">
                  <div><span>Subtotal</span><strong>R$ {quotedBill.subtotal.toFixed(2)}</strong></div>
                  {quotedBill.discount > 0 && <><div><span>Desconto autorizado</span><strong>- R$ {quotedBill.discount.toFixed(2)}</strong></div><div><span>Motivo · {quotedBill.discountReason} · {quotedBill.discountAuthorizedBy}</span><strong>Subtotal após desconto: R$ {Number(quotedBill.netSubtotal || 0).toFixed(2)}</strong></div></>}
                  <div><span>Taxas</span><strong>R$ {quotedBill.serviceFee.toFixed(2)}</strong></div>
                  <div className="closing-total"><span>Total</span><strong>R$ {quotedBill.amount.toFixed(2)}</strong></div>
                  <ul>{quotedBill.items.map((item, index) => <li key={`${item.name}-${index}`}>{item.quantity}x {item.name} — R$ {(item.quantity * item.price).toFixed(2)}{item.notes ? ` · ${item.notes}` : ""}</li>)}</ul>
                </div>
                {paymentRows.map((part, index) => (
                  <div className="cash-payment-part" key={index}>
                    <div className="form-group"><label>Forma</label><select value={part.method} onChange={(event) => setPaymentRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, method: event.target.value as PaymentPart["method"] } : row))}><option value="cash">Dinheiro</option><option value="pix">PIX</option><option value="debit">Débito</option><option value="credit">Crédito</option><option value="other">Outro</option></select></div>
                    <div className="form-group"><label>Valor (R$)</label><input type="number" min="0.01" step="0.01" value={part.amount} onChange={(event) => setPaymentRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} /></div>
                    {part.method === "other" && <div className="form-group"><label>Descrição</label><input value={part.label} maxLength={40} onChange={(event) => setPaymentRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row))} /></div>}
                    {paymentRows.length > 1 && <button className="icon-button" type="button" aria-label="Remover forma de pagamento" onClick={() => setPaymentRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}><X size={16} /></button>}
                  </div>
                ))}
                {paymentRows.some((part) => part.method === "cash") && <div className="form-group"><label>Dinheiro recebido</label><input type="number" min="0" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} placeholder="Se igual à parte em dinheiro, deixe em branco" /></div>}
                <button className="secondary-button" type="button" disabled={paymentRows.length >= 5} onClick={() => setPaymentRows((rows) => [...rows, { method: "cash", amount: "", label: "" }])}>Adicionar forma de pagamento</button>
              </>
            )}
            <div className="modal-actions">
              <button className="secondary-button" type="button" disabled={closingTable} onClick={() => { setShowCloseTableModal(false); setQuotedBill(null); }}>Cancelar</button>
              {quotedBill && <button className="primary-button" type="button" disabled={closingTable} onClick={() => void handleCloseTable()}>{closingTable ? "Processando..." : "Confirmar pagamento"}</button>}
            </div>
          </div>
        </div>
      )}
      {showOpenSessionModal && (
        <div className="modal-overlay"><div className="modal-content"><h2>Abrir caixa</h2>
          <div className="form-group"><label>Fundo de troco (R$)</label><input type="number" min="0" step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} /></div>
          <div className="form-group"><label>Observações</label><input maxLength={500} value={sessionNotes} onChange={(event) => setSessionNotes(event.target.value)} /></div>
          <div className="modal-actions"><button className="secondary-button" disabled={sessionBusy} type="button" onClick={() => setShowOpenSessionModal(false)}>Cancelar</button><button className="primary-button" disabled={sessionBusy} type="button" onClick={() => void handleOpenSession()}>{sessionBusy ? "Abrindo..." : "Abrir caixa"}</button></div>
        </div></div>
      )}
      {showMovementModal && (
        <div className="modal-overlay"><div className="modal-content"><h2>Movimentação do caixa</h2>
          <div className="form-group"><label>Tipo</label><select value={movementType} onChange={(event) => setMovementType(event.target.value as typeof movementType)}><option value="sangria">Sangria</option><option value="suprimento">Suprimento</option><option value="despesa">Despesa</option></select></div>
          <div className="form-group"><label>Valor (R$)</label><input type="number" min="0.01" step="0.01" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} /></div>
          <div className="form-group"><label>Motivo obrigatório</label><input maxLength={250} value={movementReason} onChange={(event) => setMovementReason(event.target.value)} /></div>
          <div className="modal-actions"><button className="secondary-button" disabled={sessionBusy} type="button" onClick={() => setShowMovementModal(false)}>Cancelar</button><button className="primary-button" disabled={sessionBusy} type="button" onClick={() => void handleRegisterMovement()}>{sessionBusy ? "Salvando..." : "Registrar"}</button></div>
        </div></div>
      )}
      {showCloseSessionModal && (
        <div className="modal-overlay"><div className="modal-content"><h2>Fechar caixa</h2>
          <div className="closing-summary"><div><span>Dinheiro esperado</span><strong>R$ {(expectedCashCents / 100).toFixed(2)}</strong></div><div><span>Vendas da sessão</span><strong>R$ {sessionSales.toFixed(2)}</strong></div></div>
          <div className="form-group"><label>Dinheiro contado (R$)</label><input type="number" min="0" step="0.01" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} /></div>
          <div className="form-group"><label>Observações</label><input maxLength={500} value={sessionNotes} onChange={(event) => setSessionNotes(event.target.value)} /></div>
          <div className="modal-actions"><button className="secondary-button" disabled={sessionBusy} type="button" onClick={() => setShowCloseSessionModal(false)}>Cancelar</button><button className="primary-button" disabled={sessionBusy} type="button" onClick={() => void handleCloseSession()}>{sessionBusy ? "Fechando..." : "Confirmar fechamento"}</button></div>
        </div></div>
      )}
      <section className="cash-transactions">
        <h2>Histórico de sessões</h2>
        {sessions.slice(0, 10).map((session) => {
          const report = session.closeReport as { expectedCashCents?: number; countedCashCents?: number; differenceCents?: number } | undefined;
          return <div className="transaction-item" key={session.id}><div className="transaction-info"><strong>{session.status === "open" ? "Aberto" : "Fechado"} · {session.operatorName || "Operador"}</strong><span>Abriu em {session.openedAt?.toLocaleString("pt-BR") || "—"}</span></div><div className="transaction-details"><span>Fundo: R$ {session.openingAmount.toFixed(2)}</span>{report && <span>Esperado R$ {((report.expectedCashCents || 0) / 100).toFixed(2)} · Contado R$ {((report.countedCashCents || 0) / 100).toFixed(2)} · Diferença R$ {((report.differenceCents || 0) / 100).toFixed(2)}</span>}</div></div>;
        })}
      </section>
    </div>
  );
}
