/**
 * Gera um token aleatório seguro para acesso a mesas via QR/NFC
 * Usa crypto.getRandomValues para garantir entropia criptográfica
 */
export function generateAccessToken(): string {
  const array = new Uint8Array(24); // 192 bits de entropia
  crypto.getRandomValues(array);
  
  // Converte para hex string
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Valida se um token tem o formato correto (48 caracteres hexadecimais)
 */
export function isValidAccessToken(token: string): boolean {
  return /^[0-9a-f]{48}$/.test(token);
}
