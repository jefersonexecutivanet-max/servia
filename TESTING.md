# Roteiro de validação manual

1. Gere ou rotacione o token de uma mesa. Abra o QR em uma janela anônima e envie itens com extras e observações diferentes; confirme que viram linhas distintas e que o cliente acompanha seus pedidos.
2. Envie uma chamada de garçom e tente chamar novamente antes de concluir a primeira. Confirme o aviso de espera. Deixe o app do garçom em segundo plano e confirme alerta local/sonoro; reabra o app para confirmar que chamadas pendentes continuam visíveis.
3. Na cozinha, habilite impressão automática no navegador conectado à impressora. Feche a aba, crie pedido e reabra: pedido não impresso deve ser reivindicado e impresso uma única vez. Atualize em duas abas e confirme que a segunda não duplica a impressão.
4. No caixa, feche uma mesa com pedidos. Compare o total calculado com o total registrado, confira alerta de divergência (se houver), gorjeta e nome do garçom impresso. Faça estorno de uma transação e confira o resumo.
5. Entre com usuário vinculado de cada papel: cozinha, caixa, gerente/chefe de salão e garçom. Confirme os módulos permitidos e, para o primeiro vínculo de garçom, valide o e-mail antes de ativar o QR.
6. Teste autorização: mesa sem token legado, token correto/incorreto, chamado duplicado, lista pública de equipe e restaurante vencido. Use o emulador para os casos automatizados de regras.

## Comandos

```sh
npx tsc -b
npm run lint
npm run test:unit
npx firebase-tools emulators:exec --only firestore --project demo-servia-rules "npm run test:rules"
npm run build
```
