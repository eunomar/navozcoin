'use strict';

/**
 * Seed de demonstração do NavozCoin.
 *
 * Uso:
 *   node scripts/seed.js            -> cria os dados somente se o banco estiver vazio
 *   node scripts/seed.js --reset    -> APAGA as collections do NavozCoin e recria a demo
 *
 * Credenciais do admin demo: ADMIN_USERNAME / ADMIN_PASSWORD (padrão Navoz / Navoz).
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { loadEnv } = require('./load-env');

loadEnv();

const { connect, ensureIndexes } = require('../server/db');

const RESET = process.argv.includes('--reset');
const COLLECTIONS = [
  'admins',
  'adminSessions',
  'members',
  'events',
  'eventParticipants',
  'pointTransactions',
  'rewards',
  'redemptions',
  'seasons',
  'auditLogs',
  'rateLimits',
];

const membersSeed = [
  { key: 'n4voz', nickname: 'N4VOZ', playerId: 'NVZ#0001', role: 'Líder', joinedAt: '2024-03-12', status: 'active' },
  { key: 'luna', nickname: 'LunaStrike', playerId: 'NVZ#0002', role: 'Vice-Líder', joinedAt: '2024-05-03', status: 'active' },
  { key: 'draco', nickname: 'DracoZ', playerId: 'NVZ#0003', role: 'Oficial', joinedAt: '2024-07-21', status: 'active' },
  { key: 'kira', nickname: 'KiraWolf', playerId: 'NVZ#0004', role: 'Oficial', joinedAt: '2024-08-09', status: 'active' },
  { key: 'ghost', nickname: 'GhostBR', playerId: 'NVZ#0005', role: 'Membro', joinedAt: '2024-11-15', status: 'active' },
  { key: 'nyx', nickname: 'Nyx', playerId: 'NVZ#0006', role: 'Membro', joinedAt: '2025-01-20', status: 'active' },
  { key: 'vortex', nickname: 'Vortex', playerId: 'NVZ#0007', role: 'Membro', joinedAt: '2025-02-14', status: 'active' },
  { key: 'sakura', nickname: 'Sakura', playerId: 'NVZ#0008', role: 'Membro', joinedAt: '2025-03-30', status: 'active' },
  { key: 'raven', nickname: 'Raven', playerId: 'NVZ#0009', role: 'Membro', joinedAt: '2025-05-18', status: 'active' },
  { key: 'pixel', nickname: 'Pixel', playerId: 'NVZ#0010', role: 'Recruta', joinedAt: '2025-08-02', status: 'active' },
  { key: 'titan', nickname: 'Titan', playerId: 'NVZ#0011', role: 'Membro', joinedAt: '2025-09-11', status: 'active' },
  { key: 'zephyr', nickname: 'Zephyr', playerId: 'NVZ#0012', role: 'Recruta', joinedAt: '2025-10-05', status: 'active' },
  { key: 'mia', nickname: 'Mia', playerId: 'NVZ#0013', role: 'Convidado', joinedAt: '2025-10-19', status: 'archived', archivedAt: '2026-02-10' },
  { key: 'kronos', nickname: 'Kronos', playerId: 'NVZ#0014', role: 'Membro', joinedAt: '2025-11-02', status: 'archived', archivedAt: '2026-05-05' },
];

const seasonsSeed = [
  { key: 'origem', name: 'Temporada Origem 2025', startDate: '2025-01-01', endDate: '2025-06-30', status: 'ended' },
  { key: 'eclipse', name: 'Temporada Eclipse 2025', startDate: '2025-07-01', endDate: '2025-12-31', status: 'ended' },
  { key: 'onix', name: 'Temporada Ônix 2026', startDate: '2026-01-01', endDate: '2026-06-30', status: 'ended' },
  { key: 'aurora', name: 'Temporada Aurora 2026', startDate: '2026-07-01', endDate: '2026-12-31', status: 'active' },
];

const eventsSeed = [
  {
    key: 'inverno',
    name: 'Copa de Inverno',
    description: 'Torneio interno de encerramento do primeiro semestre. Formato MD3 com chaveamento duplo.',
    date: '2026-04-18',
    time: '20:00',
    category: 'Campeonato',
    points: 300,
    season: 'onix',
    status: 'completed',
    participants: ['n4voz', 'luna', 'draco', 'kira', 'ghost', 'nyx', 'mia', 'kronos'],
  },
  {
    key: 'bootcamp',
    name: 'Bootcamp de Estratégia',
    description: 'Revisão de mapas, callouts e execuções de ataque para a nova temporada.',
    date: '2026-08-22',
    time: '20:00',
    category: 'Treinamento',
    points: 200,
    season: 'aurora',
    status: 'completed',
    participants: ['n4voz', 'draco', 'kira', 'ghost', 'nyx', 'vortex', 'sakura', 'raven'],
  },
  {
    key: 'rotacao',
    name: 'Treinamento de Rotação',
    description: 'Treino focado em rotações rápidas, controle de mapa e comunicação em equipe.',
    date: '2026-09-05',
    time: '21:00',
    category: 'Treinamento',
    points: 100,
    season: 'aurora',
    status: 'completed',
    participants: ['n4voz', 'luna', 'draco', 'kira', 'ghost', 'nyx', 'vortex', 'sakura', 'titan'],
  },
  {
    key: 'scrim-void',
    name: 'Scrim vs. Void Wolves',
    description: 'Série de scrims contra a Void Wolves. Análise de VOD logo após a série.',
    date: '2026-09-26',
    time: '21:30',
    category: 'Scrim',
    points: 150,
    season: 'aurora',
    status: 'completed',
    participants: ['n4voz', 'luna', 'kira', 'ghost', 'nyx', 'vortex', 'sakura', 'raven'],
  },
  {
    key: 'copa-grupos',
    name: 'Copa Navoz — Fase de Grupos',
    description: 'Fase de grupos da Copa Navoz. Classificação garantida para a grande final.',
    date: '2026-10-10',
    time: '20:00',
    category: 'Campeonato',
    points: 250,
    season: 'aurora',
    status: 'completed',
    participants: ['n4voz', 'luna', 'draco', 'kira', 'ghost', 'vortex', 'titan'],
  },
  {
    key: 'comunicacao',
    name: 'Treinamento de Comunicação',
    description: 'Exercícios de callout, foco e tomada de decisão sob pressão.',
    date: '2026-10-24',
    time: '21:00',
    category: 'Treinamento',
    points: 80,
    season: 'aurora',
    status: 'completed',
    participants: ['n4voz', 'luna', 'draco', 'kira', 'ghost', 'nyx', 'vortex', 'sakura', 'raven', 'titan'],
  },
  {
    key: 'ranked-out',
    name: 'Noite de Ranked',
    description: 'Sessão coletiva de ranked com meta de subir três divisões até o fim da noite.',
    date: '2026-10-31',
    time: '22:00',
    category: 'Evento Especial',
    points: 120,
    season: 'aurora',
    status: 'completed',
    participants: ['n4voz', 'luna', 'draco', 'kira', 'ghost', 'nyx', 'sakura', 'raven', 'pixel'],
  },
  {
    key: 'relampago',
    name: 'Torneio Relâmpago',
    description: 'Torneio rápido de 1v1 para aquecer o time antes da grande final.',
    date: '2026-11-02',
    time: '21:00',
    category: 'Campeonato',
    points: 300,
    season: 'aurora',
    status: 'completed',
    participants: ['n4voz', 'luna', 'kira', 'ghost', 'vortex', 'titan'],
  },
  {
    key: 'grande-final',
    name: 'Copa Navoz — Grande Final',
    description: 'A grande final da Copa Navoz. Concentração 30 minutos antes. Transmissão oficial na Twitch.',
    date: '2026-11-08',
    time: '19:00',
    category: 'Campeonato',
    points: 500,
    season: 'aurora',
    status: 'scheduled',
    participants: ['n4voz', 'luna', 'draco', 'kira'],
  },
  {
    key: 'scrim-lunar',
    name: 'Scrim vs. Lunar Eclipse',
    description: 'Preparação para a final contra o estilo de jogo da Lunar Eclipse.',
    date: '2026-11-12',
    time: '21:00',
    category: 'Scrim',
    points: 150,
    season: 'aurora',
    status: 'scheduled',
    participants: ['n4voz', 'ghost'],
  },
  {
    key: 'treino-final',
    name: 'Treinamento de Comunicação',
    description: 'Última sessão de alinhamento antes do encerramento da temporada.',
    date: '2026-11-16',
    time: '21:00',
    category: 'Treinamento',
    points: 80,
    season: 'aurora',
    status: 'scheduled',
    participants: [],
  },
  {
    key: 'ranked-final',
    name: 'Noite de Ranked',
    description: 'Sessão aberta para todos os membros ativos. Pontuação por participação confirmada.',
    date: '2026-11-22',
    time: '22:00',
    category: 'Evento Especial',
    points: 120,
    season: 'aurora',
    status: 'scheduled',
    participants: ['luna', 'sakura', 'zephyr'],
  },
  {
    key: 'amistoso-cancelado',
    name: 'Amistoso vs. Team Hydra',
    description: 'Amistoso cancelado pela organização adversária. Nenhum ponto será distribuído.',
    date: '2026-11-06',
    time: '20:00',
    category: 'Scrim',
    points: 100,
    season: 'aurora',
    status: 'cancelled',
    participants: ['n4voz', 'vortex'],
  },
];

const manualSeed = [
  {
    key: 'm1',
    member: 'n4voz',
    amount: 500,
    reason: 'Bônus MVP da temporada pelo desempenho e liderança na Copa.',
    at: '2026-10-20T22:00:00.000Z',
  },
  {
    key: 'm2',
    member: 'luna',
    amount: 300,
    reason: 'Destaque nas lives da família e crescimento da comunidade.',
    at: '2026-10-18T21:00:00.000Z',
  },
  {
    key: 'm3',
    member: 'vortex',
    amount: 750,
    reason: 'Organização dos scrims e suporte técnico durante setembro.',
    at: '2026-09-30T23:00:00.000Z',
  },
  {
    key: 'm4',
    member: 'sakura',
    amount: 250,
    reason: 'Apoio na produção dos eventos e edição dos melhores momentos.',
    at: '2026-10-26T23:30:00.000Z',
  },
  {
    key: 'm5',
    member: 'pixel',
    amount: 200,
    reason: 'Destaque entre os recrutas no primeiro mês.',
    at: '2026-11-01T20:00:00.000Z',
  },
  {
    key: 'm6',
    member: 'zephyr',
    amount: 150,
    reason: 'Engajamento no onboarding e participação nos treinos abertos.',
    at: '2026-11-03T22:00:00.000Z',
  },
  {
    key: 'm7',
    member: 'raven',
    amount: -100,
    reason: 'Ajuste de lançamento duplicado identificado na auditoria.',
    at: '2026-11-03T23:30:00.000Z',
  },
];

const rewardsSeed = [
  {
    key: 'steam',
    name: 'Vale-presente Steam',
    description: 'Crédito de R$ 50 na Steam para usar no jogo que quiser.',
    image: 'https://images.unsplash.com/photo-1603481546238-487240415921?auto=format&fit=crop&w=900&q=80',
    price: 800,
    initialStock: 10,
    stock: 8,
    available: true,
  },
  {
    key: 'headset',
    name: 'Headset Gamer RGB',
    description: 'Headset com áudio surround 7.1, microfone destacável e iluminação RGB.',
    image: 'https://images.unsplash.com/photo-1599669454699-248893623440?auto=format&fit=crop&w=900&q=80',
    price: 1200,
    initialStock: 6,
    stock: 5,
    available: true,
  },
  {
    key: 'nitro',
    name: 'Assinatura Discord Nitro',
    description: 'Um mês de Nitro com uploads maiores, emojis personalizados e badges.',
    image: 'https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?auto=format&fit=crop&w=900&q=80',
    price: 1800,
    initialStock: 6,
    stock: 5,
    available: true,
  },
  {
    key: 'cup',
    name: 'Copo NavozCoin',
    description: 'Copo térmico oficial da família, edição limitada com logo em neon.',
    image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=80',
    price: 600,
    initialStock: 15,
    stock: 13,
    available: true,
  },
  {
    key: 'mousepad',
    name: 'Mousepad XL',
    description: 'Mousepad speed XL 90x40cm com bordas costuradas e base antiderrapante.',
    image: 'https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=900&q=80',
    price: 450,
    initialStock: 8,
    stock: 7,
    available: true,
  },
  {
    key: 'skin',
    name: 'Skin Exclusiva',
    description: 'Skin limitada para o campeão favorito do membro, entregue via código.',
    image: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=900&q=80',
    price: 1200,
    initialStock: 20,
    stock: 20,
    available: true,
  },
  {
    key: 'surpresa',
    name: 'Caixa Surpresa Gamer',
    description: 'Kit com acessórios e brindes surpresa selecionados pela liderança.',
    image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80',
    price: 1500,
    initialStock: 3,
    stock: 3,
    available: true,
  },
  {
    key: 'teclado',
    name: 'Teclado Mecânico',
    description: 'Teclado 75% hot-swap com switches lineares. Reposição de estoque em breve.',
    image: 'https://images.unsplash.com/photo-1595044426077-d36d9236d54a?auto=format&fit=crop&w=900&q=80',
    price: 3500,
    initialStock: 0,
    stock: 0,
    available: false,
  },
  {
    key: 'bone',
    name: 'Boné Edição Limitada',
    description: 'Boné da primeira temporada, arquivado após o fim do estoque.',
    image: 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=900&q=80',
    price: 700,
    initialStock: 0,
    stock: 0,
    available: false,
    archived: true,
  },
];

const redemptionsSeed = [
  {
    key: 'r1',
    member: 'luna',
    reward: 'steam',
    quantity: 1,
    status: 'delivered',
    requestedAt: '2026-10-15T21:00:00.000Z',
    decidedAt: '2026-10-16T18:00:00.000Z',
    deliveredAt: '2026-10-17T19:00:00.000Z',
  },
  {
    key: 'r2',
    member: 'draco',
    reward: 'mousepad',
    quantity: 1,
    status: 'delivered',
    requestedAt: '2026-09-28T20:00:00.000Z',
    decidedAt: '2026-09-29T15:00:00.000Z',
    deliveredAt: '2026-09-30T18:00:00.000Z',
  },
  {
    key: 'r3',
    member: 'kira',
    reward: 'headset',
    quantity: 1,
    status: 'approved',
    requestedAt: '2026-11-01T16:00:00.000Z',
    decidedAt: '2026-11-02T14:00:00.000Z',
  },
  {
    key: 'r4',
    member: 'nyx',
    reward: 'cup',
    quantity: 1,
    status: 'approved',
    requestedAt: '2026-10-29T22:00:00.000Z',
    decidedAt: '2026-10-30T14:00:00.000Z',
  },
  {
    key: 'r5',
    member: 'ghost',
    reward: 'skin',
    quantity: 1,
    status: 'rejected',
    requestedAt: '2026-11-01T15:00:00.000Z',
    decidedAt: '2026-11-02T14:00:00.000Z',
    rejectionReason: 'Solicitação duplicada. Os pontos foram liberados para uma nova tentativa.',
  },
  {
    key: 'r6',
    member: 'n4voz',
    reward: 'nitro',
    quantity: 1,
    status: 'pending',
    requestedAt: '2026-11-03T14:00:00.000Z',
  },
  {
    key: 'r7',
    member: 'vortex',
    reward: 'steam',
    quantity: 1,
    status: 'pending',
    requestedAt: '2026-11-01T21:30:00.000Z',
  },
  {
    key: 'r8',
    member: 'titan',
    reward: 'cup',
    quantity: 1,
    status: 'pending',
    requestedAt: '2026-11-03T15:00:00.000Z',
  },
];

function avatar(seed, background) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundColor=${background}&radius=14`;
}

function at(date, time = '21:00') {
  return new Date(`${date}T${time}:00-03:00`);
}

function utcDate(value) {
  return new Date(`${value}T12:00:00.000Z`);
}

async function main() {
  const db = await connect();
  console.log(`Conectado ao banco "${db.databaseName}".`);

  if (!RESET) {
    const existing = await db.collection('members').countDocuments();
    if (existing > 0) {
      console.log('O banco já contém membros. Nada foi alterado.');
      console.log('Para recriar a demonstração, execute: node scripts/seed.js --reset');
      process.exit(0);
    }
  }

  if (RESET) {
    console.log('Limpando collections do NavozCoin...');
    for (const name of COLLECTIONS) {
      try {
        await db.collection(name).drop();
      } catch (err) {
        if (err.codeName !== 'NamespaceNotFound') throw err;
      }
    }
  }

  await ensureIndexes();

  const now = new Date();
  const adminUsername = process.env.ADMIN_USERNAME || 'Navoz';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Navoz';
  const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || adminUsername;
  const adminId = new ObjectId();
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await db.collection('admins').insertOne({
    _id: adminId,
    username: adminUsername,
    usernameLower: adminUsername.toLowerCase(),
    displayName: adminDisplayName,
    passwordHash,
    role: 'owner',
    active: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  });

  const memberMap = new Map();
  const memberDocs = membersSeed.map((member) => {
    const id = new ObjectId();
    const doc = {
      _id: id,
      nickname: member.nickname,
      nicknameLower: member.nickname.toLowerCase(),
      playerId: member.playerId,
      avatar: avatar(member.nickname, '6d28d9'),
      role: member.role,
      joinedAt: utcDate(member.joinedAt),
      status: member.status,
      balance: 0,
      reserved: 0,
      totalEarned: 0,
      totalSpent: 0,
      eventsParticipated: 0,
      createdAt: utcDate(member.joinedAt),
      updatedAt: now,
      createdBy: adminId,
      ...(member.status === 'archived'
        ? { archivedAt: utcDate(member.archivedAt), archivedBy: adminId }
        : {}),
    };
    memberMap.set(member.key, doc);
    return doc;
  });
  await db.collection('members').insertMany(memberDocs);

  const seasonMap = new Map();
  const seasonDocs = seasonsSeed.map((season) => {
    const id = new ObjectId();
    const doc = {
      _id: id,
      name: season.name,
      nameLower: season.name.toLowerCase(),
      startDate: season.startDate,
      endDate: season.endDate,
      status: season.status,
      activatedAt: utcDate(season.startDate),
      endedAt: season.status === 'ended' ? utcDate(season.endDate) : null,
      createdBy: adminId,
      createdAt: utcDate(season.startDate),
      updatedAt: now,
    };
    seasonMap.set(season.key, doc);
    return doc;
  });
  await db.collection('seasons').insertMany(seasonDocs);

  const eventMap = new Map();
  const eventDocs = [];
  const participantDocs = [];
  const transactions = [];
  let sequence = 0;

  for (let eventIndex = 0; eventIndex < eventsSeed.length; eventIndex += 1) {
    const event = eventsSeed[eventIndex];
    const id = new ObjectId();
    const season = seasonMap.get(event.season);
    const completed = event.status === 'completed';
    const cancelled = event.status === 'cancelled';
    const scheduledCreatedAt = new Date(
      now.getTime() - (3 + (eventIndex % 5)) * 24 * 60 * 60 * 1000
    );
    const createdAt = completed
      ? new Date(at(event.date).getTime() - 7 * 24 * 60 * 60 * 1000)
      : scheduledCreatedAt;
    const finalizedAt = completed ? at(event.date, '23:30') : null;
    const presentCount = event.participants.length;
    const doc = {
      _id: id,
      name: event.name,
      description: event.description,
      date: event.date,
      time: event.time,
      category: event.category,
      pointsPerParticipant: event.points,
      seasonId: season._id,
      status: event.status,
      participantCount: completed ? presentCount : 0,
      pointsDistributed: completed ? presentCount * event.points : 0,
      presentCount: event.status === 'scheduled' || cancelled ? presentCount : presentCount,
      createdBy: adminId,
      createdAt,
      updatedAt: completed ? finalizedAt : createdAt,
      finalizedAt,
      finalizedBy: completed ? adminId : null,
      finalizedByName: completed ? adminDisplayName : null,
      cancelledAt: cancelled ? new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000) : null,
      cancelledBy: cancelled ? adminId : null,
    };
    eventMap.set(event.key, doc);
    eventDocs.push(doc);

    for (const memberKey of event.participants) {
      const member = memberMap.get(memberKey);
      if (!member) throw new Error(`Membro inexistente no seed: ${memberKey}`);
      participantDocs.push({
        eventId: id,
        memberId: member._id,
        present: true,
        pointsAwarded: completed ? event.points : 0,
        markedBy: adminId,
        markedAt: createdAt,
        awardedAt: completed ? finalizedAt : null,
        createdAt,
        updatedAt: completed ? finalizedAt : createdAt,
      });

      if (completed) {
        sequence += 1;
        transactions.push({
          _id: new ObjectId(),
          memberId: member._id,
          type: 'event',
          amount: event.points,
          balanceDelta: event.points,
          reservedDelta: 0,
          spentDelta: 0,
          rankingDelta: event.points,
          description: `Participação no evento "${event.name}"`,
          reason: `Presença confirmada no evento de ${event.date} ${event.time}`,
          adminId,
          adminName: adminDisplayName,
          eventId: id,
          seasonId: season._id,
          idempotencyKey: `seed:event:${event.key}:member:${member._id.toString()}`,
          createdAt: finalizedAt,
          _seq: sequence,
        });
      }
    }
  }
  await db.collection('events').insertMany(eventDocs);
  if (participantDocs.length) {
    await db.collection('eventParticipants').insertMany(participantDocs);
  }

  for (const manual of manualSeed) {
    const member = memberMap.get(manual.member);
    const season = manual.at < '2026-07-01' ? seasonMap.get('onix') : seasonMap.get('aurora');
    sequence += 1;
    transactions.push({
      _id: new ObjectId(),
      memberId: member._id,
      type: manual.amount >= 0 ? 'manual_add' : 'manual_remove',
      amount: manual.amount,
      balanceDelta: manual.amount,
      reservedDelta: 0,
      spentDelta: 0,
      rankingDelta: manual.amount,
      description:
        manual.amount >= 0 ? 'Pontos adicionados manualmente' : 'Pontos removidos manualmente',
      reason: manual.reason,
      adminId,
      adminName: adminDisplayName,
      seasonId: season._id,
      idempotencyKey: `seed:manual:${manual.key}`,
      createdAt: new Date(manual.at),
      _seq: sequence,
    });
  }

  const rewardMap = new Map();
  const rewardDocs = rewardsSeed.map((reward) => {
    const id = new ObjectId();
    const doc = {
      _id: id,
      name: reward.name,
      nameLower: reward.name.toLowerCase(),
      description: reward.description,
      image: reward.image,
      price: reward.price,
      stock: reward.stock,
      available: reward.available,
      archived: Boolean(reward.archived),
      createdBy: adminId,
      createdAt: utcDate('2026-01-15'),
      updatedAt: now,
    };
    rewardMap.set(reward.key, doc);
    return doc;
  });
  await db.collection('rewards').insertMany(rewardDocs);

  const redemptionDocs = [];
  for (const redemption of redemptionsSeed) {
    const member = memberMap.get(redemption.member);
    const reward = rewardMap.get(redemption.reward);
    const total = reward.price * redemption.quantity;
    const id = new ObjectId();
    const doc = {
      _id: id,
      memberId: member._id,
      rewardId: reward._id,
      memberNickname: member.nickname,
      memberAvatar: member.avatar,
      rewardName: reward.name,
      rewardImage: reward.image,
      unitPrice: reward.price,
      quantity: redemption.quantity,
      totalPoints: total,
      status: redemption.status,
      note: '',
      requestedBy: adminId,
      requestedByName: adminDisplayName,
      requestedAt: new Date(redemption.requestedAt),
      approvedAt:
        redemption.status === 'approved' || redemption.status === 'delivered'
          ? new Date(redemption.decidedAt)
          : null,
      approvedBy:
        redemption.status === 'approved' || redemption.status === 'delivered' ? adminId : null,
      deliveredAt: redemption.deliveredAt ? new Date(redemption.deliveredAt) : null,
      deliveredBy: redemption.deliveredAt ? adminId : null,
      rejectedAt: redemption.status === 'rejected' ? new Date(redemption.decidedAt) : null,
      rejectedBy: redemption.status === 'rejected' ? adminId : null,
      rejectionReason: redemption.rejectionReason || '',
      idempotencyKey: `seed:redemption:${redemption.key}`,
      createdAt: new Date(redemption.requestedAt),
      updatedAt: new Date(
        redemption.deliveredAt || redemption.decidedAt || redemption.requestedAt
      ),
    };
    redemptionDocs.push(doc);

    sequence += 1;
    transactions.push({
      _id: new ObjectId(),
      memberId: member._id,
      type: 'redemption_reserve',
      amount: -total,
      balanceDelta: -total,
      reservedDelta: total,
      spentDelta: 0,
      rankingDelta: 0,
      description: `Reserva de resgate — ${reward.name} × ${redemption.quantity}`,
      reason: 'Pontos reservados para resgate.',
      adminId,
      adminName: adminDisplayName,
      redemptionId: id,
      seasonId: null,
      idempotencyKey: `seed:redemption:${redemption.key}:reserve`,
      createdAt: new Date(redemption.requestedAt),
      _seq: sequence,
    });

    if (redemption.status === 'approved' || redemption.status === 'delivered') {
      sequence += 1;
      transactions.push({
        _id: new ObjectId(),
        memberId: member._id,
        type: 'redemption_approve',
        amount: 0,
        balanceDelta: 0,
        reservedDelta: -total,
        spentDelta: total,
        rankingDelta: 0,
        description: `Resgate aprovado — ${reward.name} × ${redemption.quantity}`,
        reason: 'Débito confirmado sobre pontos previamente reservados.',
        adminId,
        adminName: adminDisplayName,
        redemptionId: id,
        seasonId: null,
        idempotencyKey: `seed:redemption:${redemption.key}:approve`,
        createdAt: new Date(redemption.decidedAt),
        _seq: sequence,
      });
    }

    if (redemption.status === 'rejected') {
      sequence += 1;
      transactions.push({
        _id: new ObjectId(),
        memberId: member._id,
        type: 'redemption_refund',
        amount: total,
        balanceDelta: total,
        reservedDelta: -total,
        spentDelta: 0,
        rankingDelta: 0,
        description: `Reserva liberada — ${reward.name} × ${redemption.quantity}`,
        reason: `Resgate recusado: ${redemption.rejectionReason}`,
        adminId,
        adminName: adminDisplayName,
        redemptionId: id,
        seasonId: null,
        idempotencyKey: `seed:redemption:${redemption.key}:refund`,
        createdAt: new Date(redemption.decidedAt),
        _seq: sequence,
      });
    }
  }
  await db.collection('redemptions').insertMany(redemptionDocs);

  // Recalcula saldos a partir do ledger, na ordem cronológica, para consistência total.
  const txByMember = new Map();
  for (const tx of transactions) {
    const key = tx.memberId.toString();
    if (!txByMember.has(key)) txByMember.set(key, []);
    txByMember.get(key).push(tx);
  }

  const memberUpdates = [];
  for (const member of memberDocs) {
    const list = txByMember.get(member._id.toString()) || [];
    list.sort((a, b) => a.createdAt - b.createdAt || a._seq - b._seq);
    let balance = 0;
    let reserved = 0;
    let totalEarned = 0;
    let totalSpent = 0;
    let eventsParticipated = 0;

    for (const tx of list) {
      balance += tx.balanceDelta;
      reserved += tx.reservedDelta;
      totalEarned += tx.rankingDelta;
      totalSpent += tx.spentDelta;
      if (tx.type === 'event') eventsParticipated += 1;
      tx.balanceAfter = balance;
      tx.reservedAfter = reserved;
      if (balance < 0 || reserved < 0) {
        throw new Error(`Ledger inconsistente para ${member.nickname} em ${tx.idempotencyKey}`);
      }
    }

    memberUpdates.push({
      updateOne: {
        filter: { _id: member._id },
        update: {
          $set: {
            balance,
            reserved,
            totalEarned,
            totalSpent,
            eventsParticipated,
            updatedAt: now,
          },
        },
      },
    });
  }

  await db.collection('pointTransactions').insertMany(
    transactions.map(({ _seq, ...tx }) => tx)
  );

  // Atualiza os campos calculados (balanceAfter/reservedAfter) no ledger.
  if (transactions.length) {
    await db.collection('pointTransactions').bulkWrite(
      transactions.map((tx) => ({
        updateOne: {
          filter: { _id: tx._id },
          update: { $set: { balanceAfter: tx.balanceAfter, reservedAfter: tx.reservedAfter } },
        },
      }))
    );
  }
  await db.collection('members').bulkWrite(memberUpdates);

  // Logs de auditoria coerentes com as operações da demonstração.
  const logs = [];
  const addLog = (action, entityType, entityId, description, createdAt, metadata = {}) => {
    logs.push({
      adminId,
      adminName: adminDisplayName,
      action,
      entityType,
      entityId: String(entityId),
      description,
      metadata,
      ip: '187.45.12.88',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NavozCoin Demo',
      createdAt,
    });
  };

  for (const season of seasonDocs) {
    addLog(
      'season.created',
      'season',
      season._id,
      `Temporada "${season.name}" criada.`,
      new Date(season.createdAt.getTime() + 60 * 60 * 1000),
      { startDate: season.startDate, endDate: season.endDate }
    );
  }
  for (const member of memberDocs) {
    addLog(
      'member.created',
      'member',
      member._id,
      `Membro ${member.nickname} cadastrado.`,
      new Date(member.createdAt.getTime() + 2 * 60 * 60 * 1000),
      { nickname: member.nickname, playerId: member.playerId, role: member.role }
    );
  }
  for (const event of eventDocs) {
    addLog(
      'event.created',
      'event',
      event._id,
      `Evento "${event.name}" criado para ${event.date} às ${event.time}.`,
      event.createdAt,
      { category: event.category, pointsPerParticipant: event.pointsPerParticipant }
    );
    if (event.status === 'completed') {
      addLog(
        'event.finalized',
        'event',
        event._id,
        `Evento "${event.name}" finalizado: ${event.pointsDistributed} pontos distribuídos para ${event.participantCount} membro(s).`,
        event.finalizedAt,
        { participantCount: event.participantCount, pointsDistributed: event.pointsDistributed }
      );
    }
    if (event.status === 'cancelled') {
      addLog(
        'event.cancelled',
        'event',
        event._id,
        `Evento "${event.name}" cancelado. Nenhum ponto foi distribuído.`,
        event.cancelledAt
      );
    }
  }
  for (const reward of rewardDocs) {
    addLog(
      'reward.created',
      'reward',
      reward._id,
      `Presente "${reward.name}" cadastrado por ${reward.price} pontos.`,
      new Date(reward.createdAt.getTime() + 3 * 60 * 60 * 1000),
      { price: reward.price, stock: reward.stock }
    );
  }
  for (const manual of manualSeed) {
    const member = memberMap.get(manual.member);
    addLog(
      manual.amount >= 0 ? 'points.added' : 'points.removed',
      'member',
      member._id,
      `${Math.abs(manual.amount)} pontos ${manual.amount >= 0 ? 'adicionados a' : 'removidos de'} ${member.nickname}.`,
      new Date(manual.at),
      { amount: Math.abs(manual.amount), reason: manual.reason }
    );
  }
  for (const redemption of redemptionDocs) {
    const member = memberDocs.find((item) => item._id.equals(redemption.memberId));
    addLog(
      'redemption.created',
      'redemption',
      redemption._id,
      `Resgate solicitado: ${redemption.rewardName} × ${redemption.quantity} para ${member.nickname} (${redemption.totalPoints} pontos reservados).`,
      redemption.requestedAt,
      { totalPoints: redemption.totalPoints }
    );
    if (redemption.status === 'approved' || redemption.status === 'delivered') {
      addLog(
        'redemption.approved',
        'redemption',
        redemption._id,
        `Resgate de ${member.nickname} aprovado (${redemption.totalPoints} pontos).`,
        redemption.approvedAt,
        { totalPoints: redemption.totalPoints }
      );
    }
    if (redemption.status === 'delivered') {
      addLog(
        'redemption.delivered',
        'redemption',
        redemption._id,
        `Resgate de ${member.nickname} entregue.`,
        redemption.deliveredAt
      );
    }
    if (redemption.status === 'rejected') {
      addLog(
        'redemption.rejected',
        'redemption',
        redemption._id,
        `Resgate de ${member.nickname} recusado. ${redemption.totalPoints} pontos liberados.`,
        redemption.rejectedAt,
        { reason: redemption.rejectionReason, totalPoints: redemption.totalPoints }
      );
    }
  }
  for (const member of memberDocs.filter((item) => item.status === 'archived')) {
    addLog(
      'member.archived',
      'member',
      member._id,
      `Membro ${member.nickname} arquivado. Histórico preservado.`,
      member.archivedAt
    );
  }
  addLog(
    'auth.login',
    'admin',
    adminId,
    `${adminDisplayName} entrou no painel.`,
    new Date(Date.now() - 35 * 60 * 1000)
  );

  await db.collection('auditLogs').insertMany(logs);

  const activeCount = memberDocs.filter((item) => item.status === 'active').length;
  const totals = await db
    .collection('members')
    .aggregate([
      {
        $group: {
          _id: null,
          balance: { $sum: '$balance' },
          reserved: { $sum: '$reserved' },
          earned: { $sum: '$totalEarned' },
          spent: { $sum: '$totalSpent' },
        },
      },
    ])
    .toArray();

  console.log('');
  console.log('NavozCoin — demonstração criada com sucesso.');
  console.log(`  Admin:          ${adminUsername}`);
  console.log(`  Senha:          ${adminPassword === 'Navoz' ? 'Navoz (padrão de demonstração)' : '(definida em ADMIN_PASSWORD)'}`);
  console.log(`  Membros:        ${memberDocs.length} (${activeCount} ativos)`);
  console.log(`  Temporadas:     ${seasonDocs.length}`);
  console.log(`  Eventos:        ${eventDocs.length}`);
  console.log(`  Transações:     ${transactions.length}`);
  console.log(`  Presentes:      ${rewardDocs.length}`);
  console.log(`  Resgates:       ${redemptionDocs.length}`);
  console.log(`  Auditoria:      ${logs.length} registros`);
  console.log(
    `  Ledger:         saldo ${totals[0].balance} | reservado ${totals[0].reserved} | conquistado ${totals[0].earned} | resgatado ${totals[0].spent}`
  );
  console.log('');
  console.log('Troque a senha padrão antes de publicar o sistema.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Falha ao criar a demonstração:', err);
    process.exit(1);
  });
