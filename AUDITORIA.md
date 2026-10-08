# Auditoria operacional do Servia

**Atualização:** 8 de outubro de 2026
**Situação:** em homologação; ainda não certificado para operação real.

## Escopo e segurança dos testes

A validação foi feita exclusivamente com os emuladores Firebase e contas/documentos sintéticos em projetos `demo-servia-rules` e `demo-servia-integration`. Não foram lidos nem gravados dados de produção, e nenhuma credencial de produção foi usada.

## Correções aplicadas

- APIs administrativas para abertura, movimentações, estornos e fechamento do caixa. As operações exigem funcionário `CASHIER` ativo, restaurante ativo e caixa aberto quando aplicável.
- Pagamentos calculados no servidor a partir dos pedidos persistidos. Suporte a dinheiro, PIX, débito, crédito e pagamento dividido; cálculo de troco e associação à sessão de caixa. Descontos percentuais/fixos exigem motivo e código/PIN de gerente ativo no mesmo restaurante, com tentativas limitadas; a taxa de serviço é calculada após o desconto, e o PIN não é persistido.
- Idempotência transacional para pedidos manuais e movimentações. Fechamento de mesa grava pagamento, baixa pedidos, libera mesa e conclui pedido de conta na mesma transação.
- Pedido manual do garçom validado contra o cardápio oficial; o preço enviado pelo cliente não determina o total.
- Regras do Firestore bloqueiam gravações diretas de pedidos, pagamentos e operações de caixa destinadas às APIs.
- Removida a possibilidade de gerente, chefe de salão ou Caixa liberar diretamente uma mesa ocupada no Firestore sem recebimento. O fechamento passa pela API de pagamento.
- Chamados de conta assumidos pelo garçom aguardam o recebimento pelo Caixa; o garçom não os conclui.
- Relatórios somam corretamente as partes de pagamentos divididos por método.

## Evidência de validação

| Verificação | Resultado | Evidência |
|---|---|---|
| Build | Aprovado | `npm run build` concluiu; houve apenas aviso de chunk acima de 500 kB. |
| Testes unitários | Aprovado | `npm run test:unit`: 13/13; inclui cálculo percentual/fixo e limites de desconto. |
| Regras Firestore | Aprovado | `npm run test:rules` com emulador: 25/25. Inclui isolamento, pedidos, pagamentos e bloqueio de fechamento direto por proprietário, Caixa e chefe de salão. |
| Fluxo integrado via APIs e clientes Firebase | Aprovado | Auth + Firestore Emulator: abertura do caixa; preço adulterado ignorado e pedido idempotente; cozinha `novo → preparando → pronto`; entrega pelo garçom; PIN incorreto e autoautorização do gerente recusados em orçamento e recebimento; desconto de 10% em R$ 25 e total de R$ 24,75 com taxa aplicada após desconto; limite de 100% validado; pagamento dividido com troco; pagamento sem duplicidade; auditoria registra gerente/motivo sem PIN; sangria idempotente; fechamento do caixa; garçom recebe HTTP 403 ao tentar receber. |
| Sintaxe das APIs | Aprovado | `node --check` para order, payment e cash APIs. |
| Lint | Aprovado com avisos | 0 erros e 30 avisos existentes/estilo React, imports de scripts/testes e código legado. |
| Navegador visual | Não executado | A sessão CUA informou `apps: []` e `browsers: []`; não foi possível interagir com a aplicação no navegador. |

Os logs dos testes de regras incluem mensagens `PERMISSION_DENIED` esperadas para operações inválidas. Algumas dessas tentativas também registram o limite interno de 1.000 expressões; elas foram negadas e os fluxos autorizados de cozinha e entrega passaram na integração. A complexidade das regras merece nova observação se forem acrescentadas permissões.

**Ambiente local:** o processo do Firestore Emulator permaneceu ouvindo em `127.0.0.1:8080` depois dos testes; o Auth Emulator foi encerrado. A tentativa de encerrar o processo restante foi negada pelo sistema operacional. O serviço estava configurado para projeto `demo-servia-integration`, sem conexão com produção.

## Pendências para operação real

1. Fazer o fluxo visual completo em navegador com conta de teste: cardápio do cliente, criar pedido QR, acompanhar o próprio pedido, chamar garçom, pedir conta e conferir erros no console.
2. Validar no emulador o fluxo de chamado de garçom/conta e a recuperação da comanda pela tela do cliente. A integração atual percorreu API do pedido manual, cozinha, entrega e Caixa.
3. Revalidar autenticação e autorização dos módulos pelo navegador, incluindo gerente, chefe de salão, Caixa, cozinha e proprietário do sistema.
4. Cancelamento parcial de item com PIN de gerente e transferência/divisão por pedidos entre contas foram implementados após a última rodada de testes. Exigem validação manual; não houve teste desta revisão. A divisão de um único pedido por itens não foi incluída.
5. A baixa automática de estoque por ficha técnica segue pendente. A revisão automática bloqueou gravar baixa no momento do pedido porque esse saldo poderia ser consumido em pedido não pago ou posteriormente cancelado. A alteração parcial de cadastro de ficha técnica foi removida; nenhuma baixa de estoque está ativa.
6. O painel financeiro do proprietário do Servia, incluindo receitas de assinaturas/manutenção, não foi percorrido nem validado em navegador.
7. Lint e build deixam avisos de bundle e avisos do código atual. Não foram feitas melhorias estéticas ou refatorações para removê-los.

**Alterações mais recentes:** relatório por operador, divisão por pedidos, transferência e cancelamento com autorização foram editados após a evidência de build/testes desta tabela; estão pendentes de validação manual e não devem ser considerados certificados.

## Conclusão

As APIs de caixa/pedido e as regras testadas passaram em ambientes sintéticos, inclusive tentativas de duplicidade e permissões. Isso é evidência de segurança e consistência para os cenários exercitados, mas não substitui o teste visual dos fluxos de cliente nem cobre todos os recursos operacionais citados anteriormente. O Servia continua **em homologação**, e não deve ser declarado pronto para produção até as pendências acima serem validadas ou resolvidas.
