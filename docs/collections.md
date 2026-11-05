# NavozCoin — modelagem do MongoDB

Banco padrão: **`navozcoin`** no MongoDB Atlas.
Todos os relacionamentos usam `ObjectId`. Valores monetários são **inteiros** (pontos), nunca floats.

As coleções e os índices abaixo são criados automaticamente por `server/db.js` (`ensureIndexes`). O seed usa exatamente a mesma estrutura.

---

## `admins`

Administradores do painel.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `username` | string | nome de exibição/login |
| `usernameLower` | string | usado na busca; único |
| `displayName` | string | nome mostrado no painel |
| `passwordHash` | string | bcrypt, cost 12 |
| `role` | string | `owner` (principal) / `admin` (secundário) |
| `active` | boolean | administrador ativo |
| `permissions` | array | permissões no formato `module:view` / `module:manage` (ignorado para `owner`, que tem acesso total) |
| `createdBy` | ObjectId → `admins` | quem criou o secundário |
| `lastLoginAt` | Date | último login |
| `createdAt` / `updatedAt` | Date | timestamps |

Índices:
- `uniq_username` — `{ usernameLower: 1 }` único
- `active` — `{ active: 1 }`

---

## `adminSessions`

Sessões server-side. O navegador recebe apenas um token opaco.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `adminId` | ObjectId → `admins` | dono da sessão |
| `tokenHash` | string | SHA-256 do token do cookie |
| `csrfHash` | string | SHA-256 do token CSRF |
| `ip` | string | IP de origem |
| `userAgent` | string | limitado a 300 caracteres |
| `createdAt` / `lastSeenAt` | Date | |
| `expiresAt` | Date | TTL de 8h |

Índices:
- `uniq_token` — `{ tokenHash: 1 }` único
- `admin_created` — `{ adminId: 1, createdAt: -1 }`
- `ttl_expires` — `{ expiresAt: 1 }` TTL `expireAfterSeconds: 0`

---

## `members`

Membros da família. Arquivamento é lógico; o documento nunca é apagado.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `nickname` | string | 2–24 caracteres |
| `nicknameLower` | string | unicidade case-insensitive |
| `playerId` | string | ID do jogador, único |
| `avatar` | string | URL HTTPS ou vazio |
| `role` | string | Líder, Vice-Líder, Oficial, Membro, Recruta, Convidado |
| `joinedAt` | Date | data de entrada |
| `status` | string | `active` / `archived` |
| `balance` | int | saldo disponível |
| `reserved` | int | reservado em resgates pendentes |
| `totalEarned` | int | pontos históricos para ranking |
| `totalSpent` | int | pontos gastos em resgates aprovados |
| `eventsParticipated` | int | eventos finalizados com presença |
| `robberyCards` | int | total manual de cartões de roubo |
| `robberyCardsUpdatedAt` | Date | última atualização do total |
| `robberyCardsUpdatedBy` | ObjectId → `admins` | responsável pela última atualização |
| `robberyCardsUpdatedByName` | string | snapshot do responsável |
| `createdAt` / `updatedAt` | Date | |
| `createdBy` | ObjectId → `admins` | |
| `archivedAt` / `archivedBy` | Date / ObjectId | preenchidos no arquivamento |

Índices:
- `uniq_nickname` — `{ nicknameLower: 1 }` único
- `uniq_player_id` — `{ playerId: 1 }` único
- `status_joined` — `{ status: 1, joinedAt: -1 }`
- `status_earned` — `{ status: 1, totalEarned: -1 }`
- `robbery_cards` — `{ robberyCards: -1 }`
- `search_text` — text index em `nickname` e `playerId`

Invariantes:
- `balance >= 0`, `reserved >= 0`, `totalSpent >= 0`;
- `balance + reserved + totalSpent = totalEarned` (considerando apenas lançamentos que alteram ranking);
- `totalEarned` **não** é reduzido por resgates.

---

## `events`

Eventos criados antecipadamente.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `name` | string | 3–80 |
| `description` | string | até 800 |
| `date` | string | `YYYY-MM-DD` |
| `time` | string | `HH:mm` |
| `category` | string | Treinamento, Campeonato, Scrim, Reunião, Evento Especial, Outro |
| `pointsPerParticipant` | int | 1–1.000.000 |
| `seasonId` | ObjectId → `seasons` ou null | temporada relacionada |
| `status` | string | `scheduled` / `completed` / `cancelled` |
| `participantCount` | int | congelado após finalizar |
| `pointsDistributed` | int | congelado após finalizar |
| `presentCount` | int | contador de exibição |
| `createdBy` | ObjectId → `admins` | |
| `finalizedAt` / `finalizedBy` / `finalizedByName` | Date / ObjectId / string | |
| `cancelledAt` / `cancelledBy` | Date / ObjectId | |
| `createdAt` / `updatedAt` | Date | |

