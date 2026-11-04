'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const { collections, ensureIndexes, withTransaction, ping } = require('./db');
const {
  HttpError,
  SESSION_TTL_SECONDS,
  sha256,
  setSessionCookies,
  clearSessionCookies,
  assertOrigin,
  securityHeaders,
  json,
  readJson,
  stringField,
  intField,
  boolField,
  dateField,
  timeField,
  optionalUrl,
  objectId,
  optionalObjectId,
  escapeRegex,
  idempotencyKey,
  pagination,
  applyLoginRateLimit,
  applySessionRateLimit,
  authenticate,
  createSession,
  ensureCsrf,
  publicAdmin,
  audit,
  getActiveSeason,
  todayString,
  serializeSeason,
} = require('./core');

const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo';
const MAX_EVENT_POINTS = 1_000_000;
const EVENT_CATEGORIES = [
  'Treinamento',
  'Campeonato',
  'Scrim',
  'Reunião',
  'Evento Especial',
  'Outro',
];
const MEMBER_ROLES = ['Líder', 'Vice-Líder', 'Oficial', 'Membro', 'Recruta', 'Convidado'];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function queryValue(req, key, fallback = '') {
  if (req.query && req.query[key] !== undefined) {
    const value = req.query[key];
    return Array.isArray(value) ? String(value[0] || '') : String(value);
  }
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    return url.searchParams.get(key) || fallback;
  } catch {
    return fallback;
  }
}

function routeSegments(req) {
  let path = '';
  const headerRoute = req.headers['x-navoz-route'];
  if (typeof headerRoute === 'string' && headerRoute.trim()) {
    path = headerRoute.trim().slice(0, 500);
  } else if (req.query && req.query.path !== undefined) {
    path = Array.isArray(req.query.path) ? req.query.path.join('/') : String(req.query.path);
    path = path.replace(/%2F/gi, '/');
  } else {
    try {
      path = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      path = req.url || '/';
    }
    path = path.replace(/^\/api(?:\/|$)/, '');
  }
  return path
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
}

async function requireAdmin(req, mutation) {
  const auth = await authenticate(req, { requireCsrf: mutation });
  if (mutation) {
    const limited = await applySessionRateLimit(auth.session);
    if (!limited.allowed) {
      throw new HttpError(429, 'RATE_LIMITED', 'Muitas operações. Aguarde alguns instantes.');
    }
  }
  return auth;
}

function serializeMember(member) {
  if (!member) return null;
  return {
    id: member._id.toString(),
    nickname: member.nickname,
    playerId: member.playerId,
    avatar: member.avatar || '',
    role: member.role || 'Membro',
    joinedAt: member.joinedAt,
    status: member.status,
    balance: Number(member.balance || 0),
    reserved: Number(member.reserved || 0),
    totalEarned: Number(member.totalEarned || 0),
    totalSpent: Number(member.totalSpent || 0),
    eventsParticipated: Number(member.eventsParticipated || 0),
    createdAt: member.createdAt,
    archivedAt: member.archivedAt || null,
  };
}

function serializeEvent(event) {
  if (!event) return null;
  return {
    id: event._id.toString(),
    name: event.name,
    description: event.description || '',
    date: event.date,
    time: event.time,
    category: event.category,
    pointsPerParticipant: Number(event.pointsPerParticipant || 0),
    seasonId: event.seasonId ? event.seasonId.toString() : null,
    seasonName: event.seasonName || null,
    status: event.status,
    participantCount: Number(event.participantCount || 0),
    pointsDistributed: Number(event.pointsDistributed || 0),
    createdAt: event.createdAt,
    finalizedAt: event.finalizedAt || null,
    finalizedBy: event.finalizedBy || null,
    finalizedByName: event.finalizedByName || null,
    cancelledAt: event.cancelledAt || null,
    presentCount: Number(event.presentCount || 0),
    totalProjected: Number(event.totalProjected || 0),
  };
}

function serializeTransaction(tx) {
  if (!tx) return null;
  return {
    id: tx._id.toString(),
    memberId: tx.memberId.toString(),
    type: tx.type,
    amount: Number(tx.amount || 0),
    balanceDelta: Number(tx.balanceDelta || 0),
    reservedDelta: Number(tx.reservedDelta || 0),
    spentDelta: Number(tx.spentDelta || 0),
    rankingDelta: Number(tx.rankingDelta || 0),
    description: tx.description || '',
    reason: tx.reason || '',
    adminId: tx.adminId ? tx.adminId.toString() : null,
    adminName: tx.adminName || 'Sistema',
    eventId: tx.eventId ? tx.eventId.toString() : null,
    redemptionId: tx.redemptionId ? tx.redemptionId.toString() : null,
    seasonId: tx.seasonId ? tx.seasonId.toString() : null,
    balanceAfter: Number(tx.balanceAfter || 0),
    reservedAfter: Number(tx.reservedAfter || 0),
    createdAt: tx.createdAt,
  };
}

function serializeReward(reward) {
  if (!reward) return null;
  return {
    id: reward._id.toString(),
    name: reward.name,
    description: reward.description || '',
    image: reward.image || '',
    price: Number(reward.price || 0),
    stock: Number(reward.stock || 0),
    available: Boolean(reward.available),
    archived: Boolean(reward.archived),
    createdAt: reward.createdAt,
    updatedAt: reward.updatedAt,
  };
}

function serializeRedemption(redemption) {
  if (!redemption) return null;
  return {
    id: redemption._id.toString(),
    memberId: redemption.memberId.toString(),
    rewardId: redemption.rewardId.toString(),
    memberNickname: redemption.memberNickname || '',
    memberAvatar: redemption.memberAvatar || '',
    rewardName: redemption.rewardName || '',
    rewardImage: redemption.rewardImage || '',
    unitPrice: Number(redemption.unitPrice || 0),
    quantity: Number(redemption.quantity || 0),
    totalPoints: Number(redemption.totalPoints || 0),
    status: redemption.status,
    note: redemption.note || '',
    rejectionReason: redemption.rejectionReason || '',
    requestedBy: redemption.requestedBy || null,
    requestedAt: redemption.requestedAt,
    approvedAt: redemption.approvedAt || null,
    deliveredAt: redemption.deliveredAt || null,
    rejectedAt: redemption.rejectedAt || null,
    createdAt: redemption.createdAt,
  };
}

function serializeAudit(log) {
  return {
    id: log._id.toString(),
    adminName: log.adminName || 'Sistema',
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    description: log.description,
    metadata: log.metadata || {},
    ip: log.ip || '',
    createdAt: log.createdAt,
  };
}

function periodStart(period) {
  const now = new Date();
  if (period === 'weekly') {
    const date = new Date(now);
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - day);
    return date;
  }
  if (period === 'monthly') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  return null;
}

function assertSearchSafe(value) {
  const text = String(value || '');
  if (text.length > 80) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Busca muito longa.');
  }
  return text;
}

function duplicateMessage(err) {
  if (!err || err.code !== 11000) return null;
  const key = Object.keys(err.keyPattern || {})[0] || '';
  if (key === 'nicknameLower') return 'Já existe um membro com esse nickname.';
  if (key === 'playerId') return 'Já existe um membro com esse ID de jogador.';
  if (key === 'usernameLower') return 'Esse usuário administrador já existe.';
  if (key === 'nameLower') return 'Já existe uma temporada com esse nome.';
  if (key === 'idempotencyKey') return 'Esta operação já foi processada.';
  if (key.includes('eventId')) return 'Este membro já está vinculado ao evento.';
  return 'Registro duplicado.';
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

async function login(req, res) {
  const body = await readJson(req);
  const username = stringField(body.username, 'Usuário', { min: 2, max: 40 });
  const password = stringField(body.password, 'Senha', { min: 1, max: 200, trim: false });

  const limit = await applyLoginRateLimit(req, username);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    throw new HttpError(
      429,
      'LOGIN_RATE_LIMITED',
      'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.'
    );
  }

  const { admins } = await collections();
  const admin = await admins.findOne({ usernameLower: username.toLowerCase() });

  // Comparação "dummy" para reduzir diferença de tempo entre usuário inexistente e senha errada.
  const fallbackHash = '$2b$12$ZFwr7f573uKrx/rXlAT2MuKcUxQ6cybRM0IDGaetJls7kHxwaKnuO';
  const passwordOk = await bcrypt.compare(password, admin ? admin.passwordHash : fallbackHash);

  if (!admin || !admin.active || !passwordOk) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Usuário ou senha inválidos.');
  }

  const session = await createSession(admin, req);
  const now = new Date();
  await admins.updateOne({ _id: admin._id }, { $set: { lastLoginAt: now, updatedAt: now } });
  setSessionCookies(req, res, session.token, session.csrf);
  await audit({
    admin,
    action: 'auth.login',
    entityType: 'admin',
    entityId: admin._id,
    description: `${admin.displayName || admin.username} entrou no painel.`,
    req,
  });

  return json(res, 200, {
    admin: publicAdmin({ ...admin, lastLoginAt: now }),
    csrfToken: session.csrf,
    expiresAt: session.expiresAt,
  });
}

async function me(req, res) {
  const auth = await requireAdmin(req, false);
  const csrf = await ensureCsrf(auth, req, res);
  const season = await getActiveSeason();
  return json(res, 200, {
    admin: publicAdmin(auth.admin),
    csrfToken: csrf,
    expiresAt: auth.session.expiresAt,
    activeSeason: serializeSeason(season),
    meta: {
      categories: EVENT_CATEGORIES,
      roles: MEMBER_ROLES,
      timezone: APP_TIMEZONE,
    },
  });
}

async function logout(req, res) {
  const auth = await requireAdmin(req, true);
  const { adminSessions } = await collections();
  await adminSessions.deleteOne({ _id: auth.session._id });
  clearSessionCookies(req, res);
  await audit({
    admin: auth.admin,
    action: 'auth.logout',
    entityType: 'admin',
    entityId: auth.admin._id,
    description: 'Sessão encerrada.',
    req,
  });
  return json(res, 200, { ok: true });
}

