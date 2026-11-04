# NavozCoin — Family Management

Sistema web completo para administrar uma família gamer: membros, eventos, pontuação, ranking, loja de presentes, resgates, temporadas e auditoria.

A interface inteira está em **um único `index.html`** (HTML5, CSS3, JavaScript puro, Tailwind via CDN, Lucide e Chart.js). O acesso ao **MongoDB Atlas** é feito exclusivamente por uma **função serverless** — não existe servidor Node.js tradicional e nenhuma credencial do banco é exposta ao navegador.

---

## 1. Visão geral da arquitetura

```text
Navegador
  └── index.html  (UI + lógica visual + chamadas /api)
        │  fetch same-origin, cookie HttpOnly + CSRF
        ▼
Vercel Function  api/index.js
  └── server/api.js      rotas, validação, autenticação e regras de negócio
      ├── server/core.js sessão, CSRF, rate limit, auditoria, validação
      └── server/db.js   MongoDB Atlas, índices e transações
                            │
                            ▼
                    MongoDB Atlas (navozcoin)
```

- **`index.html`** — 100% da interface e da lógica visual. Nenhuma dependência de React/Vue/Angular.
- **`api/index.js`** — entrada serverless. O `vercel.json` encaminha `/api/*` para ela preservando a rota.
- **`server/`** — camada de acesso e regras de negócio, usada apenas no servidor.
- **`scripts/seed.js`** — cria a demonstração completa.
- **`scripts/check.js`** — diagnostica conexão, índices e consistência do ledger.

> Para que os botões funcionem de ponta a ponta, o `index.html` precisa ser servido pela mesma origem da função `/api` (Vercel ou `vercel dev`). Abrir o arquivo diretamente via `file://` não funciona para operações de banco.

---

## 2. Login padrão da demonstração

```text
Usuário: Navoz
Senha:   Navoz
```

O administrador é criado pelo seed com `ADMIN_USERNAME` / `ADMIN_PASSWORD`. **Troque a senha no primeiro acesso**, pelo menu do administrador → *Alterar senha*. A sessão usa cookie `HttpOnly`, CSRF e expira em 8 horas.

Não existe cadastro público de administradores.

---

## 3. Requisitos