Índices:
- `status_date` — `{ status: 1, date: 1, time: 1 }`
- `season_date` — `{ seasonId: 1, date: -1 }`
- `date_desc` — `{ date: -1, time: -1 }`
- `created` — `{ createdAt: -1 }`

Regras:
- só `scheduled` pode ser editado, cancelado ou ter presença alterada;
- finalização é atômica e idempotente;
- `cancelled` e `completed` são terminais.

---

## `eventParticipants`

Relação N:N entre eventos e membros, com presença.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `eventId` | ObjectId → `events` | |
| `memberId` | ObjectId → `members` | |
| `present` | boolean | marcação manual |
| `pointsAwarded` | int | preenchido na finalização |
| `markedBy` / `markedAt` | ObjectId / Date | |
| `awardedAt` | Date | |
| `createdAt` / `updatedAt` | Date | |

Índices:
- `uniq_event_member` — `{ eventId: 1, memberId: 1 }` único
- `event_present` — `{ eventId: 1, present: 1 }`
- `member` — `{ memberId: 1 }`

---

## `pointTransactions`

Ledger append-only. É a fonte de verdade financeira e de ranking.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `memberId` | ObjectId → `members` | |
| `type` | string | `event`, `manual_add`, `manual_remove`, `redemption_reserve`, `redemption_approve`, `redemption_refund`, `correction` |
| `amount` | int | valor assinado exibido no extrato |
| `balanceDelta` | int | efeito no saldo disponível |
| `reservedDelta` | int | efeito no reservado |
| `spentDelta` | int | efeito no total gasto |
| `rankingDelta` | int | efeito no total conquistado |
| `description` | string | descrição legível |
| `reason` | string | justificativa |
| `adminId` / `adminName` | ObjectId / string | responsável |
| `eventId` | ObjectId → `events` | opcional |
| `redemptionId` | ObjectId → `redemptions` | opcional |
| `seasonId` | ObjectId → `seasons` | ranking por temporada |
| `balanceAfter` / `reservedAfter` | int | snapshot após o lançamento |
| `idempotencyKey` | string | único |
| `createdAt` | Date | |

Índices:
- `uniq_idempotency` — `{ idempotencyKey: 1 }` único
- `member_created` — `{ memberId: 1, createdAt: -1 }`
- `created` — `{ createdAt: -1 }`
- `type_created` — `{ type: 1, createdAt: -1 }`
- `event` — `{ eventId: 1 }`
- `redemption` — `{ redemptionId: 1 }`
- `season_created` — `{ seasonId: 1, createdAt: -1 }`

Chaves de idempotência usadas:
- evento: `event:<eventId>:member:<memberId>`
- manual: UUID/chave enviada pelo cliente
- cartões de roubo com crédito: chave `robbery:<uuid>` no `manual_add`
- resgate: `redemption:<id>:reserve` / `:approve` / `:refund`

Nenhum endpoint atualiza ou apaga lançamentos existentes.

---

## `rewards`

Presentes da loja.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `name` / `nameLower` | string | |
| `description` | string | |
| `image` | string | URL |
| `price` | int | ≥ 1 |
| `stock` | int | ≥ 0; reservado na solicitação |
| `available` | boolean | disponível na loja |
| `archived` | boolean | arquivamento lógico |
| `createdBy` | ObjectId → `admins` | |
| `createdAt` / `updatedAt` | Date | |

Índices:
- `status` — `{ archived: 1, available: 1 }`
- `price` — `{ price: 1 }`
- `created` — `{ createdAt: -1 }`

---

## `redemptions`

Solicitações de resgate.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `memberId` | ObjectId → `members` | |
| `rewardId` | ObjectId → `rewards` | |
| `memberNickname` / `memberAvatar` | string | snapshot histórico |
| `rewardName` / `rewardImage` | string | snapshot histórico |
| `unitPrice` / `quantity` / `totalPoints` | int | |
| `status` | string | `pending` / `approved` / `delivered` / `rejected` |
| `note` | string | observação |
| `requestedBy` / `requestedAt` | ObjectId / Date | |
| `approvedBy` / `approvedAt` | ObjectId / Date | |
| `deliveredBy` / `deliveredAt` | ObjectId / Date | |
| `rejectedBy` / `rejectedAt` / `rejectionReason` | ObjectId / Date / string | |
| `idempotencyKey` | string | único |
| `createdAt` / `updatedAt` | Date | |