async function changePassword(req, res) {
  const auth = await requireAdmin(req, true);
  const body = await readJson(req);
  const currentPassword = stringField(body.currentPassword, 'Senha atual', {
    min: 1,
    max: 200,
    trim: false,
  });
  const newPassword = stringField(body.newPassword, 'Nova senha', {
    min: 8,
    max: 72,
    trim: false,
  });
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      'A nova senha deve conter pelo menos uma letra e um número.'
    );
  }

  const { admins, adminSessions } = await collections();
  const admin = await admins.findOne({ _id: auth.admin._id });
  if (!admin || !(await bcrypt.compare(currentPassword, admin.passwordHash))) {
    throw new HttpError(401, 'INVALID_PASSWORD', 'Senha atual incorreta.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await admins.updateOne(
    { _id: admin._id },
    { $set: { passwordHash, updatedAt: new Date() } }
  );
  // Encerra todas as outras sessões; mantém a sessão atual.
  await adminSessions.deleteMany({
    adminId: admin._id,
    _id: { $ne: auth.session._id },
  });
  await audit({
    admin,
    action: 'admin.password_changed',
    entityType: 'admin',
    entityId: admin._id,
    description: 'Senha do administrador alterada.',
    req,
  });
  return json(res, 200, { ok: true });
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

async function dashboard(req, res) {
  await requireAdmin(req, false);
  const {
    members,
    events,
    redemptions,
    pointTransactions,
    auditLogs,
    seasons,
  } = await collections();

  const today = todayString();
  const chartStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [
    memberSummary,
    activeMembers,
    archivedMembers,
    completedEvents,
    pendingEvents,
    cancelledEvents,
    pendingRedemptions,
    topDocs,
    upcomingRaw,
    activity,
    chartRows,
    activeSeason,
    pendingRedemptionSummary,
  ] = await Promise.all([
    members
      .aggregate([
        {
          $group: {
            _id: null,
            balance: { $sum: '$balance' },
            reserved: { $sum: '$reserved' },
            totalEarned: { $sum: '$totalEarned' },
            totalSpent: { $sum: '$totalSpent' },
            eventsParticipated: { $sum: '$eventsParticipated' },
          },
        },
      ])
      .toArray(),
    members.countDocuments({ status: 'active' }),
    members.countDocuments({ status: 'archived' }),
    events.countDocuments({ status: 'completed' }),
    events.countDocuments({ status: 'scheduled' }),
    events.countDocuments({ status: 'cancelled' }),
    redemptions.countDocuments({ status: 'pending' }),
    members.find({ status: 'active' }).sort({ totalEarned: -1 }).limit(5).toArray(),
    events
      .find({ status: 'scheduled' })
      .sort({ date: 1, time: 1 })
      .limit(5)
      .toArray(),
    auditLogs.find({}).sort({ createdAt: -1 }).limit(8).toArray(),
    pointTransactions
      .aggregate([
        { $match: { createdAt: { $gte: chartStart } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: APP_TIMEZONE,
              },
            },
            distributed: {
              $sum: {
                $cond: [{ $gt: ['$rankingDelta', 0] }, '$rankingDelta', 0],
              },
            },
            removed: {
              $sum: {
                $cond: [{ $lt: ['$rankingDelta', 0] }, { $abs: '$rankingDelta' }, 0],
              },
            },
            redeemed: { $sum: '$spentDelta' },
          },
        },
      ])
      .toArray(),
    seasons.findOne({ status: 'active' }),
    redemptions.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: null, total: { $sum: '$totalPoints' } } },
    ]).toArray(),
  ]);

  const summary = memberSummary[0] || {
    balance: 0,
    reserved: 0,
    totalEarned: 0,
    totalSpent: 0,
    eventsParticipated: 0,
  };

  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const labels = [];
  for (let index = 13; index >= 0; index -= 1) {
    labels.push(dateFormatter.format(new Date(Date.now() - index * 24 * 60 * 60 * 1000)));
  }
  const chartMap = new Map(chartRows.map((row) => [row._id, row]));
  const chart = {
    labels,
    distributed: labels.map((label) => Number((chartMap.get(label) || {}).distributed || 0)),
    removed: labels.map((label) => Number((chartMap.get(label) || {}).removed || 0)),
    redeemed: labels.map((label) => Number((chartMap.get(label) || {}).redeemed || 0)),
  };

  const seasonIds = upcomingRaw.map((event) => event.seasonId).filter(Boolean);
  const seasonDocs = seasonIds.length
    ? await seasons.find({ _id: { $in: seasonIds } }).toArray()
    : [];
  const seasonMap = new Map(seasonDocs.map((season) => [season._id.toString(), season.name]));
  const upcoming = upcomingRaw.map((event) =>
    serializeEvent({ ...event, seasonName: seasonMap.get(String(event.seasonId)) || null })
  );

  return json(res, 200, {
    stats: {
      activeMembers,
      archivedMembers,
      totalMembers: activeMembers + archivedMembers,
      pointsDistributed: Number(summary.totalEarned || 0),
      availablePoints: Number(summary.balance || 0),
      reservedPoints: Number(summary.reserved || 0),
      spentPoints: Number(summary.totalSpent || 0),
      eventsParticipated: Number(summary.eventsParticipated || 0),
      eventsCompleted: completedEvents,
      eventsPending: pendingEvents,
      eventsCancelled: cancelledEvents,
      redemptionsPending: pendingRedemptions,
      pendingRedemptionPoints: Number(
        (pendingRedemptionSummary[0] && pendingRedemptionSummary[0].total) || 0
      ),
      today,
    },
    topMembers: topDocs.map(serializeMember),
    upcomingEvents: upcoming,
    recentActivity: activity.map(serializeAudit),
    chart,
    activeSeason: serializeSeason(activeSeason),
  });
}

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

async function listMembers(req, res) {
  await requireAdmin(req, false);
  const { members } = await collections();
  const status = queryValue(req, 'status', 'active');
  const search = assertSearchSafe(queryValue(req, 'search', '')).trim();

  const filter = {};
  if (status === 'active' || status === 'archived') filter.status = status;
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ nickname: regex }, { playerId: regex }, { role: regex }];
  }

  const docs = await members
    .find(filter)
    .sort({ status: 1, totalEarned: -1, nickname: 1 })
    .limit(500)
    .toArray();

  return json(res, 200, {
    members: docs.map(serializeMember),
    total: docs.length,
  });
}

async function createMember(req, res) {
  const auth = await requireAdmin(req, true);
  const body = await readJson(req);
  const { members } = await collections();

  const nickname = stringField(body.nickname, 'Nickname', { min: 2, max: 24 });
  if (/[\u0000-\u001f\u007f<>]/.test(nickname)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'O nickname contém caracteres inválidos.');
  }
  const playerId = stringField(body.playerId, 'ID do jogador', { min: 2, max: 40 });
  if (/[\u0000-\u001f\u007f<>]/.test(playerId)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'O ID do jogador contém caracteres inválidos.');
  }
  const avatar = optionalUrl(body.avatar, 'Avatar');
  const role = stringField(body.role || 'Membro', 'Cargo', { min: 2, max: 30 });
  const joinedAt = dateField(body.joinedAt || todayString(), 'Data de entrada');

  const nicknameLower = nickname.toLowerCase();
  const existing = await members.findOne({
    $or: [{ nicknameLower }, { playerId }],
  });
  if (existing) {
    throw new HttpError(
      409,
      'MEMBER_EXISTS',
      existing.nicknameLower === nicknameLower
        ? 'Já existe um membro com esse nickname.'
        : 'Já existe um membro com esse ID de jogador.'
    );
  }

  const now = new Date();
  const doc = {
    nickname,
    nicknameLower,
    playerId,
    avatar,
    role,
    joinedAt,
    status: 'active',
    balance: 0,
    reserved: 0,
    totalEarned: 0,
    totalSpent: 0,
    eventsParticipated: 0,
    createdAt: now,
    updatedAt: now,
    createdBy: auth.admin._id,
  };

  let result;
  try {
    result = await members.insertOne(doc);
  } catch (err) {
    const message = duplicateMessage(err);
    if (message) throw new HttpError(409, 'MEMBER_EXISTS', message);
    throw err;
  }

  await audit({
    admin: auth.admin,
    action: 'member.created',
    entityType: 'member',
    entityId: result.insertedId,
    description: `Membro ${nickname} cadastrado.`,
    metadata: { nickname, playerId, role },
    req,
  });

  return json(res, 201, { member: serializeMember({ ...doc, _id: result.insertedId }) });
}

async function getMember(req, res, id) {
  await requireAdmin(req, false);
  const memberId = objectId(id, 'Membro');
  const {
    members,
    pointTransactions,
    eventParticipants,
    redemptions,
    events,
  } = await collections();

  const member = await members.findOne({ _id: memberId });
  if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado.');

  const [transactions, rank, participations, pendingRedemptions] = await Promise.all([
    pointTransactions
      .find({ memberId })
      .sort({ createdAt: -1 })
      .limit(150)
      .toArray(),
    members.countDocuments({
      status: 'active',
      totalEarned: { $gt: member.totalEarned },
    }),
    eventParticipants
      .aggregate([
        { $match: { memberId, present: true } },
        {
          $lookup: {
            from: 'events',
            localField: 'eventId',
            foreignField: '_id',
            as: 'event',
          },
        },
        { $unwind: '$event' },
        { $match: { 'event.status': 'completed' } },
        { $sort: { 'event.date': -1, 'event.time': -1 } },
        { $limit: 30 },
        {
          $project: {
            _id: 0,
            eventId: '$eventId',
            present: 1,
            pointsAwarded: 1,
            name: '$event.name',
            date: '$event.date',
            time: '$event.time',
            category: '$event.category',
          },
        },
      ])
      .toArray(),
    redemptions.countDocuments({
      memberId,
      status: { $in: ['pending', 'approved'] },
    }),
  ]);

  return json(res, 200, {
    member: serializeMember(member),
    rank: member.status === 'active' ? rank + 1 : null,
    transactions: transactions.map(serializeTransaction),
    participations,
    pendingRedemptions,
  });
}

