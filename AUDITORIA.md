# Relatório de Auditoria - Servia

Data: 2026-10-07
Status: Auditoria Inicial

---

## ETAPA 1: AUDITORIA DO PROJETO

### Estrutura do Projeto

**Frontend:**
- React 19 + TypeScript + Vite
- Firebase Authentication (e-mail/senha, anônimo)
- Firestore (banco de dados)
- PWA com vite-plugin-pwa
- Lucide React (ícones)
- QR Code (qrcode.react)

**Backend:**
- Firestore Security Rules (validação no banco)
- Vercel Serverless Functions (API de PIN - não implementada ainda)
- Firebase Admin SDK (em scripts, server-side)

**Coleções Firestore:**
- restaurants
- menuItems
- tables
- orders
- tableCalls
- billRequests
- payments
- tableReleases
- waiters
- waiterDirectory
- waiterTables
- restaurantStaff
- cashTransactions
- stock
- employeeSecrets (server-only)
- employeeCodes (server-only)
- employeeLoginLimits (server-only)
- employeeAudit (server-only)

---

## PROBLEMAS CRÍTICOS ENCONTRADOS

### 1. ⚠️ SEGURANÇA DE PREÇOS - RISCO ALTO

**Arquivo:** `src/components/CustomerTable.tsx`

**Problema:**
O preço é calculado no frontend usando dados do catálogo, mas não há validação no servidor de que o preço enviado corresponde ao preço oficial do produto.

```typescript
// Linha 280-289: O preço é calculado no cliente
const orderItems = cartItems.map((item) => ({
  productId: item.product.id,
  name: item.product.name,
  quantity: item.quantity,
  price: itemPrice(item),  // ← Preço calculado no cliente
  extras: item.product.extras
    .filter((extra) => item.extraIds.includes(extra.id))
    .map((extra) => extra.name),
  notes: item.notes,
}));
```

**Risco:** Um cliente malicioso pode:
- Modificar o JavaScript no navegador
- Interceptar a requisição e alterar `item.price`
- Enviar `price: 0.01` para um produto que custa R$ 35,00

**Validação nas Rules (Linha 224):**
```javascript
&& math.abs(data.total - orderItemsTotal(data.items)) < 0.01
```
A regra valida que `total` corresponde à soma dos `items`, mas **não valida que `item.price` corresponde ao preço oficial do produto no banco**.

**Recomendação:** 
- Opção Spark: Validar cada `item.price` contra o preço em `menuItems/{productId}` nas rules
- Opção Blaze: Cloud Function que lê os preços do servidor e ignora o preço enviado

---

### 2. ⚠️ SEGURANÇA DE PAGAMENTOS - RISCO MÉDIO

**Arquivo:** `src/components/CashModule.tsx`

**Problema:**
As transações de caixa podem ser criadas com qualquer valor, não há vínculo obrigatório com pedidos reais.

```typescript
// Linha 89-100: Qualquer valor pode ser informado
const handleAddTransaction = () => {
  setFormData({
    type: "entrada",
    category: "",
    description: "",
    amount: 0,  // ← Valor arbitrário
    paymentMethod: "dinheiro",
    reference: "",
  });
  setShowModal(true);
};
```

**Validação nas Rules (Linha 482-498):**
```javascript
match /cashTransactions/{transactionId} {
  allow create: if (isOwner() || isActiveRestaurantOwner(resource.data.restaurantId) || isCashier(resource.data.restaurantId))
    && request.resource.data.keys().hasOnly(['restaurantId', 'type', 'category', 'description', 'amount', 'paymentMethod', 'reference', 'createdAt', 'createdBy'])
    && ...
    && request.resource.data.amount is number && request.resource.data.amount > 0
```
A validação é apenas de tipo (`number > 0`), não há verificação se o valor corresponde a uma operação real.

**Recomendação:**
- Para transações manuais, manter como está (caixa precisa ter flexibilidade)
- Para pagamentos vinculados a pedidos, exigir referência ao pedido e validar o valor

---

### 3. ⚠️ VALIDAÇÃO DE TOTAIS - RISCO MÉDIO

**Arquivo:** `src/components/CustomerTable.tsx`

**Problema:**
O total é calculado apenas no frontend e enviado ao banco. Embora as rules validem a consistência interna, o backend não recalcula para garantir que está correto.

```typescript
// Linha 293: Total calculado no cliente
const orderTotal = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
```

**Validação nas Rules (Linha 224):**
```javascript
&& math.abs(data.total - orderItemsTotal(data.items)) < 0.01
```
A regra valida a consistência, mas não garante que os preços são os oficiais.

