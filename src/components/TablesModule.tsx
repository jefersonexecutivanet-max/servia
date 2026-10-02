import { useEffect, useMemo, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  X,
  QrCode,
  Smartphone,
  Receipt,
  CreditCard,
  Banknote,
  WalletCards,
  CheckCircle2,
  Copy,
  Radio,
  Users,
  Clock3,
  Plus,
  Pencil,
  Trash2,
  Move,
  Store,
  ChevronDown,
} from "lucide-react";

import { formatCurrency } from "../utils/format";
import { generatePrintContent, printContent as printToPrinter, getUserPrinterSettings } from "../utils/printer";
import { collection, deleteDoc, deleteField, doc, onSnapshot, query, setDoc, updateDoc, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";
import type { Table, TableStatus } from "../types/table";

type OrderItem = {
  name: string;
  quantity: number;
  price: number;
};

const initialTables: Table[] = [];

const exampleItems: Record<number, OrderItem[]> = {
  1: [
    {
      name: "Hambúrguer Artesanal",
      quantity: 2,
      price: 32,
    },
    {
      name: "Coca-Cola",
      quantity: 2,
      price: 7,
    },
    {
      name: "Batata Frita",
      quantity: 1,
      price: 18.9,
    },
    {
      name: "Água",
      quantity: 2,
      price: 5,
    },
  ],

  3: [
    {
      name: "Filé Executivo",
      quantity: 1,
      price: 59.5,
    },
    {
      name: "Suco Natural",
      quantity: 1,
      price: 25,
    },
  ],

  5: [
    {
      name: "Pizza Grande",
      quantity: 1,
      price: 69.9,
    },
    {
      name: "Refrigerante",
      quantity: 2,
      price: 14.9,
    },
    {
      name: "Sobremesa",
      quantity: 1,
      price: 58.1,
    },
  ],

  7: [
    {
      name: "Pizza Grande",
      quantity: 2,
      price: 69.9,
    },
    {
      name: "Refrigerante",
      quantity: 2,
      price: 14.3,
    },
  ],
};

const tablePositions = [
  { left: "10%", top: "23%" },
  { left: "38%", top: "20%" },
  { left: "68%", top: "22%" },
  { left: "13%", top: "57%" },
  { left: "42%", top: "52%" },
  { left: "72%", top: "55%" },
  { left: "26%", top: "78%" },
  { left: "61%", top: "79%" },
];

function statusLabel(status: TableStatus) {
  switch (status) {
    case "ocupada":
      return "Ocupada";

    case "reservada":
      return "Reservada";

    default:
      return "Livre";
  }
}

function getTableUrl(restaurantId: string, tableNumber: number) {
  return `${window.location.origin}/mesa/${restaurantId}/${tableNumber}`;
}

export default function TablesModule() {
  const { restaurantId, systemAdmin, setRestaurantId } = useRestaurantScope();
  const [tables, setTables] =
    useState<Table[]>(initialTables);

  const [selectedTable, setSelectedTable] =
    useState<Table | null>(null);

  const [showQR, setShowQR] =
    useState(false);

  const [showTap, setShowTap] =
    useState(false);

  const [showClose, setShowClose] =
    useState(false);

  const [showTableForm, setShowTableForm] =
    useState(false);

  const [editingTable, setEditingTable] =
    useState<Table | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] =
    useState(false);

  const [paymentMethod, setPaymentMethod] =
    useState("pix");

  const [copied, setCopied] =
    useState(false);

  const [draggingTable, setDraggingTable] = useState<number | null>(null);
  const [availableRestaurants, setAvailableRestaurants] = useState<Array<{ id: string; name: string }>>([]);
  const [showRestaurantDropdown, setShowRestaurantDropdown] = useState(false);

  useEffect(() => {
    if (!restaurantId) {
      return;
    }

    return onSnapshot(
      query(collection(db, "tables"), where("restaurantId", "==", restaurantId)),
      (snapshot) => {
        setTables(snapshot.docs.map((item) => item.data() as Table).sort((a, b) => a.number - b.number));
      },
      (loadError) => {
        console.error("Erro ao carregar mesas:", loadError);
      },
    );
  }, [restaurantId]);

  useEffect(() => {
    // Load available restaurants for system admin
    if (systemAdmin) {
      getDocs(query(collection(db, "restaurants"), where("status", "==", "active")))
        .then((snapshot) => {
          setAvailableRestaurants(snapshot.docs.map((doc) => ({ id: doc.id, name: String(doc.data().name || "Restaurante") })));
        })
        .catch((error) => {
          console.error("Erro ao carregar restaurantes:", error);
        });
    }
  }, [systemAdmin]);

  const occupied = useMemo(
    () =>
      tables.filter(
        (table) => table.status === "ocupada",
      ).length,
    [tables],
  );

  const free = useMemo(
    () =>
      tables.filter(
        (table) => table.status === "livre",
      ).length,
    [tables],
  );

  const reserved = useMemo(
    () =>
      tables.filter(
        (table) => table.status === "reservada",
      ).length,
    [tables],
  );

  const totalOpen = useMemo(
    () =>
      tables.reduce(
        (sum, table) => sum + table.total,
        0,
      ),
    [tables],
  );

  const selectedItems = useMemo(() => {
    if (!selectedTable) {
      return [];
    }

    return (
      exampleItems[selectedTable.number] || []
    );
  }, [selectedTable]);

  const itemsTotal = useMemo(
    () =>
      selectedItems.reduce(
        (sum, item) =>
          sum + item.quantity * item.price,
        0,
      ),
    [selectedItems],
  );

  const billSubtotal = selectedTable
    ? selectedItems.length > 0
      ? itemsTotal
      : selectedTable.total
    : 0;

  const serviceFee = billSubtotal * 0.1;
  const closingTotal =
    billSubtotal + serviceFee;

  function selectTable(table: Table) {
    setSelectedTable(table);
  }

  function handleDragStart(_e: React.MouseEvent, tableNumber: number) {
    setDraggingTable(tableNumber);
  }

  function handleDragMove(e: React.MouseEvent) {
    if (draggingTable === null) return;
    e.preventDefault();
    
    const floorMap = document.querySelector('.floor-map');
    if (!floorMap) return;

    const floorRect = floorMap.getBoundingClientRect();
    const x = ((e.clientX - floorRect.left) / floorRect.width) * 100;
    const y = ((e.clientY - floorRect.top) / floorRect.height) * 100;

    // Clamp values to keep table within bounds
    const clampedX = Math.max(0, Math.min(x, 85));
    const clampedY = Math.max(0, Math.min(y, 85));

    setTables(prev => prev.map(table => 
      table.number === draggingTable 
        ? { ...table, x: clampedX, y: clampedY }
        : table
    ));
  }

  function handleDragEnd() {
    if (draggingTable === null) return;
    
    // Save the new position to Firebase
    const table = tables.find(t => t.number === draggingTable);
    if (table && table.x !== undefined && table.y !== undefined) {
      void updateDoc(doc(db, "tables", `${restaurantId}_${table.number}`), {
        x: table.x,
        y: table.y,
      });
    }
    
    setDraggingTable(null);
  }

  function openQR(table: Table) {
    setSelectedTable(table);
    setShowQR(true);
    setShowTap(false);
    setShowClose(false);
    setCopied(false);
  }

  function openTap(table: Table) {
    setSelectedTable(table);
    setShowTap(true);
    setShowQR(false);
    setShowClose(false);
    setCopied(false);
  }

  function openClose(table: Table) {
    if (table.status === "livre") {
      return;
    }

    setSelectedTable(table);
    setShowClose(true);
    setShowQR(false);
    setShowTap(false);
  }

  function closeAllModals() {
    setShowQR(false);
    setShowTap(false);
    setShowClose(false);
    setShowTableForm(false);
    setShowDeleteConfirm(false);
    setCopied(false);
  }

  function openCreateTable() {
    setEditingTable(null);
    setShowTableForm(true);
    setShowQR(false);
    setShowTap(false);
    setShowClose(false);
  }

  function openEditTable(table: Table) {
    setEditingTable(table);
    setShowTableForm(true);
    setShowQR(false);
    setShowTap(false);
    setShowClose(false);
  }

  async function saveTable(formTable: Table) {
    const numberExists = tables.some(
      (table) =>
        table.number === formTable.number &&
        table.number !== editingTable?.number,
    );

    if (numberExists) {
      window.alert(
        "Já existe uma mesa com esse número.",
      );
      return;
    }

    if (!restaurantId) {
      window.alert("Selecione primeiro um restaurante ativo.");
      return;
    }

    try {
      const nextTable = { ...formTable, restaurantId };
      // Remover campos undefined antes de salvar no Firestore
      const tableToSave = Object.fromEntries(
        Object.entries(nextTable).filter(([_, value]) => value !== undefined)
      );
      await setDoc(doc(db, "tables", `${restaurantId}_${formTable.number}`), tableToSave);
      if (editingTable && editingTable.number !== formTable.number) {
        await deleteDoc(doc(db, "tables", `${restaurantId}_${editingTable.number}`));
      }
      setSelectedTable(nextTable);
    } catch (saveError) {
      console.error("Erro ao salvar mesa:", saveError);
      window.alert("Não foi possível salvar a mesa.");
      return;
    }

    setShowTableForm(false);
    setEditingTable(null);
  }

  function openDeleteTable(table: Table) {
    setSelectedTable(table);
    setShowDeleteConfirm(true);
  }

  function deleteTable() {
    if (!selectedTable) {
      return;
    }

    if (selectedTable.status === "ocupada") {
      window.alert(
        "Não é possível excluir uma mesa ocupada. Feche a comanda primeiro.",
      );
      return;
    }

    void deleteDoc(doc(db, "tables", `${restaurantId}_${selectedTable.number}`))
      .then(() => {
        setSelectedTable(null);
        setShowDeleteConfirm(false);
      })
      .catch((deleteError) => {
        console.error("Erro ao remover mesa:", deleteError);
        window.alert("Não foi possível remover a mesa.");
      });
  }

  async function copyTableUrl() {
    if (!selectedTable) {
      return;
    }

    const url = getTableUrl(
      restaurantId,
      selectedTable.number,
    );

    try {
      await navigator.clipboard.writeText(url);

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      window.prompt(
        "Copie o endereço da mesa:",
        url,
      );
    }
  }

  async function writeNFC() {
    if (!selectedTable) {
      return;
    }

    const url = getTableUrl(
      restaurantId,
      selectedTable.number,
    );

    try {
      const NFCReader = (
        window as Window & {
          NDEFReader?: new () => {
            write: (message: {
              records: Array<{
                recordType: string;
                data: string;
              }>;
            }) => Promise<void>;
          };
        }
      ).NDEFReader;

      if (!NFCReader) {
        await navigator.clipboard.writeText(url);

        window.alert(
          "O navegador não disponibilizou gravação NFC. A URL da mesa foi copiada.",
        );

        return;
      }

      const ndef = new NFCReader();

      await ndef.write({
        records: [
          {
            recordType: "url",
            data: url,
          },
        ],
      });

      window.alert(
        `NFC da Mesa ${selectedTable.number} gravado com sucesso!`,
      );
    } catch (error) {
      console.error(
        "Erro ao gravar NFC:",
        error,
      );

      window.alert(
        "Não foi possível gravar a tag NFC.",
      );
    }
  }

  async function confirmCloseTable() {
    if (!selectedTable) {
      return;
    }

    try {
      // Print bill automatically if enabled
      const userPrinterSettings = getUserPrinterSettings();
      if (userPrinterSettings.printerEnabled) {
        const billItems = selectedItems.map(item => ({
          name: item.name,
          quantity: item.quantity,
          price: item.price,
        }));

        const billContent = generatePrintContent(
          "CONTA FINALIZADA",
          `MESA-${selectedTable.number}-${Date.now().toString().slice(-6)}`,
          selectedTable.number,
          billItems,
          closingTotal,
          {
            "Pagamento": paymentMethod === "pix" ? "Pix" : paymentMethod === "card" ? "Cartão" : "Dinheiro",
            "Taxa de serviço": formatCurrency(serviceFee),
            "Garçom": selectedTable.customer || "Não informado",
          },
          userPrinterSettings.paperWidth,
        );
        await printToPrinter(billContent, userPrinterSettings);
      }

      await updateDoc(doc(db, "tables", `${restaurantId}_${selectedTable.number}`), {
        status: "livre",
        guests: 0,
        total: 0,
        customer: deleteField(),
      });
      closeAllModals();
      setSelectedTable(null);
    } catch (closeError) {
      console.error("Erro ao fechar mesa:", closeError);
      window.alert("Não foi possível fechar esta mesa.");
    }
  }

  function openFirstFreeQR() {
    const firstFree = tables.find(
      (table) =>
        table.status === "livre",
    );

    if (!firstFree) {
      window.alert(
        "Não existe nenhuma mesa livre no momento.",
      );
      return;
    }

    openQR(firstFree);
  }

  function openFirstFreeTap() {
    const firstFree = tables.find(
      (table) =>
        table.status === "livre",
    );

    if (!firstFree) {
      window.alert(
        "Não existe nenhuma mesa livre no momento.",
      );
      return;
    }

    openTap(firstFree);
  }

  return (
    <div className="tables-page">
      <div className="module-header">
        <div>
          <div className="eyebrow">
            OPERAÇÃO
          </div>

          <h1>Mesas</h1>

          <p>
            Controle o salão, comandas, QR Code e
            Tap/NFC em um único lugar.
          </p>
        </div>

        {systemAdmin && !restaurantId && availableRestaurants.length > 0 && (
          <div className="restaurant-selector">
            <button
              className="secondary-button"
              onClick={() => setShowRestaurantDropdown(!showRestaurantDropdown)}
            >
              <Store size={18} />
              {restaurantId
                ? availableRestaurants.find(r => r.id === restaurantId)?.name || "Restaurante selecionado"
                : "Selecione um restaurante"}
              <ChevronDown size={16} />
            </button>

            {showRestaurantDropdown && (
              <div className="dropdown-menu">
                {availableRestaurants.map((restaurant) => (
                  <button
                    key={restaurant.id}
                    type="button"
                    className="dropdown-item"
                    onClick={() => {
                      setRestaurantId(restaurant.id);
                      setShowRestaurantDropdown(false);
                    }}
                  >
                    {restaurant.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="module-header-actions">
          <button
            className="secondary-button"
            onClick={openCreateTable}
            type="button"
            disabled={!restaurantId}
          >
            <Plus size={18} />
            Nova mesa
          </button>

          <button
            className="secondary-button"
            onClick={openFirstFreeQR}
            type="button"
            disabled={!restaurantId}
          >
            <QrCode size={18} />
            QR Code
          </button>

          <button
            className="primary-button"
            onClick={openFirstFreeTap}
            type="button"
            disabled={!restaurantId}
          >
            <Radio size={18} />
            Configurar Tap
          </button>
        </div>
      </div>

      <div className="table-summary">
        <div className="table-summary-card">
          <div className="summary-icon occupied-icon">
            <span />
          </div>

          <div>
            <strong>{occupied}</strong>
            <span>Ocupadas</span>
          </div>
        </div>

        <div className="table-summary-card">
          <div className="summary-icon free-icon">
            <span />
          </div>

          <div>
            <strong>{free}</strong>
            <span>Livres</span>
          </div>
        </div>

        <div className="table-summary-card">
          <div className="summary-icon reserved-icon">
            <span />
          </div>

          <div>
            <strong>{reserved}</strong>
            <span>Reservadas</span>
          </div>
        </div>

        <div className="table-summary-card">
          <div className="summary-icon revenue-icon">
            <Receipt size={18} />
          </div>

          <div>
            <strong>
              {formatCurrency(totalOpen)}
            </strong>
            <span>Em comandas</span>
          </div>
        </div>
      </div>

      <div className="tables-layout">
        <section className="floor-map-card">
          <div className="section-header">
            <div>
              <h2>Mapa do salão</h2>

              <p>
                Clique em uma mesa para abrir a
                comanda.
              </p>
            </div>

            <div className="table-legend">
              <span>
                <i className="legend-dot free" />
                Livre
              </span>

              <span>
                <i className="legend-dot occupied" />
                Ocupada
              </span>

              <span>
                <i className="legend-dot reserved" />
                Reservada
              </span>

              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', color: '#71807b', fontSize: '10px' }}>
                <Move size={14} />
                Arraste para mover
              </span>
            </div>
          </div>

          <div className="floor-map"
            onMouseMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
          >
            <div className="floor-label floor-label-top">
              ENTRADA / SALÃO PRINCIPAL
            </div>

            <div className="map-zone zone-left">
              <span>JANELAS</span>
            </div>

            {tables.map((table) => {
              const position = table.x !== undefined && table.y !== undefined
                ? { left: `${table.x}%`, top: `${table.y}%` }
                : tablePositions[table.number - 1] || tablePositions[0];

              return (
                <button
                  key={table.number}
                  type="button"
                  className={`floor-table table-${table.status} ${
                    selectedTable?.number === table.number
                      ? "selected"
                      : ""
                  } ${draggingTable === table.number ? "dragging" : ""}`}
                  style={position}
                  onMouseDown={(e) => handleDragStart(e, table.number)}
                  onClick={() => selectTable(table)}
                  title="Arraste para mover a mesa"
                >
                  <div className="floor-table-number">
                    {table.number}
                  </div>

                  <div className="floor-table-content">
                    <strong>
                      Mesa {table.number}
                    </strong>

                    {table.status ===
                      "ocupada" && (
                      <>
                        <span>
                          {table.customer ||
                            "Cliente"}
                        </span>

                        <small>
                          {formatCurrency(
                            table.total,
                          )}
                        </small>
                      </>
                    )}

                    {table.status ===
                      "livre" && (
                      <span>
                        Disponível
                      </span>
                    )}

                    {table.status ===
                      "reservada" && (
                      <span>
                        Reservada
                      </span>
                    )}
                  </div>

                  {table.status ===
                    "ocupada" && (
                    <div className="table-guest-count">
                      <Users size={12} />
                      {table.guests}
                    </div>
                  )}
                </button>
              );
            })}

            <div className="map-zone zone-right">
              <span>BALCÃO</span>
            </div>

            <div className="kitchen-zone">
              <span>COZINHA</span>
            </div>
          </div>
        </section>

        <aside className="table-detail-card">
          {!selectedTable ? (
            <div className="empty-table-detail">
              <div className="empty-table-icon">
                <Receipt size={28} />
              </div>

              <h3>
                Selecione uma mesa
              </h3>

              <p>
                Clique em qualquer mesa no mapa
                para visualizar a comanda, QR
                Code, Tap/NFC e opções.
              </p>
            </div>
          ) : (
            <>
              <div className="detail-header">
                <div>
                  <span className="detail-kicker">
                    MESA{" "}
                    {selectedTable.number}
                  </span>

                  <h2>
                    Mesa{" "}
                    {selectedTable.number}
                  </h2>

                  <div
                    className={`detail-status status-${selectedTable.status}`}
                  >
                    <span />
                    {statusLabel(
                      selectedTable.status,
                    )}
                  </div>
                </div>

                <div className="detail-header-actions">
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() =>
                      openEditTable(
                        selectedTable,
                      )
                    }
                    title="Editar mesa"
                    aria-label="Editar mesa"
                  >
                    <Pencil size={17} />
                  </button>

                  <button
                    className="icon-button danger-icon"
                    type="button"
                    onClick={() =>
                      openDeleteTable(
                        selectedTable,
                      )
                    }
                    title="Excluir mesa"
                    aria-label="Excluir mesa"
                  >
                    <Trash2 size={17} />
                  </button>

                  <button
                    className="icon-button"
                    type="button"
                    onClick={() =>
                      setSelectedTable(null)
                    }
                    title="Fechar"
                    aria-label="Fechar detalhes"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {selectedTable.status ===
              "ocupada" ? (
                <>
                  <div className="detail-customer">
                    <div className="customer-avatar">
                      {selectedTable.customer?.charAt(
                        0,
                      ) || "C"}
                    </div>

                    <div>
                      <strong>
                        {selectedTable.customer ||
                          "Cliente"}
                      </strong>

                      <span>
                        {selectedTable.guests}{" "}
                        pessoas · capacidade{" "}
                        {selectedTable.capacity}
                      </span>
                    </div>
                  </div>

                  <div className="bill-section">
                    <div className="bill-section-title">
                      <span>
                        Comanda atual
                      </span>

                      <span>
                        {selectedItems.length}{" "}
                        itens
                      </span>
                    </div>

                    <div className="bill-items">
                      {selectedItems.length ===
                      0 ? (
                        <div className="empty-bill">
                          Nenhum item lançado.
                        </div>
                      ) : (
                        selectedItems.map(
                          (
                            item,
                            index,
                          ) => (
                            <div
                              className="bill-item"
                              key={`${item.name}-${index}`}
                            >
                              <div>
                                <strong>
                                  {
                                    item.quantity
                                  }
                                  x{" "}
                                  {
                                    item.name
                                  }
                                </strong>

                                <span>
                                  {formatCurrency(
                                    item.price,
                                  )}{" "}
                                  cada
                                </span>
                              </div>

                              <strong>
                                {formatCurrency(
                                  item.quantity *
                                    item.price,
                                )}
                              </strong>
                            </div>
                          ),
                        )
                      )}
                    </div>

                    <div className="bill-total">
                      <span>
                        Total da mesa
                      </span>

                      <strong>
                        {formatCurrency(
                          billSubtotal,
                        )}
                      </strong>
                    </div>
                  </div>

                  <div className="table-actions-grid">
                    <button
                      className="table-action"
                      type="button"
                      onClick={() =>
                        openQR(
                          selectedTable,
                        )
                      }
                    >
                      <QrCode size={18} />
                      <span>QR Code</span>
                    </button>

                    <button
                      className="table-action"
                      type="button"
                      onClick={() =>
                        openTap(
                          selectedTable,
                        )
                      }
                    >
                      <Radio size={18} />
                      <span>
                        Tap / NFC
                      </span>
                    </button>

                    <button
                      className="table-action"
                      type="button"
                      onClick={() =>
                        window.alert(
                          `Adicionar pedido na Mesa ${selectedTable.number}`,
                        )
                      }
                    >
                      <Receipt size={18} />
                      <span>
                        Novo pedido
                      </span>
                    </button>

                    <button
                      className="table-action"
                      type="button"
                      onClick={() =>
                        openClose(
                          selectedTable,
                        )
                      }
                    >
                      <CheckCircle2
                        size={18}
                      />
                      <span>
                        Fechar mesa
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="free-table-detail">
                  <div className="free-table-big-icon">
                    {selectedTable.status ===
                    "livre" ? (
                      <CheckCircle2
                        size={32}
                      />
                    ) : (
                      <Clock3 size={32} />
                    )}
                  </div>

                  <h3>
                    {selectedTable.status ===
                    "livre"
                      ? "Mesa disponível"
                      : "Mesa reservada"}
                  </h3>

                  <p>
                    {selectedTable.status ===
                    "livre"
                      ? "Essa mesa está pronta para receber um novo cliente."
                      : "Essa mesa possui uma reserva programada."}
                  </p>

                  <div className="free-table-actions">
                    <button
                      className="primary-button full-button"
                      type="button"
                      onClick={() =>
                        openQR(
                          selectedTable,
                        )
                      }
                    >
                      <QrCode size={18} />
                      Abrir QR Code
                    </button>

                    <button
                      className="secondary-button full-button"
                      type="button"
                      onClick={() =>
                        openTap(
                          selectedTable,
                        )
                      }
                    >
                      <Radio size={18} />
                      Configurar Tap/NFC
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {showQR && selectedTable && (
        <div
          className="modal-overlay"
          onClick={closeAllModals}
          role="presentation"
        >
          <div
            className="modal qr-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
            role="dialog"
            aria-modal="true"
          >
            <button
              className="modal-close"
              type="button"
              onClick={closeAllModals}
              aria-label="Fechar QR Code"
            >
              <X size={20} />
            </button>

            <div className="modal-icon qr-modal-icon">
              <QrCode size={25} />
            </div>

            <div className="modal-title">
              <span>
                ACESSO DA MESA
              </span>

              <h2>
                QR Code · Mesa{" "}
                {selectedTable.number}
              </h2>

              <p>
                O cliente aponta a câmera e
                entra diretamente no cardápio
                dessa mesa.
              </p>
            </div>

            <div className="qr-display">
              <QRCodeCanvas
                value={getTableUrl(
                  restaurantId,
                  selectedTable.number,
                )}
                size={220}
                level="H"
                includeMargin
              />
            </div>

            <div className="qr-table-number">
              <span>MESA</span>
              <strong>
                {selectedTable.number}
              </strong>
            </div>

            <div className="qr-url">
              {getTableUrl(
                restaurantId,
                selectedTable.number,
              )}
            </div>

            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={copyTableUrl}
              >
                {copied ? (
                  <>
                    <CheckCircle2
                      size={18}
                    />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy size={18} />
                    Copiar link
                  </>
                )}
              </button>

              <button
                className="primary-button"
                type="button"
                onClick={() =>
                  window.open(
                    getTableUrl(
                      restaurantId,
                      selectedTable.number,
                    ),
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                <Smartphone size={18} />
                Abrir como cliente
              </button>
            </div>
          </div>
        </div>
      )}

      {showTap && selectedTable && (
        <div
          className="modal-overlay"
          onClick={closeAllModals}
          role="presentation"
        >
          <div
            className="modal tap-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
            role="dialog"
            aria-modal="true"
          >
            <button
              className="modal-close"
              type="button"
              onClick={closeAllModals}
              aria-label="Fechar configuração NFC"
            >
              <X size={20} />
            </button>

            <div className="modal-icon tap-modal-icon">
              <Radio size={25} />
            </div>

            <div className="modal-title">
              <span>
                TECNOLOGIA TAP
              </span>

              <h2>
                Tap / NFC · Mesa{" "}
                {selectedTable.number}
              </h2>

              <p>
                A tag NFC usa o mesmo endereço
                do QR Code.
              </p>
            </div>

            <div className="nfc-visual">
              <div className="nfc-circle">
                <Radio size={42} />
              </div>

              <div className="nfc-waves">
                <span />
                <span />
                <span />
              </div>
            </div>

            <div className="nfc-url-box">
              <span>
                ENDEREÇO DA MESA
              </span>

              <strong>
                {getTableUrl(
                  restaurantId,
                  selectedTable.number,
                )}
              </strong>
            </div>

            <div className="modal-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={copyTableUrl}
              >
                <Copy size={18} />
                Copiar URL
              </button>

              <button
                className="primary-button"
                type="button"
                onClick={writeNFC}
              >
                <Radio size={18} />
                Gravar NFC
              </button>
            </div>

            <div className="nfc-help">
              <strong>
                Como funciona
              </strong>

              <span>
                1. Use uma tag NFC compatível.
              </span>

              <span>
                2. Grave o endereço desta mesa.
              </span>

              <span>
                3. Cole a tag na mesa.
              </span>

              <span>
                4. O cliente aproxima o celular.
              </span>
            </div>
          </div>
        </div>
      )}

      {showClose && selectedTable && (
        <div
          className="modal-overlay"
          onClick={closeAllModals}
          role="presentation"
        >
          <div
            className="modal close-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
            role="dialog"
            aria-modal="true"
          >
            <button
              className="modal-close"
              type="button"
              onClick={closeAllModals}
              aria-label="Fechar pagamento"
            >
              <X size={20} />
            </button>

            <div className="modal-icon close-modal-icon">
              <CheckCircle2 size={25} />
            </div>

            <div className="modal-title">
              <span>
                FINALIZAÇÃO
              </span>

              <h2>
                Fechar Mesa{" "}
                {selectedTable.number}
              </h2>

              <p>
                Confira os valores antes de
                liberar a mesa.
              </p>
            </div>

            <div className="closing-summary">
              <div>
                <span>Subtotal</span>

                <strong>
                  {formatCurrency(
                    billSubtotal,
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Taxa de serviço · 10%
                </span>

                <strong>
                  {formatCurrency(
                    serviceFee,
                  )}
                </strong>
              </div>

              <div className="closing-total">
                <span>Total</span>

                <strong>
                  {formatCurrency(
                    closingTotal,
                  )}
                </strong>
              </div>
            </div>

            <div className="payment-title">
              Forma de pagamento
            </div>

            <div className="payment-options">
              <button
                type="button"
                className={
                  paymentMethod === "pix"
                    ? "payment-option active"
                    : "payment-option"
                }
                onClick={() =>
                  setPaymentMethod("pix")
                }
              >
                <WalletCards size={20} />
                <span>PIX</span>
              </button>

              <button
                type="button"
                className={
                  paymentMethod === "card"
                    ? "payment-option active"
                    : "payment-option"
                }
                onClick={() =>
                  setPaymentMethod("card")
                }
              >
                <CreditCard size={20} />
                <span>Cartão</span>
              </button>

              <button
                type="button"
                className={
                  paymentMethod === "cash"
                    ? "payment-option active"
                    : "payment-option"
                }
                onClick={() =>
                  setPaymentMethod("cash")
                }
              >
                <Banknote size={20} />
                <span>Dinheiro</span>
              </button>
            </div>

            <button
              className="primary-button close-table-confirm"
              type="button"
              onClick={confirmCloseTable}
            >
              <CheckCircle2 size={19} />
              Confirmar pagamento e liberar
              mesa
            </button>
          </div>
        </div>
      )}

      {showTableForm && (
        <TableFormModal
          table={editingTable}
          existingTables={tables}
          onClose={() => {
            setShowTableForm(false);
            setEditingTable(null);
          }}
          onSave={saveTable}
        />
      )}

      {showDeleteConfirm &&
        selectedTable && (
          <div
            className="modal-overlay"
            onClick={() =>
              setShowDeleteConfirm(false)
            }
            role="presentation"
          >
            <div
              className="modal delete-modal"
              onClick={(event) =>
                event.stopPropagation()
              }
              role="dialog"
              aria-modal="true"
            >
              <button
                className="modal-close"
                type="button"
                onClick={() =>
                  setShowDeleteConfirm(false)
                }
                aria-label="Fechar"
              >
                <X size={20} />
              </button>

              <div className="modal-icon delete-modal-icon">
                <Trash2 size={25} />
              </div>

              <div className="modal-title">
                <span>
                  EXCLUIR MESA
                </span>

                <h2>
                  Excluir Mesa{" "}
                  {selectedTable.number}?
                </h2>

                <p>
                  Essa ação removerá a mesa do
                  mapa do salão.
                </p>
              </div>

              <div className="delete-warning">
                <strong>
                  Atenção
                </strong>

                <span>
                  A mesa não poderá ser
                  recuperada depois da exclusão.
                </span>
              </div>

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    setShowDeleteConfirm(
                      false,
                    )
                  }
                >
                  Cancelar
                </button>

                <button
                  className="danger-button"
                  type="button"
                  onClick={deleteTable}
                >
                  <Trash2 size={18} />
                  Excluir mesa
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

type TableFormModalProps = {
  table: Table | null;
  existingTables: Table[];
  onClose: () => void;
  onSave: (table: Table) => void;
};

function TableFormModal({
  table,
  existingTables,
  onClose,
  onSave,
}: TableFormModalProps) {
  const [number, setNumber] =
    useState(
      table?.number ??
        Math.max(
          0,
          ...existingTables.map(
            (item) => item.number,
          ),
        ) + 1,
    );

  const [capacity, setCapacity] =
    useState(table?.capacity ?? 4);

  const [status, setStatus] =
    useState<TableStatus>(
      table?.status ?? "livre",
    );

  const [customer, setCustomer] =
    useState(table?.customer ?? "");

  const [guests, setGuests] =
    useState(table?.guests ?? 0);

  function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (number < 1) {
      window.alert(
        "O número da mesa deve ser maior que zero.",
      );
      return;
    }

    if (capacity < 1) {
      window.alert(
        "A capacidade deve ser maior que zero.",
      );
      return;
    }

    if (guests > capacity) {
      window.alert(
        "A quantidade de pessoas não pode ser maior que a capacidade da mesa.",
      );
      return;
    }

    const tableData: Table = {
      number,
      capacity,
      status,
      guests:
        status === "livre"
          ? 0
          : guests,
      total: table?.total ?? 0,
      customer:
        customer.trim() || undefined,
    };

    onSave(tableData);
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="modal table-form-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
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
          {table ? (
            <Pencil size={24} />
          ) : (
            <Plus size={24} />
          )}
        </div>

        <div className="modal-title">
          <span>
            CONFIGURAÇÃO
          </span>

          <h2>
            {table
              ? "Editar mesa"
              : "Cadastrar mesa"}
          </h2>

          <p>
            Configure as informações da mesa
            no salão.
          </p>
        </div>

        <form
          className="table-form"
          onSubmit={handleSubmit}
        >
          <div className="form-row">
            <label className="form-field">
              <span>Número</span>
              <input
                type="number"
                min="1"
                value={number}
                onChange={(e) =>
                  setNumber(
                    Number(e.target.value),
                  )
                }
                required
              />
            </label>

            <label className="form-field">
              <span>Capacidade</span>
              <input
                type="number"
                min="1"
                value={capacity}
                onChange={(e) =>
                  setCapacity(
                    Number(e.target.value),
                  )
                }
                required
              />
            </label>
          </div>

          <label className="form-field">
            <span>Status</span>
            <select
              value={status}
              onChange={(e) =>
                setStatus(
                  e.target.value as TableStatus,
                )
              }
            >
              <option value="livre">Livre</option>
              <option value="ocupada">Ocupada</option>
              <option value="reservada">Reservada</option>
            </select>
          </label>

          {status !== "livre" && (
            <>
              <label className="form-field">
                <span>Cliente</span>
                <input
                  type="text"
                  value={customer}
                  onChange={(e) =>
                    setCustomer(e.target.value)
                  }
                />
              </label>

              <label className="form-field">
                <span>Quantidade de pessoas</span>
                <input
                  type="number"
                  min="0"
                  max={capacity}
                  value={guests}
                  onChange={(e) =>
                    setGuests(
                      Number(e.target.value),
                    )
                  }
                />
              </label>
            </>
          )}

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
            >
              <CheckCircle2 size={18} />
              Salvar mesa
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