async function updateMember(req, res, id) {
  const auth = await requireAdmin(req, true);
  const memberId = objectId(id, 'Membro');
  const body = await readJson(req);
  const { members } = await collections();

  const member = await members.findOne({ _id: memberId });
  if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado.');

  const updates = {};
  if (body.nickname !== undefined) {
    const nickname = stringField(body.nickname, 'Nickname', { min: 2, max: 24 });
    if (/[\u0000-\u001f\u007f<>]/.test(nickname)) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'O nickname contém caracteres inválidos.');
    }
    updates.nickname = nickname;
    updates.nicknameLower = nickname.toLowerCase();
  }
  if (body.playerId !== undefined) {
    const playerId = stringField(body.playerId, 'ID do jogador', { min: 2, max: 40 });
    if (/[\u0000-\u001f\u007f<>]/.test(playerId)) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'O ID do jogador contém caracteres inválidos.');
    }
    updates.playerId = playerId;
  }
  if (body.avatar !== undefined) updates.avatar = optionalUrl(body.avatar, 'Avatar');
  if (body.role !== undefined) {
    updates.role = stringField(body.role, 'Cargo', { min: 2, max: 30 });
  }
  if (body.joinedAt !== undefined) {
    updates.joinedAt = dateField(body.joinedAt, 'Data de entrada');
  }

  if (!Object.keys(updates).length) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Nenhum campo para atualizar.');
  }

  if (updates.nicknameLower || updates.playerId) {
    const conditions = [];
    if (updates.nicknameLower) conditions.push({ nicknameLower: updates.nicknameLower });
    if (updates.playerId) conditions.push({ playerId: updates.playerId });
    const duplicate = await members.findOne({
      _id: { $ne: memberId },
      $or: conditions,
    });
    if (duplicate) {
      throw new HttpError(
        409,
        'MEMBER_EXISTS',
        duplicate.nicknameLower === updates.nicknameLower
          ? 'Já existe um membro com esse nickname.'
          : 'Já existe um membro com esse ID de jogador.'
      );
    }
  }

  updates.updatedAt = new Date();
  try {
    await members.updateOne({ _id: memberId }, { $set: updates });
  } catch (err) {
    const message = duplicateMessage(err);
    if (message) throw new HttpError(409, 'MEMBER_EXISTS', message);
    throw err;
  }

  const updated = await members.findOne({ _id: memberId });
  await audit({
    admin: auth.admin,
    action: 'member.updated',
    entityType: 'member',
    entityId: memberId,
    description: `Cadastro de ${updated.nickname} atualizado.`,
    metadata: {
      fields: Object.keys(updates).filter((key) => key !== 'updatedAt'),
    },
    req,
  });

  return json(res, 200, { member: serializeMember(updated) });
}

async function archiveMember(req, res, id) {
  const auth = await requireAdmin(req, true);
  const memberId = objectId(id, 'Membro');
  const { members, redemptions } = await collections();
  const member = await members.findOne({ _id: memberId });
  if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado.');
  if (member.status === 'archived') {
    throw new HttpError(409, 'ALREADY_ARCHIVED', 'Este membro já está arquivado.');
  }

  const pending = await redemptions.countDocuments({
    memberId,
    status: { $in: ['pending', 'approved'] },
  });
  if (member.reserved > 0 || pending > 0) {
    throw new HttpError(
      409,
      'MEMBER_HAS_RESERVATIONS',
      'Resolva os resgates pendentes ou aprovados antes de arquivar este membro.'
    );
  }

  const now = new Date();
  await members.updateOne(
    { _id: memberId },
    { $set: { status: 'archived', archivedAt: now, archivedBy: auth.admin._id, updatedAt: now } }
  );
  await audit({
    admin: auth.admin,
    action: 'member.archived',
    entityType: 'member',
    entityId: memberId,
    description: `Membro ${member.nickname} arquivado. Histórico preservado.`,
    req,
  });
  return json(res, 200, { ok: true });
}

async function restoreMember(req, res, id) {
  const auth = await requireAdmin(req, true);
  const memberId = objectId(id, 'Membro');
  const { members } = await collections();
  const member = await members.findOne({ _id: memberId });
  if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado.');
  if (member.status === 'active') {
    throw new HttpError(409, 'ALREADY_ACTIVE', 'Este membro já está ativo.');
  }

  const duplicate = await members.findOne({
    _id: { $ne: memberId },
    $or: [{ nicknameLower: member.nicknameLower }, { playerId: member.playerId }],
  });
  if (duplicate) {
    throw new HttpError(
      409,
      'MEMBER_IDENTITY_IN_USE',
      'Nickname ou ID de jogador já está em uso por outro membro.'
    );
  }

  await members.updateOne(
    { _id: memberId },
    {
      $set: { status: 'active', updatedAt: new Date() },
      $unset: { archivedAt: '', archivedBy: '' },
    }
  );
  await audit({
    admin: auth.admin,
    action: 'member.restored',
    entityType: 'member',
    entityId: memberId,
    description: `Membro ${member.nickname} reativado.`,
    req,
  });
  return json(res, 200, { ok: true });
}

/* -------------------------------------------------------------------------- */
/* Manual points                                                              */
/* -------------------------------------------------------------------------- */

async function addPoints(req, res) {
  const auth = await requireAdmin(req, true);
  const body = await readJson(req);
  const memberId = objectId(body.memberId, 'Membro');
  const amount = intField(body.amount, 'Quantidade de pontos', { min: 1, max: 100_000_000 });
  const direction = body.direction === 'remove' ? 'remove' : body.direction === 'add' ? 'add' : null;
  if (!direction) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Direção deve ser "add" ou "remove".');
  }
  const reason = stringField(body.reason, 'Justificativa', { min: 3, max: 500 });
  const key = idempotencyKey(body.idempotencyKey, 'manual');

  const {
    members,
    pointTransactions,
    seasons,
  } = await collections();

  const existing = await pointTransactions.findOne({ idempotencyKey: key });
  if (existing) {
    const member = await members.findOne({ _id: existing.memberId });
    return json(res, 200, {
      duplicate: true,
      transaction: serializeTransaction(existing),
      member: serializeMember(member),
    });
  }

  let result;
  try {
    result = await withTransaction(async (session) => {
      const member = await members.findOne({ _id: memberId }, { session });
      if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado.');
      if (member.status !== 'active') {
        throw new HttpError(409, 'MEMBER_ARCHIVED', 'Membros arquivados não recebem movimentações.');
      }
      if (direction === 'remove' && member.balance < amount) {
        throw new HttpError(
          409,
          'INSUFFICIENT_BALANCE',
          `Saldo insuficiente. Disponível: ${member.balance} pontos.`
        );
      }

      const delta = direction === 'add' ? amount : -amount;
      const activeSeason = await seasons.findOne({ status: 'active' }, { session });
      const now = new Date();
      const updated = await members.findOneAndUpdate(
        { _id: memberId },
        {
          $inc: { balance: delta, totalEarned: delta },
          $set: { updatedAt: now },
        },
        { session, returnDocument: 'after' }
      );

      const tx = {
        memberId,
        type: direction === 'add' ? 'manual_add' : 'manual_remove',
        amount: delta,
        balanceDelta: delta,
        reservedDelta: 0,
        spentDelta: 0,
        rankingDelta: delta,
        description:
          direction === 'add' ? 'Pontos adicionados manualmente' : 'Pontos removidos manualmente',
        reason,
        adminId: auth.admin._id,
        adminName: auth.admin.displayName || auth.admin.username,
        seasonId: activeSeason ? activeSeason._id : null,
        idempotencyKey: key,
        balanceAfter: updated.balance,
        reservedAfter: updated.reserved,
        createdAt: now,
      };
      const inserted = await pointTransactions.insertOne(tx, { session });
      const transaction = { ...tx, _id: inserted.insertedId };

      await audit({
        admin: auth.admin,
        action: direction === 'add' ? 'points.added' : 'points.removed',
        entityType: 'member',
        entityId: memberId,
        description: `${amount} pontos ${direction === 'add' ? 'adicionados a' : 'removidos de'} ${member.nickname}.`,
        metadata: { amount, reason, transactionId: inserted.insertedId.toString() },
        req,
        session,
      });

      return {
        duplicate: false,
        transaction: serializeTransaction(transaction),
        member: serializeMember(updated),
      };
    });
  } catch (err) {
    if (err && err.code === 11000) {
      const duplicate = await pointTransactions.findOne({ idempotencyKey: key });
      if (duplicate) {
        const member = await members.findOne({ _id: duplicate.memberId });
        return json(res, 200, {
          duplicate: true,
          transaction: serializeTransaction(duplicate),
          member: serializeMember(member),
        });
      }
    }
    throw err;
  }

  return json(res, 201, result);
}