- Node.js 20 ou superior (para scripts e runtime da Vercel).
- Conta gratuita no [MongoDB Atlas](https://www.mongodb.com/atlas).
- Conta na [Vercel](https://vercel.com) para publicar.
- O projeto usa o *replica set* do Atlas, necessário para transações multi-documento.

---

## 4. Configurar o MongoDB Atlas

1. Crie um cluster gratuito no Atlas (M0 é suficiente para a demonstração).
2. Em **Database Access**, crie um usuário de banco com permissão `readWrite` no banco `navozcoin`.
3. Em **Network Access**, adicione uma entrada de IP. Para a Vercel, que usa IPs dinâmicos, a forma prática é `0.0.0.0/0` (restrinja depois se usar IP estático/Secure Compute).
4. Em **Connect → Drivers**, copie a string `mongodb+srv://...`.
5. Acrescente o banco antes do `?`:

```text
mongodb+srv://USUARIO:SENHA@cluster0.xxxxx.mongodb.net/navozcoin?retryWrites=true&w=majority
```

Se a senha tiver caracteres especiais, faça o URL-encode (`@`, `#`, `/`, `:` etc.).

O banco, as coleções e os índices são criados automaticamente pelo seed. Não é necessário criar nada manualmente no Atlas.

### Variáveis de ambiente

Copie o modelo:

```bash
cp .env.example .env.local
```

No Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Preencha:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `MONGODB_URI` | sim | String de conexão do Atlas, com o banco `navozcoin` |
| `MONGODB_DB` | não | Nome do banco; padrão `navozcoin` |
| `ADMIN_USERNAME` | não | Usuário criado pelo seed; padrão `Navoz` |
| `ADMIN_PASSWORD` | não | Senha criada pelo seed; padrão `Navoz` |
| `ADMIN_DISPLAY_NAME` | não | Nome exibido no painel |
| `APP_ORIGIN` | recomendado | Origem exata do deploy, ex.: `https://navozcoin.vercel.app` |
| `APP_TIMEZONE` | não | Fuso operacional; padrão `America/Sao_Paulo` |

> O `.env.local` está no `.gitignore`. Em produção, cadastre as variáveis no painel da Vercel. Nunca comite credenciais.

---

## 5. Instalar e criar os dados fictícios

```bash
npm install
npm run seed      # cria a demo somente se o banco estiver vazio
npm run check     # valida conexão, índices e ledger
```

Para recriar a demonstração do zero (apaga apenas as coleções do NavozCoin):

```bash
npm run seed:reset
```

O seed cria:

- 1 administrador (`Navoz` / `Navoz` por padrão);
- 14 membros, sendo 12 ativos e 2 arquivados;
- 4 temporadas (3 encerradas e 1 ativa);
- 13 eventos (8 finalizados, 4 agendados, 1 cancelado);
- 9 presentes, com estoque, indisponibilidade e item arquivado;
- 8 resgates nos quatro estados;
- 85 transações financeiras consistentes;
- 74+ registros de auditoria;
- pontos, ranking, histórico, reservas e carteiras coerentes.

Todos os valores são fictícios.

### Diagnóstico do ledger

```bash
npm run check
```

Ele confirma que a soma de `balance`, `reserved`, `totalEarned` e `totalSpent` das carteiras é exatamente igual à soma do ledger `pointTransactions` e que as reservas pendentes batem com os valores reservados.

---

## 6. Executar localmente

A forma recomendada é usar o ambiente serverless da Vercel:

```bash
npm install
npx vercel dev
```

Na primeira execução, o CLI pede para vincular o projeto e criar/baixar as variáveis. Alternativamente:

1. Crie um projeto na Vercel apontando para o repositório.
2. Cadastre as variáveis em **Settings → Environment Variables**.
3. Rode `vercel env pull .env.local` e depois `npx vercel dev`.

O site abre em `http://localhost:3000` (ou na porta informada pelo CLI). O `APP_ORIGIN` local deve ser `http://localhost:3000`.

> O seed roda direto no Node (`npm run seed`) e não precisa da Vercel ligada.

---

## 7. Publicar na Vercel

1. Envie o projeto para um repositório Git.
2. Importe o repositório na Vercel.
3. Framework preset: **Other** (não há build de frontend).
4. Configure as variáveis de ambiente da seção 4.
5. Ajuste `APP_ORIGIN` para a URL final, por exemplo `https://navozcoin.vercel.app`.
6. Faça o deploy. A raiz serve `index.html`; `/api/*` é reescrito para a função `api/index.js` pelo `vercel.json`.
7. Acesse, entre com o administrador do seed e troque a senha.

Se usar domínio próprio, adicione também a URL do domínio em `APP_ORIGIN` (separando múltiplas origens por vírgula).

### Como a rota funciona

`vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index?path=$1" }
  ]
}
```

`api/index.js` exporta o handler e `server/api.js` lê `?path=...`. Isso evita a limitação de catch-all em funções serverless da Vercel.

Por robustez, o front-end também envia os cabeçalhos `X-Navoz-Route` e `X-Navoz-Query`. Eles preservam a rota e os filtros de busca mesmo se um provedor alterar a query string durante o rewrite. Nenhum dos dois contém credenciais.

---

## 8. O que está implementado

### Dashboard
- membros ativos, pontos distribuídos, saldo em carteiras, reservas;
- eventos realizados, pendentes e cancelados;
- resgates pendentes;
- Top 5;
- gráfico de 14 dias (distribuídos × resgatados) via Chart.js;
- próximos eventos e atividade administrativa recente.

### Membros
- cadastro, edição, busca, filtro por status e arquivamento lógico;
- perfil individual com saldo, total conquistado, total resgatado, eventos participados, posição no ranking e histórico de movimentações;
- restauração de membros arquivados.

### Eventos
- criação antecipada com nome, descrição, data, horário, categoria, pontos por participação e temporada;
- lista de membros ativos com pesquisa;
- marcar/desmarcar presença;
- contagem de presentes e total projetado;
- **FINALIZAR EVENTO** com confirmação, transação atômica, crédito individual, registro do administrador e bloqueio de dupla finalização;
- eventos finalizados e cancelados ficam somente leitura;
- evento cancelado não distribui pontos.

### Pontuação manual
- adicionar ou retirar pontos com justificativa obrigatória;
- idempotência por chave (evita duplo clique/reenvio);
- atualização atômica de saldo e pontos históricos;
- histórico completo e imutável.

### Ranking
- geral, semanal, mensal e por temporada;
- pódio dos três primeiros;
- pesquisa;
- pontos do período, total conquistado, saldo disponível e pontos gastos;
- resgates não reduzem a pontuação histórica.

### Loja e resgates
- CRUD de presentes com imagem, preço, estoque e disponibilidade;
- arquivamento lógico de presentes;
- solicitação de resgate com reserva atômica de pontos e estoque;
- estados Pendente → Aprovado → Entregue, ou Pendente → Recusado;
- recusa libera pontos e estoque;
- idempotência e histórico de resgates preservado.

### Temporadas
- criação, ativação, encerramento e consulta;
- ranking independente por temporada;
- troca de temporada não apaga carteiras nem pontos históricos;
- temporadas encerradas ficam disponíveis para consulta.

### Auditoria
- registra login/logout, alteração de senha, membros, eventos, presenças, pontos, presentes, resgates e temporadas;
- data, operação, entidade, descrição, administrador, IP e user-agent;
- não existe endpoint para editar ou apagar logs;
- correções financeiras geram novas movimentações compensatórias.

---

## 9. Segurança implementada

- credenciais apenas em variáveis de ambiente;
- senha com `bcrypt` (cost 12);
- sessão opaca de 32 bytes, hash SHA-256 no banco, cookie `HttpOnly`, `SameSite=Strict`, `Secure` em HTTPS e expiração de 8 horas;
- CSRF por token duplo (`cookie` + cabeçalho `X-CSRF-Token`, hash na sessão);
- validação de `Origin` nas requisições de escrita;
- rate limit persistido no MongoDB para login (IP + usuário) e operações administrativas;
- autenticação e autorização verificadas em todas as rotas administrativas;
- validação server-side de todos os valores; o navegador nunca envia saldo;
- ObjectId e projeções explícitas;
- CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS;
- transações MongoDB com *snapshot isolation* para finalização de evento e resgates;
- índices únicos de idempotência e chaves `event:{id}:member:{id}` para impedir duplicação de pontos;
- logs de auditoria sem endpoint de exclusão.

**Importante:** o token CSRF fica em cookie legível pelo JavaScript por design (double-submit), mas o cookie de sessão é `HttpOnly`. Ainda assim, mantenha o CSP e evite qualquer inclusão de HTML não confiável.

---

## 10. Rotas da API

Todas as rotas administrativas exigem sessão. `POST`, `PATCH` e `DELETE` também exigem `X-CSRF-Token`.

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/health` | saúde da função |
| `POST` | `/api/auth/login` | login |
| `GET` | `/api/auth/me` | sessão atual + CSRF |
| `POST` | `/api/auth/logout` | logout |
| `POST` | `/api/auth/password` | alterar senha |
| `GET` | `/api/dashboard` | métricas, gráfico, top 5, atividade |
| `GET/POST` | `/api/members` | listar/criar membros |
| `GET/PATCH/DELETE` | `/api/members/:id` | perfil/editar/arquivar |
| `POST` | `/api/members/:id/restore` | restaurar |
| `GET` | `/api/transactions` | histórico financeiro |
| `POST` | `/api/points` | lançamento manual |
| `GET/POST` | `/api/events` | listar/criar eventos |
| `GET/PATCH` | `/api/events/:id` | detalhe/editar |
| `PUT` | `/api/events/:id/attendance` | presença |
| `POST` | `/api/events/:id/finalize` | finalizar (idempotente) |
| `POST` | `/api/events/:id/cancel` | cancelar |
| `GET` | `/api/rankings` | geral/semanal/mensal/temporada |
| `GET/POST` | `/api/seasons` | listar/criar temporadas |
| `POST` | `/api/seasons/:id/activate` | ativar |
| `POST` | `/api/seasons/:id/close` | encerrar |
| `GET/POST` | `/api/rewards` | listar/criar presentes |
| `PATCH/DELETE` | `/api/rewards/:id` | editar/arquivar |
| `POST` | `/api/rewards/:id/restore` | restaurar |
| `GET/POST` | `/api/redemptions` | listar/solicitar |
| `GET` | `/api/redemptions/:id` | detalhe |
| `POST` | `/api/redemptions/:id/approve` | aprovar |
| `POST` | `/api/redemptions/:id/reject` | recusar/liberar |
| `POST` | `/api/redemptions/:id/deliver` | entregar |
| `GET` | `/api/audit` | auditoria paginada |

---

## 11. Consistência das pontuações

- `members.balance`: saldo disponível.
- `members.reserved`: pontos presos em resgates pendentes.
- `members.totalEarned`: pontos históricos que contam para ranking (não diminuem em resgates).
- `members.totalSpent`: pontos efetivamente gastos em resgates aprovados.
- `pointTransactions`: ledger append-only com `balanceDelta`, `reservedDelta`, `spentDelta`, `rankingDelta`, `balanceAfter` e `reservedAfter`.

Fluxo de resgate:

```text
solicitar  -> balance -total, reserved +total, estoque -qtd
aprovar    -> reserved -total, totalSpent +total
entregar   -> apenas status/auditoria
recusar    -> reserved -total, balance +total, estoque +qtd
```

A finalização de evento credita cada presente em uma transação individual e grava a chave única `event:<eventId>:member:<memberId>`. Mesmo com duplo clique, reenvio ou duas abas, os pontos não são duplicados.

---

## 12. Estrutura de arquivos

```text
.
├── index.html                 # interface completa (single-file)
├── api/
│   └── index.js               # entrada serverless
├── server/
│   ├── api.js                 # rotas e regras de negócio
│   ├── core.js                # auth, CSRF, rate limit, validação, auditoria
│   └── db.js                  # conexão, índices, transações
├── scripts/
│   ├── seed.js                # dados fictícios
│   ├── check.js               # diagnóstico de consistência
│   └── load-env.js            # leitor de .env.local para scripts
├── docs/
│   └── collections.md         # modelagem das coleções e índices
├── .env.example
├── vercel.json
├── package.json
└── README.md
```

---

## 13. Solução de problemas

| Sintoma | Causa provável | Correção |
|---|---|---|
| 503 “Banco de dados indisponível” | URI inválida, usuário/senha ou IP não liberado | Revise `MONGODB_URI` e Network Access no Atlas |
| 403 “Origem não autorizada” | `APP_ORIGIN` não corresponde à URL acessada | Ajuste a variável e faça novo deploy |
| 403 “Token de segurança inválido” | página aberta há muito tempo / CSRF expirado | recarregue e entre novamente |
| 401 ao navegar | sessão expirada (8h) | faça login novamente |
| Dashboard zerado | seed não executado | `npm run seed` |
| Erro “Transaction numbers are only allowed on a replica set” | Mongo local standalone | use Atlas ou um replica set |
| Imagens externas não aparecem | bloqueio de rede/CSP do provedor | use URLs HTTPS válidas |
| `path` não chega na API | rewrite ausente | mantenha o `vercel.json` publicado |

---

## 14. Observações de produto

- Membros **não** fazem login; apenas administradores. O fluxo de resgate é operado pela administração em nome do membro, como solicitado.
- A loja e os membros usam exclusão/arquivamento lógico para preservar histórico.
- O sistema não fornece upload de arquivos: avatares e imagens de presentes usam URL HTTPS (ou data URL de imagem pequena para avatares).
- Tailwind é carregado via CDN conforme o requisito; para uma evolução futura, vale compilar o CSS localmente para produção.
- As transações exigem o recurso de replica set do Atlas. O plano gratuito M0 atende.

---

## 15. Checklist pós-deploy

- [ ] `MONGODB_URI`, `MONGODB_DB`, `APP_ORIGIN` configurados na Vercel.
- [ ] `npm run check` sem divergências.
- [ ] Login com o administrador do seed.
- [ ] Senha padrão alterada.
- [ ] Um evento de teste finalizado e conferido no histórico.
- [ ] Um resgate de teste aprovado/recusado.
- [ ] Backup/alertas do Atlas configurados.
