# Studio Ana Paula Souza — agenda, clientes e financeiro

Sistema do estúdio de cílios e unhas: agendamento online 24h, agenda do dia, ficha das
clientes, controle de manutenção, sinal via Pix e financeiro — em português, com painel
administrativo.

**Clientes não têm login.** A cliente marca, consulta, confirma, cancela e avisa o Pix
usando o **nome completo + WhatsApp** informados no agendamento.

## O que tem no sistema

- Agendamento online com horários realmente livres, sinal via Pix (QR Code + copia e cola) e confirmação por WhatsApp.
- Painel do estúdio com agenda, clientes, serviços, portfólio com upload de fotos, financeiro e retornos.
- **Notificações em tempo real por WebSocket**: agendamento novo, sinal informado e movimentações aparecem no painel sem recarregar.
- **Pix editável no painel**: chave, nome do recebedor, cidade e percentual do sinal.
- **Contato e redes** editáveis (WhatsApp, e-mail, Instagram e endereço) — repercutem no site e nas mensagens.
- **Senha do painel** pode ser trocada em Contato & redes → Acesso do estúdio.
- Manutenção calculada por serviço e mensagens de retorno prontas para enviar.

## Endereços

No ar em **https://app.studio-ana-paula.workers.dev**

| Página                | Endereço                                              |
| --------------------- | ----------------------------------------------------- |
| Site                  | https://app.studio-ana-paula.workers.dev/           |
| Agendamento           | https://app.studio-ana-paula.workers.dev/agendar    |
| Minha conta           | https://app.studio-ana-paula.workers.dev/minha-conta |
| Painel do estúdio     | https://app.studio-ana-paula.workers.dev/admin.html |

Localmente o servidor usa `http://localhost:3000`.

## Rodando localmente

```bash
npm ci
npm start          # API + site em http://localhost:3000 (banco em memória)
```

`npm run dev` sobe o Worker com banco D1 e KV locais, mais próximo da produção:

```bash
npm run db:local
npm run dev
```

Acessos do painel: `studio@anapaulasouza.com.br` e a senha de `ANAPAULA_ADMIN_PASSWORD`
(sem ela, o primeiro start gera uma senha e mostra no console).

## Publicação automática

Cada push na `main` dispara **CI** (teste de fumaça) e **Publicar** (deploy no Cloudflare).

O deploy cria os recursos que faltarem e aplica a estrutura do banco:

- Worker `app` (API + site + WebSocket em `/api/live`)
- Banco **D1** `studio-ana-paula`
- KV `studio-ana-paula-media` (fotos do portfólio)
- Durable Object **LiveHub** (hub do WebSocket do painel)
- Segredo `ANAPAULA_ADMIN_PASSWORD` (senha do painel no primeiro acesso)

Secrets do repositório (Settings → Secrets and variables → Actions):

| Secret                    | Para que serve                                            |
| ------------------------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`    | Publicar o Worker                                         |
| `CLOUDFLARE_ACCOUNT_ID`   | Conta do Cloudflare                                       |
| `ANAPAULA_ADMIN_PASSWORD`  | Senha do painel (usada só na criação da conta do estúdio) |
| `ANAPAULA_PIX_KEY`         | Chave Pix do estúdio (opcional)                           |

Sem `CLOUDFLARE_API_TOKEN` a publicação fica desativada e o CI continua verde.

## Testes

```bash
npm test                                   # fluxo completo no servidor local
npm run check:live https://seu-endereco    # páginas, API pública e login do painel
SMOKE_TARGET=https://seu-endereco SMOKE_ADMIN_PASSWORD=... npm test
```

## Dados

- Clientes, agenda, financeiro e configurações ficam no banco D1 (Cloudflare).
- Fotos publicadas pelo painel ficam no KV; as imagens fixas do site em `public/img/`.
- Os dados de demonstração são criados uma única vez, no primeiro acesso ao sistema.

## Estrutura

```
functions/     API completa (roda no Cloudflare e no Node local)
serverless/    Worker, WebSocket (Durable Object), banco D1, KV e estrutura do banco
server/        servidor local que usa functions/ (npm start)
public/        site público e painel (JS puro, sem build)
dev/           banco e storage em memória para testes
scripts/       teste de fumaça, check do site publicado e deploy
```
