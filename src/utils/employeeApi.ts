import { auth } from "../firebase";

export async function employeeApi<T = unknown>(endpoint: string, payload: unknown, authenticated = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authenticated) {
    const user = auth.currentUser;
    if (!user) throw Object.assign(new Error("Entre na sua conta para continuar."), { code: "unauthenticated" });
    headers.Authorization = `Bearer ${await user.getIdToken()}`;
  }

  let response: Response;
  try {
    response = await fetch(`/api/employees/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    throw Object.assign(new Error("Não foi possível conectar ao servidor do Servia."), { code: "unavailable" });
  }

  const result = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string; code?: string } };
  if (!response.ok) {
    throw Object.assign(new Error(result.error?.message || "Não foi possível concluir a operação."), {
      code: result.error?.code || "internal",
    });
  }
  return result.data as T;
}