async function listTransactions(req, res) {
  await requireAdmin(req, false);
  const { pointTransactions } = await collections();
  const { page, limit, skip } = pagination(req.query || {});
  const filter = {};

  const memberId = queryValue(req, 'memberId');
  if (memberId) filter.memberId = objectId(memberId, 'Membro');
  const type = queryValue(req, 'type');
  if (type) {
    const allowed = [
      'event',
      'manual_add',
      'manual_remove',
      'redemption_reserve',
      'redemption_approve',
      'redemption_refund',
      'correction',
    ];
    if (!allowed.includes(type)) throw new HttpError(422, 'VALIDATION_ERROR', 'Tipo inválido.');
    filter.type = type;
  }

  const [docs, total] = await Promise.all([
    pointTransactions.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    pointTransactions.countDocuments(filter),
  ]);

  return json(res, 200, {
    transactions: docs.map(serializeTransaction),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

async function listEvents(req, res) {
  await requireAdmin(req, false);
  const { events } = await collections();
  const status = queryValue(req, 'status');
  const seasonIdRaw = queryValue(req, 'seasonId');
  const search = assertSearchSafe(queryValue(req, 'search', '')).trim();

  const match = {};
  if (['scheduled', 'completed', 'cancelled'].includes(status)) match.status = status;
  if (seasonIdRaw) match.seasonId = objectId(seasonIdRaw, 'Temporada');
  if (search) match.name = new RegExp(escapeRegex(search), 'i');

  const sort = status === 'completed' || status === 'cancelled'
    ? { date: -1, time: -1 }
    : { date: 1, time: 1 };

  const docs = await events
    .aggregate([
      { $match: match },
      { $sort: sort },
      { $limit: 500 },
      {
        $lookup: {
          from: 'eventParticipants',
          let: { eventId: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$eventId', '$$eventId'] }, '$present'] } } },
            { $count: 'count' },
          ],
          as: 'presentAgg',
        },
      },
      {
        $lookup: {
          from: 'seasons',
          localField: 'seasonId',
          foreignField: '_id',
          as: 'season',
        },
      },
      {
        $addFields: {
          presentCount: {
            $ifNull: [{ $arrayElemAt: ['$presentAgg.count', 0] }, 0],
          },
          seasonName: { $arrayElemAt: ['$season.name', 0] },
          totalProjected: {
            $multiply: [
              { $ifNull: [{ $arrayElemAt: ['$presentAgg.count', 0] }, 0] },
              '$pointsPerParticipant',
            ],
          },
        },
      },
      { $project: { presentAgg: 0, season: 0 } },
    ])
    .toArray();

  return json(res, 200, { events: docs.map(serializeEvent), total: docs.length });
}

async function createEvent(req, res) {
  const auth = await requireAdmin(req, true);
  const body = await readJson(req);
  const { events, seasons } = await collections();

  const name = stringField(body.name, 'Nome do evento', { min: 3, max: 80 });
  const description = stringField(body.description || '', 'Descrição', {
    min: 0,
    max: 800,
    optional: true,
  });
  const date = dateField(body.date, 'Data');
  const time = timeField(body.time, 'Horário');
  const category = stringField(body.category || 'Treinamento', 'Categoria', {
    min: 2,
    max: 40,
  });
  const pointsPerParticipant = intField(body.pointsPerParticipant, 'Pontuação por participação', {
    min: 1,
    max: MAX_EVENT_POINTS,
  });
  const seasonId = optionalObjectId(body.seasonId, 'Temporada');
  if (seasonId) {
    const season = await seasons.findOne({ _id: seasonId });
    if (!season) throw new HttpError(404, 'SEASON_NOT_FOUND', 'Temporada não encontrada.');
  }

  const now = new Date();
  const doc = {
    name,
    description,
    date,
    time,
    category,
    pointsPerParticipant,
    seasonId,
    status: 'scheduled',
    participantCount: 0,
    pointsDistributed: 0,
    presentCount: 0,
    createdBy: auth.admin._id,
    createdAt: now,
    updatedAt: now,
  };
  const inserted = await events.insertOne(doc);
  await audit({
    admin: auth.admin,
    action: 'event.created',
    entityType: 'event',
    entityId: inserted.insertedId,
    description: `Evento "${name}" criado para ${date} às ${time}.`,
    metadata: { category, pointsPerParticipant, seasonId: seasonId ? seasonId.toString() : null },
    req,
  });

  return json(res, 201, {
    event: serializeEvent({ ...doc, _id: inserted.insertedId }),
  });
}

async function getEvent(req, res, id) {
  await requireAdmin(req, false);
  const eventId = objectId(id, 'Evento');
  const { events, eventParticipants, members, seasons } = await collections();
  const event = await events.findOne({ _id: eventId });
  if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Evento não encontrado.');

  const [participants, season] = await Promise.all([
    eventParticipants.find({ eventId }).toArray(),
    event.seasonId ? seasons.findOne({ _id: event.seasonId }) : Promise.resolve(null),
  ]);

  const participantMap = new Map(
    participants.map((participant) => [participant.memberId.toString(), participant])
  );
  const participantIds = participants.map((participant) => participant.memberId);

  const memberFilter =
    event.status === 'scheduled'
      ? { status: 'active' }
      : { $or: [{ status: 'active' }, { _id: { $in: participantIds } }] };

  const memberDocs = await members
    .find(memberFilter)
    .sort({ nickname: 1 })
    .limit(1000)
    .toArray();

  const memberRows = memberDocs.map((member) => {
    const participant = participantMap.get(member._id.toString());
    return {
      ...serializeMember(member),
      present: Boolean(participant && participant.present),
      pointsAwarded: participant ? Number(participant.pointsAwarded || 0) : 0,
      markedAt: participant ? participant.markedAt || null : null,
    };
  });

  const presentRows = memberRows.filter((row) => row.present);
  return json(res, 200, {
    event: serializeEvent({ ...event, seasonName: season ? season.name : null }),
    members: memberRows,
    participantCount: presentRows.length,
    totalProjected: presentRows.length * event.pointsPerParticipant,
    season: serializeSeason(season),
    readOnly: event.status !== 'scheduled',
  });
}

async function updateEvent(req, res, id) {
  const auth = await requireAdmin(req, true);
  const eventId = objectId(id, 'Evento');
  const body = await readJson(req);
  const { events, seasons } = await collections();
  const event = await events.findOne({ _id: eventId });
  if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Evento não encontrado.');
  if (event.status !== 'scheduled') {
    throw new HttpError(409, 'EVENT_LOCKED', 'Somente eventos agendados podem ser editados.');
  }

  const updates = {};
  if (body.name !== undefined) updates.name = stringField(body.name, 'Nome do evento', { min: 3, max: 80 });
  if (body.description !== undefined) {
    updates.description = stringField(body.description, 'Descrição', {
      min: 0,
      max: 800,
      optional: true,
    });
  }
  if (body.date !== undefined) updates.date = dateField(body.date, 'Data');
  if (body.time !== undefined) updates.time = timeField(body.time, 'Horário');
  if (body.category !== undefined) {
    updates.category = stringField(body.category, 'Categoria', { min: 2, max: 40 });
  }
  if (body.pointsPerParticipant !== undefined) {
    updates.pointsPerParticipant = intField(
      body.pointsPerParticipant,
      'Pontuação por participação',
      { min: 1, max: MAX_EVENT_POINTS }
    );
  }
  if (body.seasonId !== undefined) {
    const seasonId = optionalObjectId(body.seasonId, 'Temporada');
    if (seasonId) {
      const season = await seasons.findOne({ _id: seasonId });
      if (!season) throw new HttpError(404, 'SEASON_NOT_FOUND', 'Temporada não encontrada.');
    }
    updates.seasonId = seasonId;
  }
  if (!Object.keys(updates).length) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Nenhum campo para atualizar.');
  }
  updates.updatedAt = new Date();

  await events.updateOne({ _id: eventId, status: 'scheduled' }, { $set: updates });
  const updated = await events.findOne({ _id: eventId });
  await audit({
    admin: auth.admin,
    action: 'event.updated',
    entityType: 'event',
    entityId: eventId,
    description: `Evento "${updated.name}" atualizado.`,
    metadata: { fields: Object.keys(updates).filter((key) => key !== 'updatedAt') },
    req,
  });
  return json(res, 200, { event: serializeEvent(updated) });
}

async function setAttendance(req, res, id) {
  const auth = await requireAdmin(req, true);
  const eventId = objectId(id, 'Evento');
  const body = await readJson(req);
  const memberId = objectId(body.memberId, 'Membro');
  if (typeof body.present !== 'boolean') {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Presença deve ser verdadeira ou falsa.');
  }

  const {
    events,
    eventParticipants,
    members,
  } = await collections();

  const result = await withTransaction(async (session) => {
    const event = await events.findOne({ _id: eventId }, { session });
    if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Evento não encontrado.');
    if (event.status !== 'scheduled') {
      throw new HttpError(
        409,
        'EVENT_LOCKED',
        'A presença não pode ser alterada em eventos finalizados ou cancelados.'
      );
    }
    const member = await members.findOne({ _id: memberId }, { session });
    if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado.');
    if (member.status !== 'active') {
      throw new HttpError(409, 'MEMBER_ARCHIVED', 'Somente membros ativos podem ser marcados.');
    }

    const now = new Date();
    // Atualiza o evento para que a finalização concorrente detecte conflito de escrita.
    await events.updateOne(
      { _id: eventId, status: 'scheduled' },
      { $set: { updatedAt: now } },
      { session }
    );

    await eventParticipants.updateOne(
      { eventId, memberId },
      {
        $set: { present: body.present, markedBy: auth.admin._id, markedAt: now, updatedAt: now },
        $setOnInsert: {
          eventId,
          memberId,
          pointsAwarded: 0,
          createdAt: now,
        },
      },
      { upsert: true, session }
    );

    const presentCount = await eventParticipants.countDocuments(
      { eventId, present: true },
      { session }
    );

    await audit({
      admin: auth.admin,
      action: 'event.attendance',
      entityType: 'event',
      entityId: eventId,
      description: `${body.present ? 'Presença marcada' : 'Presença desmarcada'} — ${member.nickname}.`,
      metadata: { memberId: memberId.toString(), present: body.present },
      req,
      session,
    });

    return { present: body.present, presentCount };
  });

  return json(res, 200, result);
}

async function finalizeEvent(req, res, id) {
  const auth = await requireAdmin(req, true);
  const eventId = objectId(id, 'Evento');
  const {
    events,
    eventParticipants,
    members,
    pointTransactions,
  } = await collections();

  try {
    const result = await withTransaction(async (session) => {
      const event = await events.findOne({ _id: eventId }, { session });
      if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Evento não encontrado.');

      if (event.status === 'completed') {
        return {
          alreadyFinalized: true,
          event: serializeEvent(event),
          participantCount: event.participantCount,
          pointsDistributed: event.pointsDistributed,
        };
      }
      if (event.status !== 'scheduled') {
        throw new HttpError(
          409,
          'EVENT_NOT_SCHEDULED',
          'Somente eventos agendados podem ser finalizados.'
        );
      }

      const present = await eventParticipants
        .find({ eventId, present: true }, { session })
        .toArray();
      if (!present.length) {
        throw new HttpError(
          409,
          'NO_PARTICIPANTS',
          'Marque a presença de pelo menos um membro antes de finalizar.'
        );
      }

      // Claim atômico dentro da transação: qualquer outra finalização concorrente
      // entra em conflito de escrita e é reexecutada, encontrando o status completed.
      const claimed = await events.updateOne(
        { _id: eventId, status: 'scheduled' },
        { $set: { status: 'completed', finalizedAt: new Date(), updatedAt: new Date() } },
        { session }
      );
      if (claimed.modifiedCount !== 1) {
        throw new HttpError(409, 'EVENT_ALREADY_PROCESSED', 'Evento já processado.');
      }

      const now = new Date();
      let distributed = 0;
      let awardedCount = 0;

      for (const participant of present) {
        const member = await members.findOne({ _id: participant.memberId }, { session });
        if (!member) {
          throw new HttpError(
            409,
            'MEMBER_NOT_FOUND',
            'Um dos participantes não existe mais. Revise a presença do evento.'
          );
        }
        const points = event.pointsPerParticipant;
        const updatedMember = await members.findOneAndUpdate(
          { _id: participant.memberId },
          {
            $inc: {
              balance: points,
              totalEarned: points,
              eventsParticipated: 1,
            },
            $set: { updatedAt: now },
          },
          { session, returnDocument: 'after' }
        );

        const idKey = `event:${eventId.toString()}:member:${participant.memberId.toString()}`;
        await pointTransactions.insertOne(
          {
            memberId: participant.memberId,
            type: 'event',
            amount: points,
            balanceDelta: points,
            reservedDelta: 0,
            spentDelta: 0,
            rankingDelta: points,
            description: `Participação no evento "${event.name}"`,
            reason: `Presença confirmada no evento de ${event.date} ${event.time}`,
            adminId: auth.admin._id,
            adminName: auth.admin.displayName || auth.admin.username,
            eventId,
            seasonId: event.seasonId || null,
            idempotencyKey: idKey,
            balanceAfter: updatedMember.balance,
            reservedAfter: updatedMember.reserved,
            createdAt: now,
          },
          { session }
        );

        await eventParticipants.updateOne(
          { _id: participant._id },
          {
            $set: {
              pointsAwarded: points,
              awardedAt: now,
              updatedAt: now,
            },
          },
          { session }
        );

        distributed += points;
        awardedCount += 1;
      }

      await events.updateOne(
        { _id: eventId },
        {
          $set: {
            participantCount: awardedCount,
            pointsDistributed: distributed,
            finalizedBy: auth.admin._id,
            finalizedByName: auth.admin.displayName || auth.admin.username,
            updatedAt: now,
          },
        },
        { session }
      );

      await audit({
        admin: auth.admin,
        action: 'event.finalized',
        entityType: 'event',
        entityId: eventId,
        description: `Evento "${event.name}" finalizado: ${distributed} pontos distribuídos para ${awardedCount} membro(s).`,
        metadata: { participantCount: awardedCount, pointsDistributed: distributed },
        req,
        session,
      });

      const finalized = await events.findOne({ _id: eventId }, { session });
      return {
        alreadyFinalized: false,
        event: serializeEvent(finalized),
        participantCount: awardedCount,
        pointsDistributed: distributed,
      };
    });

    return json(res, 200, result);
  } catch (err) {
    if (err && err.code === 11000) {
      throw new HttpError(
        409,
        'EVENT_ALREADY_PROCESSED',
        'Este evento já foi processado e os pontos não podem ser duplicados.'
      );
    }
    throw err;
  }
}

async function cancelEvent(req, res, id) {
  const auth = await requireAdmin(req, true);
  const eventId = objectId(id, 'Evento');
  const { events } = await collections();
  const event = await events.findOne({ _id: eventId });
  if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Evento não encontrado.');
  if (event.status === 'cancelled') {
    throw new HttpError(409, 'EVENT_ALREADY_CANCELLED', 'Este evento já está cancelado.');
  }
  if (event.status !== 'scheduled') {
    throw new HttpError(
      409,
      'EVENT_LOCKED',
      'Eventos finalizados não podem ser cancelados.'
    );
  }

  const now = new Date();
  await events.updateOne(
    { _id: eventId, status: 'scheduled' },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: auth.admin._id,
        updatedAt: now,
      },
    }
  );
  await audit({
    admin: auth.admin,
    action: 'event.cancelled',
    entityType: 'event',
    entityId: eventId,
    description: `Evento "${event.name}" cancelado. Nenhum ponto foi distribuído.`,
    req,
  });
  return json(res, 200, { ok: true });
}

