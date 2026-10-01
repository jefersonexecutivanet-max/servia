# React + TypeScript + Vite

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
