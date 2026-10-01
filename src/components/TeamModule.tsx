import { useEffect, useState } from "react";
import {
  Check,
  Clipboard,
  Edit,
  Plus,
  QrCode,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";

interface TeamMember {
  id: string;
  name: string;
  role: string;
  employeeNumber: string;
  status: "ativo" | "inativo";
  uid: string;
  hireDate?: Date;
}

type WaiterForm = Pick<TeamMember, "name" | "role" | "employeeNumber">;

const waiterRoles = ["Garçom", "Garçonete", "Chefe de salão"];

function convertMember(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): TeamMember {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: String(data.name || "Garçom"),
    role: String(data.role || "Garçom"),
    employeeNumber: String(data.employeeNumber || ""),
    status: data.active === false ? "inativo" : "ativo",
    uid: String(data.uid || ""),
    hireDate:
      data.createdAt?.toDate instanceof Function
        ? data.createdAt.toDate()
        : undefined,
  };
}

const emptyForm: WaiterForm = {
  name: "",
  role: waiterRoles[0],
  employeeNumber: "",
};

export default function TeamModule() {
  const { restaurantId } = useRestaurantScope();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [formData, setFormData] = useState<WaiterForm>(emptyForm);
  const [activationUrl, setActivationUrl] = useState("");
  const [activationName, setActivationName] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!restaurantId) {
      return;
    }

    const waitersQuery = query(
      collection(db, "waiters"),
      where("restaurantId", "==", restaurantId),
    );
    return onSnapshot(
      waitersQuery,
      (snapshot) => {
        setMembers(snapshot.docs.map(convertMember).sort(
          (first, second) => (second.hireDate?.getTime() || 0) - (first.hireDate?.getTime() || 0),
        ));
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        console.error("Erro ao carregar garçons:", snapshotError);
        setError("Não foi possível carregar a equipe.");
        setLoading(false);
      },
    );
  }, [restaurantId]);

  const filteredMembers = members.filter((member) =>
    `${member.name} ${member.employeeNumber}`
      .toLowerCase()
      .includes(searchTerm.toLowerCase().trim()),
  );
  const activeMembers = members.filter((member) => member.status === "ativo");
  const pendingAccess = activeMembers.filter((member) => !member.uid).length;

  function handleAddMember() {
    setEditingMember(null);
    setFormData(emptyForm);
    setError("");
    setShowModal(true);
  }

  function handleEditMember(member: TeamMember) {
    setEditingMember(member);
    setFormData({
      name: member.name,
      role: member.role,
      employeeNumber: member.employeeNumber,
    });
    setError("");
    setShowModal(true);
  }

  function showActivation(memberName: string, waiterId: string) {
    const url = new URL(`/garcom/${encodeURIComponent(restaurantId)}/${encodeURIComponent(waiterId)}`, window.location.origin);
    setActivationName(memberName);
    setActivationUrl(url.toString());
    setCopied(false);
  }

  async function handleSaveMember() {
    if (!formData.name.trim() || !formData.employeeNumber.trim() || busy) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const normalizedNumber = formData.employeeNumber.trim();
      const existingMembers = await getDocs(query(
        collection(db, "waiters"),
        where("restaurantId", "==", restaurantId),
      ));
      if (existingMembers.docs.some((item) =>
        item.id !== editingMember?.id && item.data().employeeNumber === normalizedNumber,
      )) {
        throw new Error("Esse número de cadastro já está em uso.");
      }

      if (editingMember) {
        const batch = writeBatch(db);
        batch.update(doc(db, "waiters", editingMember.id), {
          name: formData.name.trim(),
          role: formData.role,
          employeeNumber: normalizedNumber,
        });
        batch.set(doc(db, "waiterDirectory", editingMember.id), {
          restaurantId,
          name: formData.name.trim(),
          role: formData.role,
          active: editingMember.status === "ativo",
        });
        await batch.commit();
        setNotice("Cadastro do garçom atualizado.");
      } else {
        const waiterRef = doc(collection(db, "waiters"));
        const batch = writeBatch(db);
        batch.set(waiterRef, {
          name: formData.name.trim(),
          role: formData.role,
          employeeNumber: normalizedNumber,
          restaurantId,
          email: "",
          uid: "",
          active: true,
          createdAt: serverTimestamp(),
        });
        batch.set(doc(db, "waiterDirectory", waiterRef.id), {
          restaurantId,
          name: formData.name.trim(),
          role: formData.role,
          active: true,
        });
        await batch.commit();
        showActivation(formData.name, waiterRef.id);
      }
      setShowModal(false);
    } catch (saveError) {
      console.error("Erro ao salvar garçom:", saveError);
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o cadastro.");
    } finally {
      setBusy(false);
    }
  }

  function handleGenerateQr(member: TeamMember) {
    showActivation(member.name, member.id);
  }

  async function handleDeleteMember(member: TeamMember) {
    if (!window.confirm(`Remover o acesso de ${member.name}?`)) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, "waiters", member.id));
      batch.delete(doc(db, "waiterDirectory", member.id));
      await batch.commit();
      setNotice("Acesso do garçom removido.");
    } catch (deleteError) {
      console.error("Erro ao remover garçom:", deleteError);
      setError("Não foi possível remover este garçom.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(member: TeamMember) {
    setBusy(true);
    setError("");
    try {
      const active = member.status !== "ativo";
      const batch = writeBatch(db);
      batch.update(doc(db, "waiters", member.id), { active });
      batch.update(doc(db, "waiterDirectory", member.id), { active });
      await batch.commit();
      setNotice(member.status === "ativo" ? "Acesso desativado." : "Acesso ativado.");
    } catch (statusError) {
      console.error("Erro ao alterar acesso:", statusError);
      setError("Não foi possível alterar o acesso deste garçom.");
    } finally {
      setBusy(false);
    }
  }

  async function copyActivationUrl() {
    try {
      await navigator.clipboard.writeText(activationUrl);
      setCopied(true);
    } catch {
      setError("Não foi possível copiar o link neste dispositivo.");
    }
  }

  return (
    <div className="module-page team-page">
      <div className="module-header">
        <div>
          <h1>Garçons</h1>
          <p>Cadastre acessos e gerencie o atendimento do salão.</p>
        </div>
        <button className="primary-button" type="button" onClick={handleAddMember}>
          <Plus size={18} />
          Cadastrar garçom
        </button>
      </div>

      {error && <div className="team-feedback error" role="alert">{error}</div>}
      {notice && <div className="team-feedback" role="status">{notice}</div>}

      <div className="team-dashboard">
        <div className="stat-card">
          <div className="stat-icon"><Users size={24} /></div>
          <div><span>Garçons ativos</span><strong>{activeMembers.length}</strong></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><QrCode size={24} /></div>
          <div><span>Contas cadastradas</span><strong>{members.length}</strong></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><Users size={24} /></div>
          <div><span>Aguardando primeiro acesso</span><strong>{pendingAccess}</strong></div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="search-input">
          <Search size={18} />
          <input
            type="search"
            placeholder="Buscar garçom..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="team-empty">Carregando equipe...</div>
      ) : filteredMembers.length === 0 ? (
        <div className="team-empty">
          {searchTerm ? "Nenhum garçom encontrado." : "Cadastre o primeiro garçom para gerar o QR de acesso."}
        </div>
      ) : (
        <div className="team-grid">
          {filteredMembers.map((member) => (
            <article key={member.id} className={`team-card ${member.status === "inativo" ? "inactive" : ""}`}>
              <div className="team-card-header">
                <div className="team-avatar"><span>🍽️</span></div>
                <div className="team-actions">
                  <button type="button" onClick={() => handleGenerateQr(member)} title="Mostrar QR de acesso" disabled={busy || member.status !== "ativo"}>
                    <QrCode size={16} />
                  </button>
                  <button type="button" onClick={() => handleEditMember(member)} title="Editar cadastro" disabled={busy}>
                    <Edit size={16} />
                  </button>
                  <button type="button" onClick={() => void handleDeleteMember(member)} title="Remover acesso" disabled={busy}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="team-card-body">
                <h3>{member.name}</h3>
                <span className="role-badge">{member.role}</span>
                <div className="team-details">
                  <div><span>Número de cadastro</span><strong>{member.employeeNumber}</strong></div>
                  <div><span>Acesso ao sistema</span><strong>{member.uid ? "Vinculado" : "Pendente"}</strong></div>
                  <div><span>Cadastro</span><strong>{member.hireDate?.toLocaleDateString("pt-BR") || "-"}</strong></div>
                </div>
              </div>
              <div className="team-card-footer">
                <div className={`status-badge ${member.status}`}>{member.status === "ativo" ? "Ativo" : "Inativo"}</div>
                <button type="button" className="toggle-status-button" onClick={() => void toggleStatus(member)} disabled={busy}>
                  {member.status === "ativo" ? "Desativar acesso" : "Ativar acesso"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="waiter-form-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2 id="waiter-form-title">{editingMember ? "Editar garçom" : "Cadastrar garçom"}</h2>
              <button type="button" onClick={() => setShowModal(false)} aria-label="Fechar"><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-field">
                <label htmlFor="waiter-name">Nome completo</label>
                <input id="waiter-name" value={formData.name} onChange={(event) => setFormData({ ...formData, name: event.target.value })} required />
              </div>
              <div className="form-field">
                <label htmlFor="waiter-role">Função</label>
                <select id="waiter-role" value={formData.role} onChange={(event) => setFormData({ ...formData, role: event.target.value })}>
                  {waiterRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="waiter-employee-number">Número de cadastro da empresa</label>
                <input id="waiter-employee-number" value={formData.employeeNumber} onChange={(event) => setFormData({ ...formData, employeeNumber: event.target.value })} required />
              </div>
              {error && <div className="team-feedback error" role="alert">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="secondary-button" type="button" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="primary-button" type="button" onClick={() => void handleSaveMember()} disabled={busy || !formData.name.trim() || !formData.employeeNumber.trim()}>
                {busy ? "Salvando..." : editingMember ? "Salvar alterações" : "Cadastrar e gerar QR"}
              </button>
            </div>
          </div>
        </div>
      )}

      {activationUrl && (
        <div className="modal-overlay" onClick={() => setActivationUrl("")}>
          <div className="modal qr-modal waiter-activation-modal" role="dialog" aria-modal="true" aria-labelledby="waiter-qr-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setActivationUrl("")} aria-label="Fechar QR"><X size={20} /></button>
            <div className="modal-title">
              <span>ACESSO DO GARÇOM</span>
              <h2 id="waiter-qr-title">{activationName}</h2>
              <p>O garçom escaneia este QR, entra ou cria sua conta Servia e confirma o e-mail para vincular o acesso.</p>
            </div>
            <div className="qr-display"><QRCodeCanvas value={activationUrl} size={220} level="H" includeMargin /></div>
            <div className="activation-expiry">QR individual · requer conta Servia confirmada</div>
            <div className="qr-url">{activationUrl}</div>
            <button className="secondary-button activation-copy" type="button" onClick={() => void copyActivationUrl()}>
              {copied ? <Check size={18} /> : <Clipboard size={18} />}
              {copied ? "Link copiado" : "Copiar link do portal"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}