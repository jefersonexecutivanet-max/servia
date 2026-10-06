# Servia

Sistema de atendimento para restaurantes em React 19, Vite, TypeScript e Firebase Authentication/Firestore. O alvo documentado de publicação é Firebase Hosting; o fluxo padrão usa recursos compatíveis com o plano Spark.

## Configuração

1. Instale Node.js 22+ e Firebase CLI. Copie `.env.example` para `.env.local` e preencha a configuração Firebase, `VITE_OWNER_EMAIL` com o e-mail verificado do administrador do sistema (`jeferson.executiva.net@gmail.com`) e `VITE_PIX_KEY`.
2. No Firebase Console, habilite autenticação por e-mail/senha e autenticação anônima. O cliente QR usa autenticação anônima; App Check pode ser habilitado com `VITE_ENABLE_APP_CHECK=true` e `VITE_RECAPTCHA_SITE_KEY` após configurar o provedor no Console.
3. Instale dependências (`npm ci`), execute `npm run dev` e configure o restaurante/equipe no painel.
4. Para QR de mesa, defina `VITE_PUBLIC_BASE_URL` como a origem HTTPS pública desejada. Gere/rotacione o token na tela Mesas e reimprima os QR Codes. Mesas antigas sem token seguem aceitas para compatibilidade.
5. A consulta pública de garçons passou a usar `waiterDirectory/{restaurantId}/staff`. Migre os dados legados antes de publicar as novas regras: disponibilize `firebase-service-account.json` localmente e rode `npm run migrate:waiter-directory`.

## Desenvolvimento e publicação

```sh
npm ci
npm run dev
npm run build
npx firebase-tools deploy --only hosting,firestore:rules,firestore:indexes --project SEU_PROJECT_ID
```

Confira [TESTING.md](TESTING.md) para verificações automatizadas e roteiro manual. O GitHub Actions executa TypeScript, lint e regras do Firestore em cada push/PR.

## Impressão e notificações

A impressão usa o diálogo de impressão do navegador e a impressora padrão do sistema. Impressão silenciosa depende da configuração de quiosque do navegador, fora do controle do app. USB, Bluetooth e rede não estão implementados e não aparecem como opções ativas. A configuração da cozinha é salva no restaurante, com cache local de contingência.

No plano Spark, o app mostra chamados pendentes ao abrir, emite aviso sonoro repetido e tenta notificação local do navegador em segundo plano. Push FCM e envio servidor a servidor exigem credenciais e Cloud Functions no plano Blaze e ainda não fazem parte do fluxo padrão.

## Variáveis de ambiente

Veja `.env.example`. App Check fica desligado por padrão. `VITE_CALL_ESCALATION_MINUTES` controla o destaque de chamadas antigas (padrão 3). `VITE_PUBLIC_BASE_URL` define a origem dos QR Codes. Nunca coloque credenciais de Admin SDK ou tokens privados em variáveis `VITE_*`.

## Migração e segurança

As alterações de schema são aditivas e mantêm leitura de dados antigos. O proprietário do sistema é identificado pelo e-mail verificado configurado em `VITE_OWNER_EMAIL`; o proprietário do restaurante é identificado separadamente pelo UID da conta corresponder ao ID do restaurante e pelo campo `ownerEmail`. Antes de aplicar as regras, faça backup e migre o diretório público de garçons. Tokens de mesa devem ser tratados como segredos: rotacione-os se um QR for exposto.

O token `VERCEL_OIDC_TOKEN` incluído no arquivo ZIP precisa ser invalidado no provedor. Para limpar o histórico Git, faça backup e execute, após instalar `git-filter-repo`, `git filter-repo --path VERCEL_OIDC_TOKEN --invert-paths`; isso reescreve commits e exige coordenar o novo push com colaboradores.