/* -------------------------------------------------------------------------- */
/* Rankings                                                                   */
/* -------------------------------------------------------------------------- */

async function rankings(req, res) {
  await requireAdmin(req, false);
  const { members, pointTransactions, seasons } = await collections();
  const period = queryValue(req, 'period', 'general');
  const seasonIdRaw = queryValue(req, 'seasonId');
  const allowed = ['general', 'weekly', 'monthly', 'season'];
  if (!allowed.includes(period)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Período de ranking inválido.');
  }

  let season = null;
  if (period === 'season') {
    if (seasonIdRaw) {
      season = await seasons.findOne({ _id: objectId(seasonIdRaw, 'Temporada') });
    } else {
      season = await getActiveSeason();
    }
    if (!season) {
      throw new HttpError(404, 'SEASON_NOT_FOUND', 'Nenhuma temporada encontrada.');
    }
  }

  let entries = [];

  if (period === 'general') {
    const docs = await members
      .find({ status: 'active' })
      .sort({ totalEarned: -1, nickname: 1 })
      .limit(500)
      .toArray();
    entries = docs.map((member, index) => ({
      position: index + 1,
      member: serializeMember(member),
      periodPoints: member.totalEarned,
      earned: member.totalEarned,
      spent: member.totalSpent,
    }));
  } else {
    const match = { rankingDelta: { $ne: 0 } };
    if (period === 'season') {
      match.seasonId = season._id;
    } else {
      match.createdAt = { $gte: periodStart(period) };
    }

    const rows = await pointTransactions
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: '$memberId',
            periodPoints: { $sum: '$rankingDelta' },
            earned: {
              $sum: { $cond: [{ $gt: ['$rankingDelta', 0] }, '$rankingDelta', 0] },
            },
            spent: { $sum: '$spentDelta' },
            lastAt: { $max: '$createdAt' },
          },
        },
        {
          $lookup: {
            from: 'members',
            localField: '_id',
            foreignField: '_id',
            as: 'member',
          },
        },
        { $unwind: '$member' },
        { $match: { 'member.status': 'active' } },
        { $sort: { periodPoints: -1, 'member.nickname': 1 } },
        { $limit: 500 },
      ])
      .toArray();

    entries = rows.map((row, index) => ({
      position: index + 1,
      member: serializeMember(row.member),
      periodPoints: Number(row.periodPoints || 0),
      earned: Number(row.earned || 0),
      spent: Number(row.member.totalSpent || 0),
    }));
  }

  return json(res, 200, {
    period,
    season: serializeSeason(season),
    entries,
    total: entries.length,
    generatedAt: new Date(),
  });
}

/* -------------------------------------------------------------------------- */
/* Seasons                                                                    */
/* -------------------------------------------------------------------------- */

async function listSeasons(req, res) {
  await requireAdmin(req, false);
  const { seasons, events, pointTransactions } = await collections();
  const docs = await seasons.find({}).sort({ startDate: -1 }).toArray();

  const [eventAgg, pointsAgg] = await Promise.all([
    events
      .aggregate([
        { $match: { seasonId: { $ne: null } } },
        {
          $group: {
            _id: '$seasonId',
            events: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
            },
          },
        },
      ])
      .toArray(),
    pointTransactions
      .aggregate([
        { $match: { seasonId: { $ne: null } } },
        {
          $group: {
            _id: '$seasonId',
            points: { $sum: '$rankingDelta' },
          },
        },
      ])
      .toArray(),
  ]);

  const eventMap = new Map(eventAgg.map((row) => [row._id.toString(), row]));
  const pointMap = new Map(pointsAgg.map((row) => [row._id.toString(), row]));

  return json(res, 200, {
    seasons: docs.map((season) => {
      const eventRow = eventMap.get(season._id.toString()) || {};
      const pointRow = pointMap.get(season._id.toString()) || {};
      return {
        ...serializeSeason(season),
        eventCount: eventRow.events || 0,
        completedEvents: eventRow.completed || 0,
        points: Number(pointRow.points || 0),
      };
    }),
  });
}

async function createSeason(req, res) {
  const auth = await requireAdmin(req, true);
  const body = await readJson(req);
  const { seasons } = await collections();

  const name = stringField(body.name, 'Nome da temporada', { min: 3, max: 60 });
  const startDate = dateField(body.startDate, 'Início');
  const endDate = dateField(body.endDate, 'Término');
  if (endDate < startDate) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'O término deve ser posterior ao início.');
  }
  const activate = boolField(body.activate, false);

  const duplicate = await seasons.findOne({ nameLower: name.toLowerCase() });
  if (duplicate) {
    throw new HttpError(409, 'SEASON_EXISTS', 'Já existe uma temporada com esse nome.');
  }

  const now = new Date();
  const seasonId = new ObjectId();
  const doc = {
    _id: seasonId,
    name,
    nameLower: name.toLowerCase(),
    startDate,
    endDate,
    status: activate ? 'active' : 'draft',
    activatedAt: activate ? now : null,
    endedAt: null,
    createdBy: auth.admin._id,
    createdAt: now,
    updatedAt: now,
  };

  if (activate) {
    await withTransaction(async (session) => {
      await seasons.updateMany(
        { status: 'active' },
        { $set: { status: 'ended', endedAt: now, updatedAt: now } },
        { session }
      );
      await seasons.insertOne(doc, { session });
      await audit({
        admin: auth.admin,
        action: 'season.created',
        entityType: 'season',
        entityId: seasonId,
        description: `Temporada "${name}" criada e ativada.`,
        req,
        session,
      });
    });
  } else {
    await seasons.insertOne(doc);
    await audit({
      admin: auth.admin,
      action: 'season.created',
      entityType: 'season',
      entityId: seasonId,
      description: `Temporada "${name}" criada.`,
      req,
    });
  }

  return json(res, 201, { season: serializeSeason(doc) });
}

async function activateSeason(req, res, id) {
  const auth = await requireAdmin(req, true);
  const seasonId = objectId(id, 'Temporada');
  const { seasons } = await collections();
  const season = await seasons.findOne({ _id: seasonId });
  if (!season) throw new HttpError(404, 'SEASON_NOT_FOUND', 'Temporada não encontrada.');
  if (season.status === 'active') {
    throw new HttpError(409, 'SEASON_ALREADY_ACTIVE', 'Esta temporada já está ativa.');
  }
  if (season.status === 'ended') {
    throw new HttpError(
      409,
      'SEASON_ENDED',
      'Temporadas encerradas não podem ser reativadas. Crie uma nova temporada.'
    );
  }

  const now = new Date();
  await withTransaction(async (session) => {
    const previous = await seasons
      .find({ status: 'active' }, { session })
      .toArray();
    await seasons.updateMany(
      { status: 'active' },
      { $set: { status: 'ended', endedAt: now, updatedAt: now } },
      { session }
    );
    await seasons.updateOne(
      { _id: seasonId, status: 'draft' },
      {
        $set: {
          status: 'active',
          activatedAt: now,
          updatedAt: now,
        },
      },
      { session }
    );
    await audit({
      admin: auth.admin,
      action: 'season.activated',
      entityType: 'season',
      entityId: seasonId,
      description: `Temporada "${season.name}" ativada.`,
      metadata: {
        previousSeason: previous.length ? previous[0].name : null,
      },
      req,
      session,
    });
  });

  return json(res, 200, {
    season: serializeSeason({ ...season, status: 'active', activatedAt: now }),
  });
}

