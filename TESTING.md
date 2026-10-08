# Homologação do Servia

Este roteiro valida os fluxos de restaurante ponta a ponta, com dados controlados. Execute em ambiente local/homologação ligado somente ao Firebase Emulator ou a um projeto Firebase explicitamente separado de produção. Não use dados, credenciais, chaves administrativas, restaurante ou pagamentos reais.

## Preparação do ambiente

- [ ] Confirme que o frontend e todas as APIs apontam para ambiente de teste/emulador; não basta usar uma conta de teste no projeto de produção.
- [ ] Inicie os emuladores Auth e Firestore conforme a configuração local do Firebase.
- [ ] Crie contas de teste separadas para administrador/gerente, caixa, garçom e cozinha; use QR de mesa para cliente.
- [ ] Prepare Mesa 01 e Mesa 02, produtos A (R$ 10), B (R$ 20) e C (R$ 30), além de um ingrediente com estoque inicial conhecido e ficha técnica de C.
- [ ] Abra o caixa com fundo de R$ 100. Registre IDs, valores iniciais e estado do estoque antes de começar.
- [ ] Use uma nova base/emulador limpo ou restaure o estado inicial entre execuções.

**Evidência por caso:** registre resultado (Aprovado/Reprovado/Bloqueado), ID do pedido/operação, valor esperado e observado, captura sem dados pessoais e erro de console/API, se houver. Não edite Firestore manualmente para fazer um caso passar.

## Matriz de execução

| ID | Fluxo | Ação e resultado esperado | Resultado | Evidência/ID |
|---|---|---|---|---|
| AUTH-01 | Autenticação | Login válido de cada papel entra no módulo permitido; logout encerra a sessão. | Pendente | |
| AUTH-02 | Autenticação | PIN inválido é recusado; testar repetição e confirmar limitação de tentativas quando aplicável. | Pendente | |
| AUTH-03 | Autorização | Garçom tenta abrir Gestão, Relatórios e Caixa por URL direta; acesso negado no servidor/API. | Pendente | |
| AUTH-04 | Autorização | Cozinha tenta abrir Caixa; acesso negado no servidor/API. | Pendente | |
| AUTH-05 | Isolamento | Usuário do restaurante A não consulta nem altera recursos do restaurante B. | Pendente | |
| CAT-01 | Cardápio | Consultar produtos A/B/C, conferir preço, disponibilidade e ficha técnica sem alterar dados alheios. | Pendente | |
| ORD-01 | Pedido cliente | No QR da Mesa 01, pedir A × 2, B × 1 e adicional de R$ 5, com observação. Total esperado: R$ 45; mesa, itens, quantidades e estado persistido corretos. | Pendente | |
| ORD-02 | Duplicidade | Toque duplo/retry no envio e atualização durante envio não criam pedidos/itens duplicados. | Pendente | |
| KIT-01 | Cozinha | Pedido aparece com mesa, itens, quantidades e observação; avançar novo → aceito → preparando → pronto e conferir cada estado persistido. | Pendente | |
| KIT-02 | Concorrência | Em duas sessões, tentar avançar simultaneamente o mesmo pedido; não deve haver transição inválida nem efeitos duplicados. | Pendente | |
| WAI-01 | Garçom | Cliente chama; garçom recebe, assume e conclui atendimento; chamada permanece consistente após recarregar. | Pendente | |
| WAI-02 | Conta | Cliente pede a conta e a solicitação fica visível ao papel autorizado; mesa mostra os pedidos do cliente. | Pendente | |
| CASH-01 | Caixa | Abrir com R$ 100; entrada R$ 20 e saída/sangria R$ 10. Dinheiro esperado: R$ 110. Conferir operador, horário e motivo. | Pendente | |
| PAY-01 | Pagamento dinheiro | Liquidar R$ 45 com R$ 50: troco R$ 5, receita R$ 45, pedido pago e mesa liberada conforme fluxo. | Pendente | |
| PAY-02 | Pagamento dividido | Pedido R$ 100: PIX 40 + dinheiro 30 + crédito 30 fecha; totais por meio e total geral correspondem. | Pendente | |
| PAY-03 | Validação | Para o mesmo pedido de R$ 100, combinações que somam R$ 90 ou R$ 110 são rejeitadas sem gravar pagamento. | Pendente | |
| PAY-04 | Duplicidade | Clique duplo/retry/duas sessões tentando pagar a mesma conta não gera cobrança/venda duplicada. | Pendente | |
| CAN-01 | Cancelamento parcial | Pedido A × 3; cancelar 1 unidade. Permanecem 2, receita reconhecida correspondente a R$ 20; conferir pedido, caixa, relatório e estoque. | Pendente | |
| CAN-02 | Cancelamento | Campos vazios, quantidade inválida, cancelamento não autorizado e repetição do cancelamento são recusados sem duplicar estorno. | Pendente | |
| TRF-01 | Transferência | Transferir comanda da Mesa 01 para a 02; conferir vínculo, ocupação das mesas e possibilidade de liquidar ao final. | Pendente | |
| STK-01 | Estoque | Para ingrediente inicial 10 e consumo 2 por unidade, aceitar A × 3 deve baixar 6 (saldo 4), se A possuir essa ficha técnica. Ajustar a expectativa à ficha cadastrada no ambiente. | Pendente | |
| STK-02 | Estorno de estoque | Cancelar antes do fechamento conforme regra de baixa ativa; estornar somente a quantidade cancelada, uma vez, com histórico. Saldo e ledger devem concordar. | Pendente | |
| REP-01 | Relatórios | Cenário: vendas R$ 100 + R$ 50; cancelamento R$ 20; despesa R$ 30 e estorno R$ 10. Conferir vendas brutas R$ 150, cancelamentos R$ 20, líquidas R$ 130 e despesa líquida R$ 20, conforme definições do relatório. | Pendente | |
| REP-02 | Pagamento parcial | Conferir que itens/quantidades pagos parcialmente não aparecem como integralmente pagos nem são contados duas vezes em vendas e meios de pagamento. | Pendente | |
| CLOSE-01 | Fechamento | Conferir total vendido, meios de pagamento, fundo, entradas, sangrias, cancelamentos, despesas e diferença entre dinheiro esperado e contado. | Pendente | |
| SEC-01 | Integridade | Como cliente, tentar alterar preço, restaurantId, mesaId, criar pagamento diretamente e modificar pedido já pago; API/regras devem rejeitar. | Pendente | |
| SEC-02 | PIN | PIN de gerente de outro restaurante/incorreto não autoriza desconto; conferir auditoria sem persistir o PIN. | Pendente | |
| CON-01 | Concorrência | Em duas sessões, tentar simultaneamente pagamento, cancelamento, transferência e fechamento do caixa; no máximo uma operação válida e sem efeitos parciais/duplicados. | Pendente | |