Índices:
- `uniq_idempotency` — `{ idempotencyKey: 1 }` único
- `status_created` — `{ status: 1, createdAt: -1 }`
- `member_created` — `{ memberId: 1, createdAt: -1 }`
- `reward` — `{ rewardId: 1 }`

Transições permitidas:
```text
pending -> approved -> delivered
pending -> rejected
```
Não é possível aprovar/recusar duas vezes nem entregar um resgate não aprovado.

---

## `seasons`

Temporadas competitivas.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `name` / `nameLower` | string | nome único |
| `startDate` / `endDate` | string | `YYYY-MM-DD` |
| `status` | string | `draft` / `active` / `ended` |
| `activatedAt` / `endedAt` | Date | |
| `createdBy` | ObjectId → `admins` | |
| `createdAt` / `updatedAt` | Date | |

Índices:
- `uniq_name` — `{ nameLower: 1 }` único
- `status` — `{ status: 1 }`
- `start` — `{ startDate: -1 }`

Regras:
- no máximo uma temporada `active`;
- ativar uma nova encerra a anterior;
- carteiras não são zeradas;
- pontos de ranking por temporada usam `pointTransactions.seasonId`.

---

## `auditLogs`

Trilha append-only de operações administrativas.

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | ObjectId | PK |
| `adminId` | ObjectId → `admins` ou null | |
| `adminName` | string | snapshot |
| `action` | string | ex.: `event.finalized`, `points.added` |
| `entityType` | string | `member`, `event`, `redemption`, `reward`, `season`, `admin`, `system` |
| `entityId` | string | referência lógica |
| `description` | string | legível |
| `metadata` | object | dados auxiliares sem segredos |
| `ip` / `userAgent` | string | contexto da requisição |
| `createdAt` | Date | |

Índices:
- `created` — `{ createdAt: -1 }`
- `admin_created` — `{ adminId: 1, createdAt: -1 }`
- `entity` — `{ entityType: 1, entityId: 1, createdAt: -1 }`

Ações novas incluídas:
- `robbery_cards.updated` — alteração manual do total de cartões de roubo (e, quando aplicável, crédito de pontos no mesmo registro);
- `admin.created`, `admin.updated`, `admin.deactivated`, `admin.reactivated` — gestão de administradores.

Não há endpoint de update/delete.

---

## Collections auxiliares

### `rateLimits`

| Campo | Tipo | Observação |
|---|---|---|
| `_id` | string | chave + janela de tempo |
| `count` | int | tentativas na janela |
| `createdAt` | Date | |
| `expiresAt` | Date | TTL |

Índice: `ttl_expires` — TTL em `expiresAt`.

---

## Permissões de administradores

Módulos disponíveis para concessão:

| Módulo | Chave | Permite gerenciar? |
|---|---|:---:|
| Visão geral | `dashboard` | não |
| Membros | `members` | sim |
| Eventos | `events` | sim |
| Ranking | `ranking` | não |
| Pontuação | `points` | sim |
| Cartões de Roubo | `robbery` | sim |
| Loja | `rewards` | sim |
| Resgates | `redemptions` | sim |
| Temporadas | `seasons` | sim |
| Auditoria | `audit` | não |

Formato armazenado: `["members:view", "members:manage", "robbery:manage", ...]`.
`manage` implica `view`; o servidor normaliza e valida cada permissão. O módulo
de administradores não é concedível e pertence exclusivamente ao `owner`.

---

## Relacionamentos

```text
admins 1 ─── N adminSessions
admins 1 ─── N events (createdBy/finalizedBy)
admins 1 ─── N auditLogs
members 1 ── N eventParticipants ── N events
members 1 ── N pointTransactions
members 1 ── N redemptions ── 1 rewards
seasons 1 ── N events
seasons 1 ── N pointTransactions
redemptions 1 ── N pointTransactions (reserva/aprovação/estorno)
```

---

## Estratégia de concorrência

- **Finalização de evento** — uma transação lê o evento, verifica `scheduled`, altera para `completed`, credita cada membro, cria uma transação por membro e grava a auditoria. Concorrência gera conflito de escrita; o driver tenta novamente e encontra o evento já finalizado. A chave única por membro é uma segunda barreira.
- **Resgate** — a criação da solicitação e a reserva de saldo/estoque ocorrem na mesma transação. Aprovação e recusa usam atualizações condicionais (`status: pending`, `reserved >= total`).
- **Lançamento manual** — idempotência por chave única; débito bloqueado se o saldo for insuficiente.
- **Todas as operações financeiras** usam `writeConcern: majority` e `readConcern: snapshot` via `withTransaction` no Atlas.