async function closeSeason(req, res, id) {
  const auth = await requireAdmin(req, true);
  const seasonId = objectId(id, 'Temporada');
  const { seasons } = await collections();
  const season = await seasons.findOne({ _id: seasonId });
  if (!season) throw new HttpError(404, 'SEASON_NOT_FOUND', 'Temporada não encontrada.');
  if (season.status !== 'active') {
    throw new HttpError(409, 'SEASON_NOT_ACTIVE', 'Somente a temporada ativa pode ser encerrada.');
  }

  const now = new Date();
  await seasons.updateOne(
    { _id: seasonId, status: 'active' },
    { $set: { status: 'ended', endedAt: now, updatedAt: now } }
  );
  await audit({
    admin: auth.admin,
    action: 'season.closed',
    entityType: 'season',
    entityId: seasonId,
    description: `Temporada "${season.name}" encerrada. Carteiras e históricos preservados.`,
    req,
  });
  return json(res, 200, { ok: true });
}

/* -------------------------------------------------------------------------- */
/* Rewards                                                                    */
/* -------------------------------------------------------------------------- */

async function listRewards(req, res) {
  await requireAdmin(req, false);
  const { rewards } = await collections();
  const status = queryValue(req, 'status', 'all');
  const search = assertSearchSafe(queryValue(req, 'search', '')).trim();
  const filter = {};
  if (status === 'available') {
    filter.archived = false;
    filter.available = true;
  } else if (status === 'archived') {
    filter.archived = true;
  } else if (status === 'active') {
    filter.archived = false;
  }
  if (search) filter.name = new RegExp(escapeRegex(search), 'i');

  const docs = await rewards
    .find(filter)
    .sort({ archived: 1, available: -1, price: 1 })
    .limit(500)
    .toArray();
  return json(res, 200, { rewards: docs.map(serializeReward), total: docs.length });
}

async function createReward(req, res) {
  const auth = await requireAdmin(req, true);
  const body = await readJson(req);
  const { rewards } = await collections();

  const name = stringField(body.name, 'Nome do presente', { min: 2, max: 70 });
  const description = stringField(body.description || '', 'Descrição', {
    min: 0,
    max: 600,
    optional: true,
  });
  const image = optionalUrl(body.image, 'Imagem');
  const price = intField(body.price, 'Preço em pontos', { min: 1, max: 100_000_000 });
  const stock = intField(body.stock, 'Estoque', { min: 0, max: 1_000_000 });
  const available = boolField(body.available, true);

  const now = new Date();
  const doc = {
    name,
    nameLower: name.toLowerCase(),
    description,
    image,
    price,
    stock,
    available,
    archived: false,
    createdBy: auth.admin._id,
    createdAt: now,
    updatedAt: now,
  };
  const inserted = await rewards.insertOne(doc);
  await audit({
    admin: auth.admin,
    action: 'reward.created',
    entityType: 'reward',
    entityId: inserted.insertedId,
    description: `Presente "${name}" cadastrado por ${price} pontos.`,
    metadata: { price, stock },
    req,
  });

  return json(res, 201, {
    reward: serializeReward({ ...doc, _id: inserted.insertedId }),
  });
}

async function updateReward(req, res, id) {
  const auth = await requireAdmin(req, true);
  const rewardId = objectId(id, 'Presente');
  const body = await readJson(req);
  const { rewards } = await collections();
  const reward = await rewards.findOne({ _id: rewardId });
  if (!reward) throw new HttpError(404, 'REWARD_NOT_FOUND', 'Presente não encontrado.');

  const updates = {};
  if (body.name !== undefined) {
    updates.name = stringField(body.name, 'Nome do presente', { min: 2, max: 70 });
    updates.nameLower = updates.name.toLowerCase();
  }
  if (body.description !== undefined) {
    updates.description = stringField(body.description, 'Descrição', {
      min: 0,
      max: 600,
      optional: true,
    });
  }
  if (body.image !== undefined) updates.image = optionalUrl(body.image, 'Imagem');
  if (body.price !== undefined) {
    updates.price = intField(body.price, 'Preço em pontos', { min: 1, max: 100_000_000 });
  }
  if (body.stock !== undefined) {
    updates.stock = intField(body.stock, 'Estoque', { min: 0, max: 1_000_000 });
  }
  if (body.available !== undefined) updates.available = boolField(body.available, true);
  if (!Object.keys(updates).length) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Nenhum campo para atualizar.');
  }
  updates.updatedAt = new Date();

  await rewards.updateOne({ _id: rewardId }, { $set: updates });
  const updated = await rewards.findOne({ _id: rewardId });
  await audit({
    admin: auth.admin,
    action: 'reward.updated',
    entityType: 'reward',
    entityId: rewardId,
    description: `Presente "${updated.name}" atualizado.`,
    metadata: { fields: Object.keys(updates).filter((key) => key !== 'updatedAt') },
    req,
  });
  return json(res, 200, { reward: serializeReward(updated) });
}

async function archiveReward(req, res, id) {
  const auth = await requireAdmin(req, true);
  const rewardId = objectId(id, 'Presente');
  const { rewards, redemptions } = await collections();
  const reward = await rewards.findOne({ _id: rewardId });
  if (!reward) throw new HttpError(404, 'REWARD_NOT_FOUND', 'Presente não encontrado.');
  if (reward.archived) {
    throw new HttpError(409, 'REWARD_ARCHIVED', 'Este presente já está arquivado.');
  }

  const pending = await redemptions.countDocuments({
    rewardId,
    status: { $in: ['pending', 'approved'] },
  });
  if (pending > 0) {
    throw new HttpError(
      409,
      'REWARD_HAS_REDEMPTIONS',
      'Existem resgates pendentes ou aprovados para este presente. Finalize-os antes de arquivar.'
    );
  }

  const now = new Date();
  await rewards.updateOne(
    { _id: rewardId },
    { $set: { archived: true, available: false, updatedAt: now } }
  );
  await audit({
    admin: auth.admin,
    action: 'reward.archived',
    entityType: 'reward',
    entityId: rewardId,
    description: `Presente "${reward.name}" arquivado. Histórico de resgates preservado.`,
    req,
  });
  return json(res, 200, { ok: true });
}

async function restoreReward(req, res, id) {
  const auth = await requireAdmin(req, true);
  const rewardId = objectId(id, 'Presente');
  const { rewards } = await collections();
  const reward = await rewards.findOne({ _id: rewardId });
  if (!reward) throw new HttpError(404, 'REWARD_NOT_FOUND', 'Presente não encontrado.');
  if (!reward.archived) {
    throw new HttpError(409, 'REWARD_ACTIVE', 'Este presente não está arquivado.');
  }
  await rewards.updateOne(
    { _id: rewardId },
    { $set: { archived: false, available: true, updatedAt: new Date() } }
  );
  await audit({
    admin: auth.admin,
    action: 'reward.restored',
    entityType: 'reward',
    entityId: rewardId,
    description: `Presente "${reward.name}" restaurado para a loja.`,
    req,
  });
  return json(res, 200, { ok: true });
}

/* -------------------------------------------------------------------------- */
/* Redemptions                                                                */
/* -------------------------------------------------------------------------- */

async function listRedemptions(req, res) {
  await requireAdmin(req, false);
  const { redemptions } = await collections();
  const status = queryValue(req, 'status');
  const search = assertSearchSafe(queryValue(req, 'search', '')).trim();
  const filter = {};
  if (['pending', 'approved', 'delivered', 'rejected'].includes(status)) {
    filter.status = status;
  }
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ memberNickname: regex }, { rewardName: regex }];
  }

  const [docs, counts] = await Promise.all([
    redemptions.find(filter).sort({ createdAt: -1 }).limit(500).toArray(),
    redemptions
      .aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
      .toArray(),
  ]);

  const countMap = { pending: 0, approved: 0, delivered: 0, rejected: 0 };
  counts.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(countMap, row._id)) countMap[row._id] = row.count;
  });

  return json(res, 200, {
    redemptions: docs.map(serializeRedemption),
    counts: countMap,
    total: docs.length,
  });
}

