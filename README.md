# Servia - Sistema de Gestão para Restaurantes

## Configurar o atendimento dos garçons

1. No Firebase Console, habilite Authentication com e-mail/senha e crie a base Firestore. Este fluxo usa somente Firebase Authentication, Firestore e Hosting e permanece no plano Spark.
2. Instale o Firebase CLI e entre na conta que administra o projeto:

  ```powershell
  npx firebase-tools login
  ```

3. Faça o build e publique o Hosting e as regras:

  ```powershell
  npm run build
  npx firebase-tools deploy --only hosting,firestore:rules --project SEU_PROJECT_ID
  ```

  O dono é identificado pelo UID `FOuQD7ivuuVAfDZwlsjaU2Lte753` e pelo e-mail `finho60@hotmail.com`; somente essa conta precisa existir no Firebase Authentication, sem confirmação de e-mail.

4. Entre com a conta existente do dono e cadastre os dados do restaurante em **Configurações**. O cadastro público de donos está desativado. Em **Equipe**, cadastre nome, função e número da empresa; o QR do garçom vincula o e-mail dele ao cadastro uma única vez.

## Configuração de Impressoras

O sistema possui configurações separadas para impressoras de cozinha e caixa:

### Impressora da Cozinha (Configuração do Restaurante)
1. Vá em **Configurações > Impressoras**
2. Na seção "Impressora da Cozinha", configure:
   - **Habilitar impressora**: Ative para usar impressora de cozinha
   - **Impressão automática**: Ative para imprimir comandas automaticamente quando pedidos são recebidos
   - **Tipo de conexão**: Escolha entre Browser, USB, Bluetooth ou Rede
   - **Largura do papel**: 58mm (compacto) ou 80mm (padrão)
3. Clique em "Testar impressora" para verificar
4. Salve as configurações

### Impressora do Caixa (Configuração por Usuário)
1. Vá em **Configurações > Impressoras**
2. Na seção "Impressora do Caixa", configure:
   - **Habilitar impressora**: Ative para usar impressora do caixa
   - **Tipo de conexão**: Escolha entre Browser, USB, Bluetooth ou Rede
   - **Largura do papel**: 58mm (compacto) ou 80mm (padrão)
3. Clique em "Testar impressora" para verificar
4. Salve as configurações

**Importante**: A configuração da impressora do caixa é específica para cada usuário. Cada caixa deve configurar sua própria impressora ao fazer login.

### Funcionamento
- **Pedidos**: Com a impressão automática ativada na cozinha, todos os pedidos feitos pelos clientes via QR Code serão impressos automaticamente
- **Contas**: Quando o garçom fechar a mesa, a conta será impressa automaticamente na impressora configurada pelo usuário do caixa

## Acesso pela rede local

Para abrir o Servia em celulares conectados ao mesmo Wi-Fi do computador que o hospeda, execute `npm run dev` ou `npm run preview` e use no computador o endereco `Network` mostrado pelo Vite, em vez de `localhost`. Os QR Codes usam o endereco atual do navegador; portanto, ao gerar/imprimir os QR Codes, o painel precisa estar aberto pelo endereco acessivel na rede local. O computador deve permanecer ligado e o firewall pode solicitar permissao para o servidor.

O modo offline atual mantem o app e dados previamente consultados no cache de cada aparelho. A gravacao offline do Firestore fica na fila daquele aparelho e sincroniza quando a internet voltar; ela nao encaminha pedidos de um celular para a cozinha em tempo real sem internet. Para isso, o Servia precisa de um servidor e armazenamento locais compartilhados na rede do restaurante.

## Funcionalidades

O app é instalável pelo navegador e mantém o app shell e os dados consultados no dispositivo. Abra uma vez enquanto estiver online para o cache inicial ser preenchido. Pedidos/configurações gravados offline entram na fila local e sincronizam quando a conexão voltar. O cliente abre `/mesa/{número}`, escolhe um garçom ao chamar ou pedir a conta, e o chamado/comanda é encaminhado ao celular autenticado desse garçom.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