## Cálculos de conferência

- Pedido principal: A × 2 = R$ 20; B × 1 = R$ 20; adicional = R$ 5; total = R$ 45.
- Dinheiro: recebido R$ 50 − total R$ 45 = troco R$ 5. O troco não aumenta a receita.
- Dividido: R$ 40 + R$ 30 + R$ 30 = R$ 100. Divergências de R$ 10 para menos ou para mais devem bloquear o fechamento.
- Cancelamento: 3 unidades − 1 cancelada = 2 unidades válidas; a receita corresponde às duas restantes.
- Exemplo de relatório: R$ 150 brutos − R$ 20 cancelados = R$ 130 líquidos; R$ 30 de despesa − R$ 10 de estorno = R$ 20 líquidos.

## Encerramento e diagnóstico

- [ ] Confira no Firestore Emulator e nas respostas da API os documentos gravados e recuperados, sem gravar dados de produção.
- [ ] Registre erros do console, respostas de API e falhas de permissão com IDs de teste; nunca copie tokens, PINs ou chaves para evidências.
- [ ] Se um teste falhar, preserve o estado e a evidência antes de repetir; anote o resultado como reprovado, não apague o erro.
- [ ] Limpe somente a base/emulador de teste ao finalizar.

## Validações automatizadas disponíveis

    npm run test:unit
    npx firebase-tools emulators:exec --only firestore --project demo-servia-rules "npm run test:rules"
    npm run lint
    npm run build

Os testes acima são unitários/de regras e build; não substituem a execução desta matriz autenticada no navegador. O repositório não inclui atualmente configuração/dependência Playwright nem contas de homologação. A automação de navegador só deve ser adicionada quando existir ambiente Firebase isolado e contas de teste apropriadas; jamais use produção para preencher essa lacuna.
