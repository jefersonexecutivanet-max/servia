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
import { createUserWithEmailAndPassword, deleteUser, signOut } from "firebase/auth";
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
import { db, restaurantProvisioningAuth } from "../firebase";
import { useRestaurantScope } from "../contexts/RestaurantContext";

interface TeamMember {
  id: string;
  name: string;
  role: string;
  employeeNumber: string;
  status: "ativo" | "inativo";
  uid: string;
  email: string;
  mustChangePassword: boolean;
  hireDate?: Date;
}

type WaiterForm = Pick<TeamMember, "name" | "role" | "employeeNumber" | "email"> & { temporaryPassword: string };

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
  role: waiterRoles[0],
  employeeNumber: "",
  email: "",
  temporaryPassword: "",
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
  const [activationEmail, setActivationEmail] = useState("");
  const [activationTemporaryPassword, setActivationTemporaryPassword] = useState("");
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

  useEffect(() => {
    if (!restaurantId || members.length === 0) {
      return;
    }

    const batch = writeBatch(db);
    let linkedAccounts = 0;
    members.forEach((member) => {
      if (!member.uid) return;
      batch.set(doc(db, "restaurantStaff", member.uid), {
        restaurantId,
        waiterId: member.id,
        active: member.status === "ativo",
      });
      linkedAccounts += 1;
    });
    if (linkedAccounts > 0) {
      void batch.commit().catch((syncError) => {
        console.error("Erro ao sincronizar acesso da equipe:", syncError);
      });
    }
  }, [members, restaurantId]);

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
      employeeNumber: member.employeeNumber,
      email: member.email,
      temporaryPassword: "",
    });
    setError("");
    setShowModal(true);
  }

  function showActivation(memberName: string, waiterId: string, memberEmail: string, temporaryPassword = "") {
    const url = new URL(`/garcom/${encodeURIComponent(restaurantId)}/${encodeURIComponent(waiterId)}`, window.location.origin);
    url.searchParams.set("email", memberEmail);
    setActivationName(memberName);
    setActivationEmail(memberEmail);
    setActivationTemporaryPassword(temporaryPassword);
    setActivationUrl(url.toString());
    setCopied(false);
  }

  async function handleSaveMember() {
    if (!formData.name.trim() || !formData.employeeNumber.trim() || busy) {
      return;
    }
    const creatingAccount = !editingMember || !editingMember.uid;
    if (creatingAccount && (!formData.email.trim() || formData.temporaryPassword.length < 6)) {
      setError("Informe o e-mail do membro e uma senha temporária com pelo menos 6 caracteres.");
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

      if (editingMember && !creatingAccount) {
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
        const normalizedEmail = formData.email.trim().toLowerCase();
        await signOut(restaurantProvisioningAuth).catch(() => undefined);
        const createdAccount = await createUserWithEmailAndPassword(
          restaurantProvisioningAuth,
          normalizedEmail,
          formData.temporaryPassword,
        );
        const waiterRef = editingMember
          ? doc(db, "waiters", editingMember.id)
          : doc(collection(db, "waiters"));
        const batch = writeBatch(db);
        const accountFields = {
          name: formData.name.trim(),
          role: formData.role,
          employeeNumber: normalizedNumber,
          restaurantId,
          email: normalizedEmail,
          uid: createdAccount.user.uid,
          mustChangePassword: true,
          active: editingMember ? editingMember.status === "ativo" : true,
        };
        if (editingMember) {
          batch.update(waiterRef, accountFields);
        } else {
          batch.set(waiterRef, { ...accountFields, createdAt: serverTimestamp() });
        }
        batch.set(doc(db, "waiterDirectory", waiterRef.id), {
          restaurantId,
          name: formData.name.trim(),
          role: formData.role,
          active: editingMember ? editingMember.status === "ativo" : true,
        });
        batch.set(doc(db, "restaurantStaff", createdAccount.user.uid), {
          restaurantId,
          waiterId: waiterRef.id,
          active: editingMember ? editingMember.status === "ativo" : true,
        });
        try {
          await batch.commit();
        } catch (saveError) {
          await deleteUser(createdAccount.user).catch(() => undefined);
          throw saveError;
        } finally {
          await signOut(restaurantProvisioningAuth).catch(() => undefined);
        }
        showActivation(formData.name, waiterRef.id, normalizedEmail, formData.temporaryPassword);
      }
      setShowModal(false);
    } catch (saveError) {
      console.error("Erro ao salvar garçom:", saveError);
      const code = typeof saveError === "object" && saveError && "code" in saveError
        ? String((saveError as { code: string }).code)
        : "";
      setError(code === "auth/email-already-in-use"
        ? "Este e-mail já possui uma conta no Firebase. Use outro e-mail para este membro."
        : code === "auth/invalid-email"
          ? "Informe um e-mail válido."
          : code === "auth/weak-password"
            ? "A senha temporária precisa ter pelo menos 6 caracteres."
            : saveError instanceof Error ? saveError.message : "Não foi possível salvar o cadastro.");
    } finally {
      setBusy(false);
    }
  }

  function handleGenerateQr(member: TeamMember) {
    if (!member.email) {
      setEditingMember(member);
      setFormData({
        name: member.name,
        role: member.role,
        employeeNumber: member.employeeNumber,
        email: "",
        temporaryPassword: "",
      });
      setError("Defina o e-mail e a senha temporária deste membro para gerar o novo QR.");
      setShowModal(true);
      return;
    }
    showActivation(member.name, member.id, member.email);
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
      if (member.uid) batch.delete(doc(db, "restaurantStaff", member.uid));
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
      if (member.uid) {
        batch.set(doc(db, "restaurantStaff", member.uid), {
          restaurantId,
          waiterId: member.id,
          active,
        });
      }
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
                  <div><span>Acesso ao sistema</span><strong>{member.mustChangePassword ? "Senha temporária" : member.uid ? "Ativo" : "Pendente"}</strong></div>
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
              {(!editingMember || !editingMember.uid) && (
                <>
                  <div className="form-field">
                    <label htmlFor="waiter-email">E-mail de acesso</label>
                    <input id="waiter-email" type="email" autoComplete="off" value={formData.email} onChange={(event) => setFormData({ ...formData, email: event.target.value })} required />
                  </div>
                  <div className="form-field">
                    <label htmlFor="waiter-temp-password">Senha temporária (mínimo 6 caracteres)</label>
                    <input id="waiter-temp-password" type="password" autoComplete="new-password" value={formData.temporaryPassword} onChange={(event) => setFormData({ ...formData, temporaryPassword: event.target.value })} required minLength={6} />
                  </div>
                </>
              )}
              {error && <div className="team-feedback error" role="alert">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="secondary-button" type="button" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="primary-button" type="button" onClick={() => void handleSaveMember()} disabled={busy || !formData.name.trim() || !formData.employeeNumber.trim() || ((!editingMember || !editingMember.uid) && (!formData.email.trim() || formData.temporaryPassword.length < 6))}>
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
              <span>ACESSO DO GARÇOM</span>
              <h2 id="waiter-qr-title">{activationName}</h2>
              <p>Entregue o QR e a senha temporária ao membro. Ao entrar, ele será solicitado a criar uma senha pessoal.</p>
            </div>
            <div className="qr-display"><QRCodeCanvas value={activationUrl} size={220} level="H" includeMargin /></div>
            <div className="activation-expiry">QR individual para a conta de {activationEmail}</div>
            {activationTemporaryPassword && (
              <div className="activation-credentials">
                <span>E-mail: <strong>{activationEmail}</strong></span>
                <span>Senha temporária: <strong>{activationTemporaryPassword}</strong></span>
              </div>
            )}
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
