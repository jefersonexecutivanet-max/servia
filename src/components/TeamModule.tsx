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
import { httpsCallable } from "firebase/functions";
import {
  collection,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db, functions } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";
import { normalizeStaffRole, STAFF_ROLE_LABELS, type StaffRole } from "../types/roles";

interface TeamMember {
  id: string;
  name: string;
  role: string;
  employeeNumber: string;
  employeeCode: string;
  pinEnabled: boolean;
  status: "ativo" | "inativo";
  uid: string;
  email: string;
  mustChangePassword: boolean;
  hireDate?: Date;
}

type WaiterForm = Pick<TeamMember, "name" | "role"> & { pin: string };

const employeeRoles = Object.entries(STAFF_ROLE_LABELS) as [StaffRole, string][];

function convertMember(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): TeamMember {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: String(data.name || "Funcionário"),
    role: normalizeStaffRole(data.role),
    employeeNumber: String(data.employeeNumber || ""),
    employeeCode: String(data.employeeCode || data.employeeNumber || ""),
    pinEnabled: data.pinEnabled === true,
    status: data.active === false ? "inativo" : "ativo",
    uid: String(data.uid || ""),
    email: String(data.email || ""),
    mustChangePassword: data.mustChangePassword === true,
    hireDate:
      data.createdAt?.toDate instanceof Function
        ? data.createdAt.toDate()
        : undefined,
  };
}

const emptyForm: WaiterForm = {
  name: "",
  role: "WAITER",
  pin: "",
};