async function createRedemption(req, res) {
  const auth = await requireAdmin(req, true);
  const body = await readJson(req);
  const memberId = objectId(body.memberId, 'Membro');
  const rewardId = objectId(body.rewardId, 'Presente');
  const quantity = intField(body.quantity, 'Quantidade', { min: 1, max: 50 });
  const note = stringField(body.note || '', 'Observação', { min: 0, max: 300, optional: true });
  const key = idempotencyKey(body.idempotencyKey, 'redemption');

  const {
    members,
    rewards,
    redemptions,
    pointTransactions,
  } = await collections();

  const existing = await redemptions.findOne({ idempotencyKey: key });
  if (existing) {
    return json(res, 200, { duplicate: true, redemption: serializeRedemption(existing) });
  }

  try {
    const result = await withTransaction(async (session) => {
      const member = await members.findOne({ _id: memberId }, { session });
      if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado.');
      if (member.status !== 'active') {
        throw new HttpError(409, 'MEMBER_ARCHIVED', 'Membros arquivados não podem resgatar.');
      }
      const reward = await rewards.findOne({ _id: rewardId }, { session });
      if (!reward || reward.archived) {
        throw new HttpError(404, 'REWARD_NOT_FOUND', 'Presente não encontrado.');
      }
      if (!reward.available) {
        throw new HttpError(409, 'REWARD_UNAVAILABLE', 'Este presente não está disponível.');
      }
      if (reward.stock < quantity) {
        throw new HttpError(
          409,
          'INSUFFICIENT_STOCK',
          `Estoque insuficiente. Disponível: ${reward.stock} unidade(s).`
        );
      }

      const total = reward.price * quantity;
      if (!Number.isSafeInteger(total)) {
        throw new HttpError(422, 'VALIDATION_ERROR', 'Valor total inválido.');
      }
      if (member.balance < total) {
        throw new HttpError(
          409,
          'INSUFFICIENT_BALANCE',
          `Saldo insuficiente. Disponível: ${member.balance} pontos; necessário: ${total}.`
        );
      }

      const now = new Date();
      const updatedMember = await members.findOneAndUpdate(
        { _id: memberId, balance: { $gte: total } },
        {
          $inc: { balance: -total, reserved: total },
          $set: { updatedAt: now },
        },
        { session, returnDocument: 'after' }
      );
      if (!updatedMember) {
        throw new HttpError(409, 'INSUFFICIENT_BALANCE', 'Saldo insuficiente.');
      }

      const stockUpdate = await rewards.updateOne(
        {
          _id: rewardId,
          archived: false,
          available: true,
          stock: { $gte: quantity },
        },
        { $inc: { stock: -quantity }, $set: { updatedAt: now } },
        { session }
      );
      if (stockUpdate.modifiedCount !== 1) {
        throw new HttpError(409, 'INSUFFICIENT_STOCK', 'Estoque insuficiente.');
      }

      const redemptionDoc = {
        memberId,
        rewardId,
        memberNickname: member.nickname,
        memberAvatar: member.avatar || '',
        rewardName: reward.name,
        rewardImage: reward.image || '',
        unitPrice: reward.price,
        quantity,
        totalPoints: total,
        status: 'pending',
        note,
        requestedBy: auth.admin._id,
        requestedByName: auth.admin.displayName || auth.admin.username,
        requestedAt: now,
        approvedAt: null,
        deliveredAt: null,
        rejectedAt: null,
        rejectionReason: '',
        idempotencyKey: key,
        createdAt: now,
        updatedAt: now,
      };
      const inserted = await redemptions.insertOne(redemptionDoc, { session });

      await pointTransactions.insertOne(
        {
          memberId,
          type: 'redemption_reserve',
          amount: -total,
          balanceDelta: -total,
          reservedDelta: total,
          spentDelta: 0,
          rankingDelta: 0,
          description: `Reserva de resgate — ${reward.name} × ${quantity}`,
          reason: note || 'Pontos reservados para resgate.',
          adminId: auth.admin._id,
          adminName: auth.admin.displayName || auth.admin.username,
          redemptionId: inserted.insertedId,
          seasonId: null,
          idempotencyKey: `redemption:${inserted.insertedId.toString()}:reserve`,
          balanceAfter: updatedMember.balance,
          reservedAfter: updatedMember.reserved,
          createdAt: now,
        },
        { session }
      );

      await audit({
        admin: auth.admin,
        action: 'redemption.created',
        entityType: 'redemption',
        entityId: inserted.insertedId,
        description: `Resgate solicitado: ${reward.name} × ${quantity} para ${member.nickname} (${total} pontos reservados).`,
        metadata: { memberId: memberId.toString(), rewardId: rewardId.toString(), total },
        req,
        session,
      });

      return {
        duplicate: false,
        redemption: serializeRedemption({ ...redemptionDoc, _id: inserted.insertedId }),
        member: serializeMember(updatedMember),
      };
    });
    return json(res, 201, result);
  } catch (err) {
    if (err && err.code === 11000) {
      const duplicate = await redemptions.findOne({ idempotencyKey: key });
      if (duplicate) {
        return json(res, 200, {
          duplicate: true,
          redemption: serializeRedemption(duplicate),
        });
      }
    }
    throw err;
  }
}

async function getRedemption(req, res, id) {
  await requireAdmin(req, false);
  const redemptionId = objectId(id, 'Resgate');
  const { redemptions } = await collections();
  const redemption = await redemptions.findOne({ _id: redemptionId });
  if (!redemption) throw new HttpError(404, 'REDEMPTION_NOT_FOUND', 'Resgate não encontrado.');
  return json(res, 200, { redemption: serializeRedemption(redemption) });
}

async function approveRedemption(req, res, id) {
  const auth = await requireAdmin(req, true);
  const redemptionId = objectId(id, 'Resgate');
  const { redemptions, members, pointTransactions } = await collections();

  const result = await withTransaction(async (session) => {
    const redemption = await redemptions.findOne({ _id: redemptionId }, { session });
    if (!redemption) throw new HttpError(404, 'REDEMPTION_NOT_FOUND', 'Resgate não encontrado.');
    if (redemption.status === 'approved') {
      return { alreadyApproved: true, redemption: serializeRedemption(redemption) };
    }
    if (redemption.status !== 'pending') {
      throw new HttpError(
        409,
        'REDEMPTION_LOCKED',
        'Somente resgates pendentes podem ser aprovados.'
      );
    }

    const member = await members.findOne({ _id: redemption.memberId }, { session });
    if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado.');
    if (member.reserved < redemption.totalPoints) {
      throw new HttpError(409, 'RESERVATION_MISMATCH', 'Reserva de pontos inconsistente.');
    }

    const now = new Date();
    const updatedMember = await members.findOneAndUpdate(
      { _id: member._id, reserved: { $gte: redemption.totalPoints } },
      {
        $inc: { reserved: -redemption.totalPoints, totalSpent: redemption.totalPoints },
        $set: { updatedAt: now },
      },
      { session, returnDocument: 'after' }
    );
    if (!updatedMember) {
      throw new HttpError(409, 'RESERVATION_MISMATCH', 'Reserva de pontos inconsistente.');
    }

    await redemptions.updateOne(
      { _id: redemptionId, status: 'pending' },
      {
        $set: {
          status: 'approved',
          approvedBy: auth.admin._id,
          approvedByName: auth.admin.displayName || auth.admin.username,
          approvedAt: now,
          updatedAt: now,
        },
      },
      { session }
    );

    await pointTransactions.insertOne(
      {
        memberId: member._id,
        type: 'redemption_approve',
        amount: 0,
        balanceDelta: 0,
        reservedDelta: -redemption.totalPoints,
        spentDelta: redemption.totalPoints,
        rankingDelta: 0,
        description: `Resgate aprovado — ${redemption.rewardName} × ${redemption.quantity}`,
        reason: 'Débito confirmado sobre pontos previamente reservados.',
        adminId: auth.admin._id,
        adminName: auth.admin.displayName || auth.admin.username,
        redemptionId,
        seasonId: null,
        idempotencyKey: `redemption:${redemptionId.toString()}:approve`,
        balanceAfter: updatedMember.balance,
        reservedAfter: updatedMember.reserved,
        createdAt: now,
      },
      { session }
    );

    await audit({
      admin: auth.admin,
      action: 'redemption.approved',
      entityType: 'redemption',
      entityId: redemptionId,
      description: `Resgate de ${redemption.memberNickname} aprovado (${redemption.totalPoints} pontos).`,
      metadata: { totalPoints: redemption.totalPoints },
      req,
      session,
    });

    return {
      alreadyApproved: false,
      redemption: serializeRedemption({
        ...redemption,
        status: 'approved',
        approvedAt: now,
      }),
      member: serializeMember(updatedMember),
    };
  });

  return json(res, 200, result);
}

async function rejectRedemption(req, res, id) {
  const auth = await requireAdmin(req, true);
  const redemptionId = objectId(id, 'Resgate');
  const body = await readJson(req);
  const reason = stringField(body.reason, 'Motivo da recusa', { min: 3, max: 300 });
  const { redemptions, members, rewards, pointTransactions } = await collections();

  const result = await withTransaction(async (session) => {
    const redemption = await redemptions.findOne({ _id: redemptionId }, { session });
    if (!redemption) throw new HttpError(404, 'REDEMPTION_NOT_FOUND', 'Resgate não encontrado.');
    if (redemption.status === 'rejected') {
      return { alreadyRejected: true, redemption: serializeRedemption(redemption) };
    }
    if (redemption.status !== 'pending') {
      throw new HttpError(
        409,
        'REDEMPTION_LOCKED',
        'Somente resgates pendentes podem ser recusados.'
      );
    }

    const member = await members.findOne({ _id: redemption.memberId }, { session });
    if (!member) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Membro não encontrado.');
    if (member.reserved < redemption.totalPoints) {
      throw new HttpError(409, 'RESERVATION_MISMATCH', 'Reserva de pontos inconsistente.');
    }

    const now = new Date();
    const updatedMember = await members.findOneAndUpdate(
      { _id: member._id, reserved: { $gte: redemption.totalPoints } },
      {
        $inc: { reserved: -redemption.totalPoints, balance: redemption.totalPoints },
        $set: { updatedAt: now },
      },
      { session, returnDocument: 'after' }
    );
    if (!updatedMember) {
      throw new HttpError(409, 'RESERVATION_MISMATCH', 'Reserva de pontos inconsistente.');
    }

    await rewards.updateOne(
      { _id: redemption.rewardId },
      { $inc: { stock: redemption.quantity }, $set: { updatedAt: now } },
      { session }
    );

    await redemptions.updateOne(
      { _id: redemptionId, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          rejectionReason: reason,
          rejectedBy: auth.admin._id,
          rejectedByName: auth.admin.displayName || auth.admin.username,
          rejectedAt: now,
          updatedAt: now,
        },
      },
      { session }
    );

    await pointTransactions.insertOne(
      {
        memberId: member._id,
        type: 'redemption_refund',
        amount: redemption.totalPoints,
        balanceDelta: redemption.totalPoints,
        reservedDelta: -redemption.totalPoints,
        spentDelta: 0,
        rankingDelta: 0,
        description: `Reserva liberada — ${redemption.rewardName} × ${redemption.quantity}`,
        reason: `Resgate recusado: ${reason}`,
        adminId: auth.admin._id,
        adminName: auth.admin.displayName || auth.admin.username,
        redemptionId,
        seasonId: null,
        idempotencyKey: `redemption:${redemptionId.toString()}:refund`,
        balanceAfter: updatedMember.balance,
        reservedAfter: updatedMember.reserved,
        createdAt: now,
      },
      { session }
    );

    await audit({
      admin: auth.admin,
      action: 'redemption.rejected',
      entityType: 'redemption',
      entityId: redemptionId,
      description: `Resgate de ${redemption.memberNickname} recusado. ${redemption.totalPoints} pontos liberados.`,
      metadata: { reason, totalPoints: redemption.totalPoints },
      req,
      session,
    });

    return {
      alreadyRejected: false,
      redemption: serializeRedemption({
        ...redemption,
        status: 'rejected',
        rejectionReason: reason,
        rejectedAt: now,
      }),
      member: serializeMember(updatedMember),
    };
  });

  return json(res, 200, result);
}