**Recomendação:**
- No lado do leitor (Cozinha, Caixa, Mesas, Relatórios), SEMPRE recalcular o total a partir de `items` e ignorar `order.total` gravado
- No fechamento, o caixa deve ver alerta se o total gravado divergir do recalculado

---

### 4. ⚠️ NÚMEROS DE PONTO FLUTUANTE - RISCO BAIXO

**Problema:**
Todos os valores financeiros usam `number` (ponto flutuante), o que pode causar erros de precisão em cálculos financeiros.

```typescript
// Exemplo em vários arquivos
amount: number;  // float point
price: number;   // float point
total: number;   // float point
```

**Risco:** `0.1 + 0.2 = 0.30000000000000004`

**Recomendação:**
- Para valores financeiros críticos, usar centavos inteiros (R$ 35,90 → 3590)
- Criar funções utilitárias: `moneyToCents()`, `centsToMoney()`, `safeAdd()`, `safeSubtract()`

---

### 5. ✅ CÁLCULO DE PREÇO NO CLIENTE - ACEITÁVEL (mas precisa de validação no servidor)

**Arquivo:** `src/components/CustomerTable.tsx`

**Status:** O cálculo está correto do ponto de vista lógico:

```typescript
// Linha 47-53
function itemPrice(item: CartItem) {
  const extrasTotal = item.product.extras
    .filter((extra) => item.extraIds.includes(extra.id))
    .reduce((sum, extra) => sum + extra.price, 0);

  return item.product.price + extrasTotal;
}
```

O preço do produto + preço dos extras está correto. O problema é que esses valores podem ser adulterados antes de enviar.

---

### 6. ✅ RBAC - BEM IMPLEMENTADO NAS RULES

**Arquivo:** `firestore.rules`

**Status:** As rules têm um sistema RBAC bem estruturado:

Funções de verificação:
- `isOwner()` - Proprietário do sistema
- `isActiveRestaurantOwner()` - Dono de restaurante ativo
- `restaurantIsActive()` - Verifica se restaurante está ativo e pago
- `isActiveTeamMemberForRestaurant()` - Membro da equipe ativo
- `isStaffRoleForRestaurant()` - Papel específico da equipe
- `isRestaurantManager()` - Gerente
- `isFloorManager()` - Chefe de salão
- `isCashier()` - Caixa
- `isKitchen()` - Cozinha

**Observação:** As regras exigem que o restaurante esteja ativo e com pagamento em dia para operações operacionais.

**Recomendação:** 
- Continuar usando as rules como principal camada de segurança
- Validar que o frontend respeita essas permissões (não apenas esconder botões)

---

### 7. ✅ VALIDAÇÃO DE TOKEN DE MESA - BEM IMPLEMENTADO

**Arquivo:** `firestore.rules`

**Status:** A validação de token está implementada:

```javascript
// Linha 232
&& (!('accessToken' in get(tablePath).data) || (('accessToken' in data) && data.accessToken == get(tablePath).data.accessToken))
```

Mesas sem token continuam funcionando (compatibilidade), mas mesas com token exigem token correto.

**Recomendação:** Documentar no README que tokens devem ser rotacionados periodicamente por segurança.

---

### 8. ✅ LIMITE DE FREQUÊNCIA - BEM IMPLEMENTADO

**Arquivo:** `firestore.rules`

**Status:** Existe limite de 30 segundos entre pedidos da mesma mesa:

```javascript
// Linha 229-231
&& (!('lastOrderAt' in get(tablePath).data)
  || request.time >= get(tablePath).data.lastOrderAt + duration.value(30, 's'))
&& getAfter(tablePath).data.lastOrderAt == request.time
```

Chamados têm ID determinístico, impedindo duplicatas:

```javascript
// Linha 504-505
&& callId == request.resource.data.tableId + '_waiter'
&& !exists(/databases/$(database)/documents/tableCalls/$(callId))
```

**Recomendação:** 
- Considerar tornar o limite configurável por restaurante
- Adicionar rate-limiting por cliente para evitar spam de pedidos

---

### 9. ✅ IMPRESSÃO COM CLAIM - BEM IMPLEMENTADO

**Arquivo:** `firestore.rules`

**Status:** Existe sistema de claim para evitar impressão duplicada:

```javascript
// Linha 113-119
function validOrderPrintClaim() {
  return (isKitchen(resource.data.restaurantId) || isRestaurantManager(resource.data.restaurantId))
    && !('printedAt' in resource.data)
    && request.resource.data.printedAt is timestamp
    && request.resource.data.printedBy == request.auth.uid
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['printedAt', 'printedBy']);
}
```

**Recomendação:** Implementar no frontend para que pedidos sem `printedAt` sejam impressos automaticamente ao abrir a cozinha.

---

### 10. ✅ ESTORNOS COM HISTÓRICO - BEM IMPLEMENTADO

**Arquivo:** `firestore.rules`

**Status:** Estornos exigem referência ao documento original:

```javascript
// Linha 487-494
|| (request.resource.data.type == 'estorno' && request.resource.data.reference is string
  && request.resource.data.createdBy == request.auth.uid
  && transactionId == 'estorno_' + request.resource.data.reference
  && exists(/databases/$(database)/documents/cashTransactions/$(request.resource.data.reference))
  && get(/databases/$(database)/documents/cashTransactions/$(request.resource.data.reference)).data.restaurantId == request.resource.data.restaurantId
  && get(/databases/$(database)/documents/cashTransactions/$(request.resource.data.reference)).data.type in ['entrada', 'saida']
  && get(/databases/$(database)/documents/cashTransactions/$(request.resource.data.reference)).data.amount == request.resource.data.amount)
```

**Recomendação:** Adicionar campo `reason` para justificativa do estorno.

---

### 11. ✅ ISOLAMENTO MULTI-TENANT - BEM IMPLEMENTADO

**Arquivo:** `firestore.rules`

**Status:** Todas as operações validam `restaurantId`:

```javascript
// Exemplo em várias regras
&& data.restaurantId is string
&& exists(tablePath)
&& get(tablePath).data.restaurantId == data.restaurantId
```

**Recomendação:** Validar que o frontend sempre inclui `restaurantId` em todas as queries.

---

### 12. ⚠️ OFFLINE/SINCRONIZAÇÃO - NÃO IMPLEMENTADO

**Problema:** Não há fila de operações offline nem idempotência implementada no frontend.

**Risco:** Se a internet cair durante um pedido, o cliente pode tentar reenviar e criar pedidos duplicados.

**Recomendação:**
- Implementar IndexedDB para fila de operações offline
- Adicionar `clientRequestId` para idempotência
- Validar no backend para evitar duplicatas

---

### 13. ⚠️ ESTOQUE SEM INTEGRAÇÃO COM VENDAS

**Arquivo:** `src/components/StockModule.tsx`

**Problema:** O módulo de estoque existe, mas não há integração automática com vendas. Não há ficha técnica/ingredientes.

**Recomendação:**
- Criar estrutura de ficha técnica em `menuItems`
- Implementar baixa automática de estoque ao vender
- Adicionar histórico de movimentações de estoque

---

### 14. ✅ AUDITORIA - PARCIALMENTE IMPLEMENTADA

**Arquivo:** `firestore.rules`

**Status:** Existe coleção `employeeAudit` para auditoria, mas é server-only:

```javascript
// Linha 166-168
match /employeeAudit/{auditId} {
  allow read, write: if false;
}
```

**Problema:** Não há auditoria de operações críticas no frontend (criação de pedido, pagamento, etc.).

**Recomendação:**
- Implementar auditoria no Firestore para operações críticas
- Registrar: criação de pedido, pagamento, estorno, alteração de preço, etc.

---

### 15. ✅ DADOS FICTÍCIOS - REMOVIDOS (FASE 1)

**Status:** A FASE 1 removeu todos os dados fictícios do sistema. O dashboard inicia zerado.

**Validação:** Verificado que não há mais arrays mock ou valores hardcoded nos componentes principais.

---

### 16. ✅ ENCODING - CORRIGIDO (FASE 1)

**Status:** Problemas de mojibake foram corrigidos em:
- `src/components/WaiterModule.tsx`
- `tests/firestore-rules.test.mjs`

Arquivos normalizados para UTF-8 com fim de linha LF.

---

### 17. ✅ CREDENCIAIS EXPOSTAS - REMOVIDAS (FASE 1)

**Status:** 
- `.env` removido do git
- UID, e-mail do dono e chave Pix movidos para variáveis de ambiente
- `.gitignore` atualizado
- `.env.example` criado

**Observação:** O README ainda contém o UID do owner (`KVoJiEGKnnceyADEqFhcflynohr2`). Isso é aceitável para documentação, mas não deve estar no código frontend.

---

### 18. ⚠️ IMPRESSÃO - DIÁLOGO DO NAVEGADOR

