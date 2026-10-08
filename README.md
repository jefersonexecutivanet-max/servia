# Servia

Sistema Servia para restaurantes em React 19, Vite, TypeScript e Firebase Authentication/Firestore. A hospedagem web usa Vercel. Cadastro e login de funcionários por PIN usam rotas de API serverless do Vercel; não dependem de Cloud Functions nem exigem mudar o plano Firebase.

## Configuração

1. Instale Node.js 22+ e Firebase CLI. Copie `.env.example` para `.env.local` e preencha a configuração Firebase e `VITE_PIX_KEY`. O UID proprietário do sistema é `KVoJiEGKnnceyADEqFhcflynohr2` (`finho60@hotmail.com`).
2. No Firebase Console, habilite autenticação por e-mail/senha e autenticação anônima. O cliente QR usa autenticação anônima; App Check pode ser habilitado com `VITE_ENABLE_APP_CHECK=true` e `VITE_RECAPTCHA_SITE_KEY` após configurar o provedor no Console.
3. Instale dependências (`npm ci`), execute `npm run dev` e configure o restaurante/equipe no painel.
4. Para QR de mesa, defina `VITE_PUBLIC_BASE_URL` como a origem HTTPS pública desejada. Gere/rotacione o token na tela Mesas e reimprima os QR Codes. Mesas antigas sem token seguem aceitas para compatibilidade.
5. A consulta pública de garçons passou a usar `waiterDirectory/{restaurantId}/staff`. Migre os dados legados antes de publicar as novas regras: disponibilize `firebase-service-account.json` localmente e rode `npm run migrate:waiter-directory`.

## Desenvolvimento e publicação

```sh
npm ci
npm run dev
npm run build
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project SEU_PROJECT_ID
```

O Vercel publica o site e as rotas `/api/employees/*` a partir do repositório. Configure `FIREBASE_SERVICE_ACCOUNT_JSON` nas variáveis de ambiente do projeto Vercel para habilitar operações protegidas da equipe. Gere a chave de conta de serviço no Firebase Console e cole o JSON completo diretamente no campo secreto do Vercel; nunca a coloque no repositório, no frontend ou em uma variável `VITE_*`. Opcionalmente configure `FIREBASE_PROJECT_ID` se o `project_id` da chave não identificar o projeto esperado. Após adicionar ou alterar variáveis, faça novo deploy no Vercel.

Confira [TESTING.md](TESTING.md) para verificações automatizadas e roteiro manual. O GitHub Actions executa TypeScript, lint e regras do Firestore em cada push/PR.

## Impressão e notificações

A impressão usa o diálogo de impressão do navegador e a impressora padrão do sistema. Impressão silenciosa depende da configuração de quiosque do navegador, fora do controle do app. USB, Bluetooth e rede não estão implementados e não aparecem como opções ativas. A configuração da cozinha é salva no restaurante, com cache local de contingência.

No plano Spark, o app mostra chamados pendentes ao abrir, emite aviso sonoro repetido e tenta notificação local do navegador em segundo plano. Push FCM e envio servidor a servidor ainda não fazem parte do fluxo padrão.

## Variáveis de ambiente

Veja `.env.example`. App Check fica desligado por padrão. `VITE_CALL_ESCALATION_MINUTES` controla o destaque de chamadas antigas (padrão 3). `VITE_PUBLIC_BASE_URL` define a origem dos QR Codes. Nunca coloque credenciais de Admin SDK ou tokens privados em variáveis `VITE_*`.

## Migração e segurança

As alterações de schema são aditivas e mantêm leitura de dados antigos. finho60 é o proprietário do sistema e libera/cadastra restaurantes. A conta do restaurante é identificada separadamente pelo UID corresponder ao ID do restaurante e pelo campo `ownerEmail`; o restaurante autorizado administrado por jeferson tem acesso total apenas aos próprios dados e funcionários. Antes de aplicar as regras, faça backup e migre o diretório público de garçons. Tokens de mesa devem ser tratados como segredos: rotacione-os se um QR for exposto.

Revogue e substitua qualquer credencial que tenha sido incluída em pacotes distribuídos. A verificação do histórico do repositório não encontrou valores de credenciais nos padrões de tokens e chaves privadas verificados. Se uma credencial real for identificada, revogue-a no provedor antes de removê-la do histórico.


## Employee PIN access

The restaurant administrator registers each employee with a name, role, and initial PIN. Servia generates an ID in the FUNC- format. Employees sign in with that ID and PIN, or open their individual QR and enter the PIN. A Vercel serverless API validates the PIN, stores only a salted scrypt hash, limits failed attempts, and issues a Firebase session scoped to the employee and restaurant. Employees can change their own PIN; a manager can reset it from the employee record.

O cadastro e o login por PIN usam a API serverless do Vercel e Admin SDK no servidor. `employeeSecrets`, `employeeCodes`, `employeeLoginLimits` e `employeeAudit` são coleções somente do servidor. Nunca exponha credenciais do Admin SDK no frontend.