export default function TeamModule({ readOnly = false }: { readOnly?: boolean }) {
  const { restaurantId } = useRestaurantScope();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [formData, setFormData] = useState<WaiterForm>(emptyForm);
  const [activationUrl, setActivationUrl] = useState("");
  const [activationName, setActivationName] = useState("");
  const [activationEmail, setActivationEmail] = useState("");
  const [activationEmployeeCode, setActivationEmployeeCode] = useState("");
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
        console.error("Erro ao carregar funcionários:", snapshotError);
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
  const pendingAccess = activeMembers.filter((member) => member.mustChangePassword || !member.uid).length;

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
      pin: "",
    });
    setError("");
    setShowModal(true);
  }

  function showActivation(memberName: string, waiterId: string, memberEmail = "", employeeCode = "") {
    const url = new URL(`/garcom/${encodeURIComponent(restaurantId)}/${encodeURIComponent(waiterId)}`, window.location.origin);
    if (memberEmail) url.searchParams.set("email", memberEmail);
    setActivationName(memberName);
    setActivationEmail(memberEmail);
    setActivationEmployeeCode(employeeCode);
    setActivationUrl(url.toString());
    setCopied(false);
  }

  async function handleSaveMember() {
    if (!formData.name.trim() || busy) return;
    if (!editingMember && !/^\d{6,8}$/.test(formData.pin)) {
      setError("Defina um PIN inicial de 6 a 8 números.");
      return;
    }
    if (formData.pin && !/^\d{6,8}$/.test(formData.pin)) {
      setError("O PIN deve ter de 6 a 8 números.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (editingMember) {
        const updateEmployee = httpsCallable(functions, "updateEmployee");
        await updateEmployee({
          restaurantId,
          employeeId: editingMember.id,
          name: formData.name.trim(),
          role: normalizeStaffRole(formData.role),
          active: editingMember.status === "ativo",
          pin: formData.pin,
        });
        setNotice(formData.pin ? "Cadastro e PIN do funcionário atualizados." : "Cadastro do funcionário atualizado.");
      } else {
        const createEmployee = httpsCallable<{
          restaurantId: string; name: string; role: StaffRole; pin: string;
        }, { id: string; employeeCode: string }>(functions, "createEmployee");
        const result = await createEmployee({
          restaurantId,
          name: formData.name.trim(),
          role: normalizeStaffRole(formData.role),
          pin: formData.pin,
        });
        showActivation(formData.name.trim(), result.data.id, "", result.data.employeeCode);
      }
      setShowModal(false);
    } catch (saveError) {
      console.error("Erro ao salvar funcionário:", saveError);
      setError(saveError instanceof Error ? saveError.message : "Não foi poss?vel salvar o cadastro.");
    } finally {
      setBusy(false);
    }
  }

  function handleGenerateQr(member: TeamMember) {
    showActivation(member.name, member.id, member.pinEnabled ? "" : member.email, member.employeeCode || member.employeeNumber);
  }

  async function handleDeleteMember(member: TeamMember) {
    if (!window.confirm(`Remover o acesso de ${member.name}?`)) return;
    setBusy(true);
    setError("");
    try {
      const deleteEmployee = httpsCallable(functions, "deleteEmployee");
      await deleteEmployee({ restaurantId, employeeId: member.id });
      setNotice("Acesso do funcionário removido.");
    } catch (deleteError) {
      console.error("Erro ao remover funcionário:", deleteError);
      setError("Não foi poss?vel remover este funcionário.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(member: TeamMember) {
    setBusy(true);
    setError("");
    try {
      const active = member.status !== "ativo";
      const updateEmployee = httpsCallable(functions, "updateEmployee");
      await updateEmployee({ restaurantId, employeeId: member.id, active });
      setNotice(member.status === "ativo" ? "Acesso desativado." : "Acesso ativado.");
    } catch (statusError) {
      console.error("Erro ao alterar acesso:", statusError);
      setError("Não foi poss?vel alterar o acesso deste funcionário.");
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
          <h1>Funcionários</h1>
          <p>Cadastre acessos e gerencie o atendimento do salão.</p>
        </div>
        {!readOnly && <button className="primary-button" type="button" onClick={handleAddMember}>
          <Plus size={18} />
          Cadastrar funcionário
        </button>}
      </div>

      {error && <div className="team-feedback error" role="alert">{error}</div>}
      {notice && <div className="team-feedback" role="status">{notice}</div>}

      <div className="team-dashboard">
        <div className="stat-card">
          <div className="stat-icon"><Users size={24} /></div>
          <div><span>Funcionários ativos</span><strong>{activeMembers.length}</strong></div>
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
            placeholder="Buscar funcionário..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="team-empty">Carregando equipe...</div>
      ) : filteredMembers.length === 0 ? (
        <div className="team-empty">
          {searchTerm ? "Nenhum funcionário encontrado." : "Cadastre o primeiro funcionário para gerar o QR de acesso."}
        </div>
      ) : (
        <div className="team-grid">
          {filteredMembers.map((member) => (
            <article key={member.id} className={`team-card ${member.status === "inativo" ? "inactive" : ""}`}>
              <div className="team-card-header">
                <div className="team-avatar"><span>🍽️</span></div>
                {!readOnly && <div className="team-actions">
                  <button type="button" onClick={() => handleGenerateQr(member)} title="Mostrar QR de acesso" disabled={busy || member.status !== "ativo"}>
                    <QrCode size={16} />
                  </button>
                  <button type="button" onClick={() => handleEditMember(member)} title="Editar cadastro" disabled={busy}>
                    <Edit size={16} />
                  </button>
                  <button type="button" onClick={() => void handleDeleteMember(member)} title="Remover acesso" disabled={busy}>
                    <Trash2 size={16} />
                  </button>
                </div>}
              </div>
              <div className="team-card-body">
                <h3>{member.name}</h3>
                <span className="role-badge">{STAFF_ROLE_LABELS[normalizeStaffRole(member.role)]}</span>
                <div className="team-details">
                  <div><span>Número de cadastro</span><strong>{(member.employeeCode || member.employeeNumber || "-")}</strong></div>
                  <div><span>Acesso ao sistema</span><strong>{member.mustChangePassword ? "Senha temporária" : member.uid ? "Ativo" : "Pendente"}</strong></div>
                  <div><span>Cadastro</span><strong>{member.hireDate?.toLocaleDateString("pt-BR") || "-"}</strong></div>
                </div>
              </div>
              <div className="team-card-footer">
                <div className={`status-badge ${member.status}`}>{member.status === "ativo" ? "Ativo" : "Inativo"}</div>
                {!readOnly && <button type="button" className="toggle-status-button" onClick={() => void toggleStatus(member)} disabled={busy}>
                  {member.status === "ativo" ? "Desativar acesso" : "Ativar acesso"}
                </button>}
              </div>
            </article>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="waiter-form-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2 id="waiter-form-title">{editingMember ? "Editar funcionário" : "Cadastrar funcionário"}</h2>
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
                  {employeeRoles.map(([role, label]) => <option key={role} value={role}>{label}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="waiter-pin">PIN de acesso {editingMember ? "(opcional para manter o atual)" : "(6 a 8 números)"}</label>
                <input id="waiter-pin" type="password" inputMode="numeric" autoComplete="new-password" value={formData.pin} onChange={(event) => setFormData({ ...formData, pin: event.target.value })} required={!editingMember} minLength={6} maxLength={8} pattern="[0-9]{6,8}" />
              </div>
              {error && <div className="team-feedback error" role="alert">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="secondary-button" type="button" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="primary-button" type="button" onClick={() => void handleSaveMember()} disabled={busy || !formData.name.trim() || (!editingMember && !/^\d{6,8}$/.test(formData.pin))}>
                {busy ? "Salvando..." : editingMember?.uid ? "Salvar alterações" : "Criar acesso e gerar QR"}
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
              <span>ACESSO DO FUNCIONÁRIO</span>
              <h2 id="waiter-qr-title">{activationName}</h2>
              <p>Use o QR para identificar o funcionário. Ele informa o PIN definido para entrar.</p>
            </div>
            <div className="qr-display"><QRCodeCanvas value={activationUrl} size={220} level="H" includeMargin /></div>
            <div className="activation-expiry">ID do funcionário: <strong>{activationEmployeeCode || activationEmail}</strong></div>
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