**Arquivo:** `src/utils/printer.ts`

**Status:** A impressão usa `window.print()`, que abre o diálogo do navegador. Não há impressão automática em impressoras térmicas.

**Recomendação:**
- Documentar claramente que impressão automática requer configuração de quiosque do navegador
- Preparar arquitetura para integração futura com Web Serial/WebUSB
- Não prometer impressão automática sem implementação

---

### 19. ✅ DASHBOARD COM DADOS REAIS

**Status:** O dashboard carrega dados reais do Firestore e inicia zerado quando não há movimentação.

**Validação:** Verificado em `src/App.tsx` que não há mais valores fictícios.

---

### 20. ⚠️ TESTES - PARCIAIS

**Status:** Existem testes de regras do Firestore em `tests/firestore-rules.test.mjs`, mas:
- Não há testes unitários de cálculos (total de pedido, preço de item, etc.)
- Não há testes de integração de fluxo completo
- Os testes de regras requerem emulador rodando

**Recomendação:**
- Adicionar testes unitários para cálculos financeiros
- Adicionar testes para funções utilitárias
- Documentar como rodar os testes de regras

---

## RESUMO DOS PROBLEMAS POR SEVERIDADE

### CRÍTICO (requer correção imediata)
1. **Segurança de preços** - Preço calculado no cliente pode ser adulterado

### ALTO (requer correção antes de produção)
2. **Segurança de pagamentos** - Valores arbitrários podem ser informados
3. **Validação de totais** - Backend não recalcula para garantir integridade

### MÉDIO (deve ser corrigido)
4. **Números de ponto flutuante** - Risco de precisão em cálculos financeiros
5. **Offline/sincronização** - Não implementado
6. **Estoque sem integração** - Não baixa automaticamente
7. **Auditoria parcial** - Apenas server-side para PIN

### BAIXO (pode ser adiado)
8. **Testes parciais** - Falta cobertura de testes unitários
9. **Impressão** - Apenas diálogo do navegador

---

## PRÓXIMOS PASSOS SUGERIDOS

### ETAPA 2: Segurança de Pedidos e Preços
1. Validar preço de cada item contra `menuItems/{productId}` nas rules
2. No leitor, sempre recalcular total a partir de `items`
3. Alertar se total gravado divergir do recalculado

### ETAPA 3: Segurança de Pagamentos e Caixa
1. Para pagamentos vinculados a pedidos, exigir referência
2. Validar valor contra total dos pedidos
3. Manter flexibilidade para transações manuais

### ETAPA 4: RBAC e Isolamento Multi-tenant
1. Validar que frontend respeita permissões
2. Testar cenários de ataque entre restaurantes

### ETAPA 5: Offline/Idempotência
1. Implementar IndexedDB para fila offline
2. Adicionar `clientRequestId` para idempotência
3. Validar no backend

### ETAPA 6: Estoque e Auditoria
1. Implementar ficha técnica em menuItems
2. Baixa automática de estoque
3. Auditoria de operações críticas

### ETAPA 7: Impressão
1. Documentar limitações atuais
2. Preparar arquitetura para Web Serial/WebUSB

### ETAPA 8: Encoding e UX
1. Já corrigido na FASE 1
2. Validar que não há mais mojibake

### ETAPA 9: Testes
1. Adicionar testes unitários de cálculos
2. Adicionar testes de integração
3. Documentar como rodar testes

### ETAPA 10: Build Final
1. Executar build completo
2. Validar que não há erros
3. Preparar para deploy em produção

---

## DECISÕES QUE DEPENDEM DO USUÁRIO

1. **Plano Firebase (Spark vs Blaze):**
   - Spark: Validação de preços nas rules (opção mais fraca)
   - Blaze: Cloud Function para cálculo no servidor (opção mais sólida)

2. **Impressão automática:**
   - Implementar impressão automática via Web Serial/WebUSB?
   - Depender de configuração de quiosque do navegador?

3. **Estoque:**
   - Implementar ficha técnica completa?
   - Baixa automática obrigatória ou opcional?

4. **Offline:**
   - Prioridade alta ou pode ser adiado?

---

## STATUS ATUAL

- **Build:** ✅ Passando
- **Lint:** ✅ Passando (19 warnings, 0 erros)
- **TypeScript:** ✅ Passando
- **Testes de regras:** ⚠️ Falhando (emulador não está rodando)
- **Dados fictícios:** ✅ Removidos
- **Encoding:** ✅ Corrigido
- **Credenciais:** ✅ Protegidas
