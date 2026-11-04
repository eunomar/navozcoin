'use strict';

/**
 * NavozCoin — camada de acesso ao MongoDB Atlas.
 * Este módulo é usado somente pela função serverless (nunca pelo navegador).
 */

const { MongoClient } = require('mongodb');

const globalForDb = globalThis;

if (!globalForDb.__navozMongo) {
  globalForDb.__navozMongo = { client: null, db: null, promise: null, indexes: null };
}

const cache = globalForDb.__navozMongo;

function getUri() {
  const uri = (process.env.MONGODB_URI || '').trim();
  if (!uri) {
    const err = new Error('MONGODB_URI não configurada.');
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  return uri;
}

function getDbName() {
  if (process.env.MONGODB_DB && process.env.MONGODB_DB.trim()) {
    return process.env.MONGODB_DB.trim();
  }
  const uri = getUri();
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/i);
  return match && match[1] ? decodeURIComponent(match[1]) : 'navozcoin';
}

async function connect() {
  if (cache.db) return cache.db;
  if (cache.promise) return cache.promise;

  cache.promise = (async () => {
    const client = new MongoClient(getUri(), {
      appName: 'NavozCoin',
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 12000,
      connectTimeoutMS: 12000,
      retryWrites: true,
      retryReads: true,
    });

    await client.connect();
    const db = client.db(getDbName());
    await db.command({ ping: 1 });

    cache.client = client;
    cache.db = db;
    return db;
  })();

  try {
    return await cache.promise;
  } catch (err) {
    cache.promise = null;
    cache.client = null;
    cache.db = null;
    throw err;
  }
}

/**
 * Índices essenciais. Executado uma vez por instância da função.
 * A criação é idempotente no MongoDB.
 */
async function ensureIndexes() {
  if (cache.indexes) return cache.indexes;

  cache.indexes = (async () => {
    const db = await connect();

    const admins = db.collection('admins');
    const adminSessions = db.collection('adminSessions');
    const members = db.collection('members');
    const events = db.collection('events');
    const eventParticipants = db.collection('eventParticipants');
    const pointTransactions = db.collection('pointTransactions');
    const rewards = db.collection('rewards');
    const redemptions = db.collection('redemptions');
    const seasons = db.collection('seasons');
    const auditLogs = db.collection('auditLogs');
    const rateLimits = db.collection('rateLimits');

    await Promise.all([
      admins.createIndexes([
        { key: { usernameLower: 1 }, name: 'uniq_username', unique: true },
        { key: { active: 1 }, name: 'active' },
      ]),
      adminSessions.createIndexes([
        { key: { tokenHash: 1 }, name: 'uniq_token', unique: true },
        { key: { adminId: 1, createdAt: -1 }, name: 'admin_created' },
        { key: { expiresAt: 1 }, name: 'ttl_expires', expireAfterSeconds: 0 },
      ]),
      members.createIndexes([
        { key: { nicknameLower: 1 }, name: 'uniq_nickname', unique: true },
        { key: { playerId: 1 }, name: 'uniq_player_id', unique: true },
        { key: { status: 1, joinedAt: -1 }, name: 'status_joined' },
        { key: { status: 1, totalEarned: -1 }, name: 'status_earned' },
        { key: { robberyCards: -1 }, name: 'robbery_cards' },
        { key: { nickname: 'text', playerId: 'text' }, name: 'search_text' },
      ]),
      events.createIndexes([
        { key: { status: 1, date: 1, time: 1 }, name: 'status_date' },
        { key: { seasonId: 1, date: -1 }, name: 'season_date' },
        { key: { date: -1, time: -1 }, name: 'date_desc' },
        { key: { createdAt: -1 }, name: 'created' },
      ]),
      eventParticipants.createIndexes([
        { key: { eventId: 1, memberId: 1 }, name: 'uniq_event_member', unique: true },
        { key: { eventId: 1, present: 1 }, name: 'event_present' },
        { key: { memberId: 1 }, name: 'member' },
      ]),
      pointTransactions.createIndexes([
        { key: { idempotencyKey: 1 }, name: 'uniq_idempotency', unique: true },
        { key: { memberId: 1, createdAt: -1 }, name: 'member_created' },
        { key: { createdAt: -1 }, name: 'created' },
        { key: { type: 1, createdAt: -1 }, name: 'type_created' },
        { key: { eventId: 1 }, name: 'event', sparse: true },
        { key: { redemptionId: 1 }, name: 'redemption', sparse: true },
        { key: { seasonId: 1, createdAt: -1 }, name: 'season_created', sparse: true },
      ]),
      rewards.createIndexes([
        { key: { archived: 1, available: 1 }, name: 'status' },
        { key: { price: 1 }, name: 'price' },
        { key: { createdAt: -1 }, name: 'created' },
      ]),
      redemptions.createIndexes([
        { key: { idempotencyKey: 1 }, name: 'uniq_idempotency', unique: true },
        { key: { status: 1, createdAt: -1 }, name: 'status_created' },
        { key: { memberId: 1, createdAt: -1 }, name: 'member_created' },
        { key: { rewardId: 1 }, name: 'reward' },
      ]),
      seasons.createIndexes([
        { key: { nameLower: 1 }, name: 'uniq_name', unique: true },
        { key: { status: 1 }, name: 'status' },
        { key: { startDate: -1 }, name: 'start' },
      ]),
      auditLogs.createIndexes([
        { key: { createdAt: -1 }, name: 'created' },
        { key: { adminId: 1, createdAt: -1 }, name: 'admin_created' },
        { key: { entityType: 1, entityId: 1, createdAt: -1 }, name: 'entity' },
      ]),
      rateLimits.createIndexes([
        { key: { expiresAt: 1 }, name: 'ttl_expires', expireAfterSeconds: 0 },
      ]),
    ]);

    return true;
  })();

  try {
    return await cache.indexes;
  } catch (err) {
    cache.indexes = null;
    throw err;
  }
}

async function collections() {
  const db = await connect();
  return {
    db,
    admins: db.collection('admins'),
    adminSessions: db.collection('adminSessions'),
    members: db.collection('members'),
    events: db.collection('events'),
    eventParticipants: db.collection('eventParticipants'),
    pointTransactions: db.collection('pointTransactions'),
    rewards: db.collection('rewards'),
    redemptions: db.collection('redemptions'),
    seasons: db.collection('seasons'),
    auditLogs: db.collection('auditLogs'),
    rateLimits: db.collection('rateLimits'),
  };
}

/**
 * Transação com snapshot isolation. O Atlas é um replica set, portanto
 * transações multi-documento estão disponíveis.
 */
async function withTransaction(work) {
  await ensureIndexes();
  const client = cache.client;
  if (!client) await connect();

  const session = cache.client.startSession();
  try {
    let result;
    await session.withTransaction(
      async () => {
        result = await work(session);
      },
      {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      }
    );
    return result;
  } finally {
    await session.endSession();
  }
}

async function ping() {
  const db = await connect();
  await db.command({ ping: 1 });
  return true;
}

module.exports = {
  connect,
  collections,
  ensureIndexes,
  withTransaction,
  ping,
  getDbName,
};