async function deliverRedemption(req, res, id) {
  const auth = await requireAdmin(req, true);
  const redemptionId = objectId(id, 'Resgate');
  const { redemptions } = await collections();

  const redemption = await redemptions.findOne({ _id: redemptionId });
  if (!redemption) throw new HttpError(404, 'REDEMPTION_NOT_FOUND', 'Resgate não encontrado.');
  if (redemption.status === 'delivered') {
    return json(res, 200, {
      alreadyDelivered: true,
      redemption: serializeRedemption(redemption),
    });
  }
  if (redemption.status !== 'approved') {
    throw new HttpError(
      409,
      'REDEMPTION_NOT_APPROVED',
      'O resgate precisa ser aprovado antes de ser entregue.'
    );
  }

  const now = new Date();
  const delivered = await redemptions.updateOne(
    { _id: redemptionId, status: 'approved' },
    {
      $set: {
        status: 'delivered',
        deliveredBy: auth.admin._id,
        deliveredByName: auth.admin.displayName || auth.admin.username,
        deliveredAt: now,
        updatedAt: now,
      },
    }
  );
  if (delivered.modifiedCount !== 1) {
    throw new HttpError(
      409,
      'REDEMPTION_ALREADY_PROCESSED',
      'Este resgate já foi processado por outra operação.'
    );
  }
  await audit({
    admin: auth.admin,
    action: 'redemption.delivered',
    entityType: 'redemption',
    entityId: redemptionId,
    description: `Resgate de ${redemption.memberNickname} entregue.`,
    req,
  });

  return json(res, 200, {
    redemption: serializeRedemption({ ...redemption, status: 'delivered', deliveredAt: now }),
  });
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

async function listAudit(req, res) {
  await requireAdmin(req, false);
  const { auditLogs } = await collections();
  const { page, limit, skip } = pagination(req.query || {});
  const filter = {};
  const entityType = queryValue(req, 'entityType');
  if (entityType) filter.entityType = entityType;
  const search = assertSearchSafe(queryValue(req, 'search', '')).trim();
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ description: regex }, { adminName: regex }, { action: regex }];
  }

  const [docs, total] = await Promise.all([
    auditLogs.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
    auditLogs.countDocuments(filter),
  ]);
  return json(res, 200, {
    logs: docs.map(serializeAudit),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

async function route(req, res) {
  const method = String(req.method || 'GET').toUpperCase();
  const segments = routeSegments(req);

  if (segments.length === 1 && segments[0] === 'health') {
    if (method !== 'GET') methodNotAllowed(res, ['GET']);
    await ping();
    return json(res, 200, { ok: true, service: 'navozcoin-api', time: new Date() });
  }

  if (segments[0] === 'auth') {
    if (segments[1] === 'login' && segments.length === 2) {
      if (method !== 'POST') methodNotAllowed(res, ['POST']);
      return login(req, res);
    }
    if (segments[1] === 'me' && segments.length === 2) {
      if (method !== 'GET') methodNotAllowed(res, ['GET']);
      return me(req, res);
    }
    if (segments[1] === 'logout' && segments.length === 2) {
      if (method !== 'POST') methodNotAllowed(res, ['POST']);
      return logout(req, res);
    }
    if (segments[1] === 'password' && segments.length === 2) {
      if (method !== 'POST') methodNotAllowed(res, ['POST']);
      return changePassword(req, res);
    }
    throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  if (segments[0] === 'dashboard' && segments.length === 1) {
    if (method !== 'GET') methodNotAllowed(res, ['GET']);
    return dashboard(req, res);
  }

  if (segments[0] === 'members') {
    if (segments.length === 1) {
      if (method === 'GET') return listMembers(req, res);
      if (method === 'POST') return createMember(req, res);
      return methodNotAllowed(res, ['GET', 'POST']);
    }
    const memberId = segments[1];
    if (segments.length === 2) {
      if (method === 'GET') return getMember(req, res, memberId);
      if (method === 'PATCH') return updateMember(req, res, memberId);
      if (method === 'DELETE') return archiveMember(req, res, memberId);
      return methodNotAllowed(res, ['GET', 'PATCH', 'DELETE']);
    }
    if (segments.length === 3 && segments[2] === 'restore') {
      if (method !== 'POST') methodNotAllowed(res, ['POST']);
      return restoreMember(req, res, memberId);
    }
    throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  if (segments[0] === 'points' && segments.length === 1) {
    if (method !== 'POST') methodNotAllowed(res, ['POST']);
    return addPoints(req, res);
  }

  if (segments[0] === 'transactions' && segments.length === 1) {
    if (method !== 'GET') methodNotAllowed(res, ['GET']);
    return listTransactions(req, res);
  }

  if (segments[0] === 'events') {
    if (segments.length === 1) {
      if (method === 'GET') return listEvents(req, res);
      if (method === 'POST') return createEvent(req, res);
      return methodNotAllowed(res, ['GET', 'POST']);
    }
    const eventId = segments[1];
    if (segments.length === 2) {
      if (method === 'GET') return getEvent(req, res, eventId);
      if (method === 'PATCH') return updateEvent(req, res, eventId);
      return methodNotAllowed(res, ['GET', 'PATCH']);
    }
    if (segments.length === 3) {
      if (segments[2] === 'attendance') {
        if (method !== 'PUT') methodNotAllowed(res, ['PUT']);
        return setAttendance(req, res, eventId);
      }
      if (segments[2] === 'finalize') {
        if (method !== 'POST') methodNotAllowed(res, ['POST']);
        return finalizeEvent(req, res, eventId);
      }
      if (segments[2] === 'cancel') {
        if (method !== 'POST') methodNotAllowed(res, ['POST']);
        return cancelEvent(req, res, eventId);
      }
    }
    throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  if (segments[0] === 'rankings' && segments.length === 1) {
    if (method !== 'GET') methodNotAllowed(res, ['GET']);
    return rankings(req, res);
  }

  if (segments[0] === 'seasons') {
    if (segments.length === 1) {
      if (method === 'GET') return listSeasons(req, res);
      if (method === 'POST') return createSeason(req, res);
      return methodNotAllowed(res, ['GET', 'POST']);
    }
    const seasonId = segments[1];
    if (segments.length === 3 && segments[2] === 'activate') {
      if (method !== 'POST') methodNotAllowed(res, ['POST']);
      return activateSeason(req, res, seasonId);
    }
    if (segments.length === 3 && segments[2] === 'close') {
      if (method !== 'POST') methodNotAllowed(res, ['POST']);
      return closeSeason(req, res, seasonId);
    }
    throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  if (segments[0] === 'rewards') {
    if (segments.length === 1) {
      if (method === 'GET') return listRewards(req, res);
      if (method === 'POST') return createReward(req, res);
      return methodNotAllowed(res, ['GET', 'POST']);
    }
    const rewardId = segments[1];
    if (segments.length === 2) {
      if (method === 'PATCH') return updateReward(req, res, rewardId);
      if (method === 'DELETE') return archiveReward(req, res, rewardId);
      return methodNotAllowed(res, ['PATCH', 'DELETE']);
    }
    if (segments.length === 3 && segments[2] === 'restore') {
      if (method !== 'POST') methodNotAllowed(res, ['POST']);
      return restoreReward(req, res, rewardId);
    }
    throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  if (segments[0] === 'redemptions') {
    if (segments.length === 1) {
      if (method === 'GET') return listRedemptions(req, res);
      if (method === 'POST') return createRedemption(req, res);
      return methodNotAllowed(res, ['GET', 'POST']);
    }
    const redemptionId = segments[1];
    if (segments.length === 2) {
      if (method !== 'GET') methodNotAllowed(res, ['GET']);
      return getRedemption(req, res, redemptionId);
    }
    if (segments.length === 3) {
      if (segments[2] === 'approve') {
        if (method !== 'POST') methodNotAllowed(res, ['POST']);
        return approveRedemption(req, res, redemptionId);
      }
      if (segments[2] === 'reject') {
        if (method !== 'POST') methodNotAllowed(res, ['POST']);
        return rejectRedemption(req, res, redemptionId);
      }
      if (segments[2] === 'deliver') {
        if (method !== 'POST') methodNotAllowed(res, ['POST']);
        return deliverRedemption(req, res, redemptionId);
      }
    }
    throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
  }

  if (segments[0] === 'audit' && segments.length === 1) {
    if (method !== 'GET') methodNotAllowed(res, ['GET']);
    return listAudit(req, res);
  }

  throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada.');
}

function mergeHeaderQuery(req) {
  const raw = req.headers['x-navoz-query'];
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return;
  try {
    const params = new URLSearchParams(raw);
    const parsed = {};
    for (const [key, value] of params.entries()) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) parsed[key] = value;
    }
    req.query = { ...parsed, ...(req.query || {}) };
  } catch {
    /* cabeçalho opcional inválido é ignorado */
  }
}

async function handler(req, res) {
  const requestId = crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', requestId);
  securityHeaders(req, res);
  mergeHeaderQuery(req);

  try {
    if (String(req.method || '').toUpperCase() === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    assertOrigin(req);
    await ensureIndexes();
    await route(req, res);
  } catch (err) {
    if (res.headersSent) {
      try {
        res.end();
      } catch {
        /* noop */
      }
      return;
    }

    if (err instanceof HttpError) {
      return json(res, err.status, {
        error: {
          code: err.code,
          message: err.message,
          details: err.details || undefined,
          requestId,
        },
      });
    }

    const duplicate = duplicateMessage(err);
    if (duplicate) {
      return json(res, 409, {
        error: { code: 'DUPLICATE', message: duplicate, requestId },
      });
    }

    if (err && (err.code === 'DB_NOT_CONFIGURED' || err.name === 'MongoServerSelectionError')) {
      console.error(`[${requestId}] database unavailable`, err.message);
      return json(res, 503, {
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Banco de dados indisponível. Verifique a configuração do MongoDB Atlas.',
          requestId,
        },
      });
    }

    console.error(`[${requestId}]`, err);
    return json(res, 500, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno inesperado. Tente novamente.',
        requestId,
      },
    });
  }
}

module.exports = handler;
module.exports.handler = handler;
