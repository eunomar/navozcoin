'use strict';

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { collections } = require('./db');

const SESSION_COOKIE = 'nvc_session';
const CSRF_COOKIE = 'nvc_csrf';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 80);
  }
  return (
    (req.socket && req.socket.remoteAddress) ||
    req.headers['x-real-ip'] ||
    'unknown'
  ).slice(0, 80);
}

function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

function requestInfo(req) {
  return {
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
  };
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const result = {};
  if (!header || typeof header !== 'string') return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      result[name] = part.slice(index + 1).trim();
    }
  }
  return result;
}

function cookie(name, value, req, maxAge, httpOnly) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    'SameSite=Strict',
  ];
  if (httpOnly) bits.push('HttpOnly');
  if (isHttps(req)) bits.push('Secure');
  return bits.join('; ');
}

function setSessionCookies(req, res, token, csrf) {
  const previous = res.getHeader('Set-Cookie');
  const list = Array.isArray(previous) ? previous.slice() : previous ? [previous] : [];
  list.push(cookie(SESSION_COOKIE, token, req, SESSION_TTL_SECONDS, true));
  list.push(cookie(CSRF_COOKIE, csrf, req, SESSION_TTL_SECONDS, false));
  res.setHeader('Set-Cookie', list);
}

function clearSessionCookies(req, res) {
  const previous = res.getHeader('Set-Cookie');
  const list = Array.isArray(previous) ? previous.slice() : previous ? [previous] : [];
  list.push(cookie(SESSION_COOKIE, '', req, 0, true));
  list.push(cookie(CSRF_COOKIE, '', req, 0, false));
  res.setHeader('Set-Cookie', list);
}

function assertOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (origin === 'null') throw new HttpError(403, 'ORIGIN_DENIED', 'Origem não autorizada.');

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const sameOrigin = host && origin === `${proto}://${host}`;
  const configured = String(process.env.APP_ORIGIN || '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (!sameOrigin && !configured.includes(origin.replace(/\/$/, ''))) {
    throw new HttpError(403, 'ORIGIN_DENIED', 'Origem não autorizada.');
  }
}

function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
  if (isHttps(req)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.end(JSON.stringify(payload));
}

async function readJson(req, maxBytes = 512 * 1024) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    const size = Buffer.byteLength(JSON.stringify(req.body));
    if (size > maxBytes) throw new HttpError(413, 'BODY_TOO_LARGE', 'Requisição muito grande.');
    return req.body;
  }
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else {
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        throw new HttpError(413, 'BODY_TOO_LARGE', 'Requisição muito grande.');
      }
    }
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Corpo da requisição inválido.');
  }
}

function stringField(value, label, { min = 1, max = 200, optional = false, trim = true } = {}) {
  if (value === undefined || value === null) {
    if (optional) return '';
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} é obrigatório.`);
  }
  if (typeof value !== 'string') {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} deve ser um texto.`);
  }
  const result = trim ? value.trim() : value;
  if (result.length < min) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} deve ter pelo menos ${min} caractere(s).`);
  }
  if (result.length > max) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} deve ter no máximo ${max} caracteres.`);
  }
  return result;
}

function intField(value, label, { min = 0, max = 1_000_000_000 } = {}) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isSafeInteger(number)) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} deve ser um número inteiro.`);
  }
  if (number < min || number > max) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} deve estar entre ${min} e ${max}.`);
  }
  return number;
}

function boolField(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return value === 'true' || value === 1 || value === '1';
}

function dateField(value, label, { optional = false } = {}) {
  if (!value) {
    if (optional) return '';
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} é obrigatório.`);
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} deve estar no formato AAAA-MM-DD.`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} é uma data inválida.`);
  }
  return text;
}

function timeField(value, label) {
  const text = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} deve estar no formato HH:mm.`);
  }
  return text;
}

function optionalUrl(value, label, max = 800) {
  const text = stringField(value, label, { min: 0, max, optional: true });
  if (!text) return '';
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(text) && text.length <= 350_000) {
    return text;
  }
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('protocol');
    }
    return url.toString();
  } catch {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} deve ser uma URL de imagem válida.`);
  }
}

function objectId(value, label = 'ID') {
  if (!value || typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) {
    throw new HttpError(422, 'VALIDATION_ERROR', `${label} inválido.`);
  }
  return new ObjectId(value);
}

function optionalObjectId(value, label = 'ID') {
  if (value === undefined || value === null || value === '') return null;
  return objectId(value, label);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function idempotencyKey(value, prefix) {
  const provided = typeof value === 'string' ? value.trim() : '';
  if (provided) {
    if (provided.length > 120) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Chave de idempotência inválida.');
    }
    return provided;
  }
  return `${prefix}:${Date.now()}:${crypto.randomBytes(12).toString('hex')}`;
}

function pagination(query = {}) {
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const rawLimit = Array.isArray(query.limit) ? query.limit[0] : query.limit;
  const page = Math.max(1, Math.min(100000, Number.parseInt(rawPage, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(rawLimit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

async function hitRateLimit(key, limit, windowMs) {
  const { rateLimits } = await collections();
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const id = `${key}:${bucket}`.slice(0, 220);
  const expiresAt = new Date((bucket + 1) * windowMs + 60_000);

  let doc;
  try {
    doc = await rateLimits.findOneAndUpdate(
      { _id: id },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt, createdAt: new Date(now) },
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (err) {
    if (err && err.code === 11000) {
      doc = await rateLimits.findOneAndUpdate(
        { _id: id },
        { $inc: { count: 1 } },
        { returnDocument: 'after' }
      );
    } else {
      throw err;
    }
  }

  const count = doc && doc.count ? doc.count : 1;
  const retryAfter = Math.max(1, Math.ceil(((bucket + 1) * windowMs - now) / 1000));
  return { allowed: count <= limit, count, retryAfter, id };
}

async function applyLoginRateLimit(req, username) {
  const ip = clientIp(req);
  const userFingerprint = sha256(username.toLowerCase()).slice(0, 32);
  const perIp = await hitRateLimit(`login-ip:${ip}`, 60, 10 * 60 * 1000);
  const perUser = await hitRateLimit(
    `login-user:${ip}:${userFingerprint}`,
    12,
    10 * 60 * 1000
  );
  if (!perIp.allowed || !perUser.allowed) {
    return {
      allowed: false,
      retryAfter: Math.max(perIp.retryAfter, perUser.retryAfter),
    };
  }
  return { allowed: true };
}

async function applySessionRateLimit(session) {
  const result = await hitRateLimit(`admin:${session.adminId.toString()}`, 240, 60 * 1000);
  return result;
}

async function authenticate(req, { requireCsrf = false } = {}) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Sessão não encontrada. Entre novamente.');

  const { adminSessions, admins } = await collections();
  const session = await adminSessions.findOne({
    tokenHash: sha256(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session) throw new HttpError(401, 'SESSION_EXPIRED', 'Sua sessão expirou. Entre novamente.');

  const admin = await admins.findOne({ _id: session.adminId, active: true });
  if (!admin) throw new HttpError(401, 'UNAUTHENTICATED', 'Administrador inativo ou inexistente.');

  if (requireCsrf) {
    const headerToken = req.headers['x-csrf-token'];
    const cookieToken = cookies[CSRF_COOKIE];
    if (
      typeof headerToken !== 'string' ||
      !cookieToken ||
      !safeEqual(headerToken, cookieToken) ||
      !safeEqual(sha256(headerToken), session.csrfHash)
    ) {
      throw new HttpError(403, 'CSRF_INVALID', 'Token de segurança inválido. Recarregue a página.');
    }
  }

  return { anon: false, admin, session, token, csrf: cookies[CSRF_COOKIE] || '' };
}

async function maybeAuthenticate(req) {
  try {
    return await authenticate(req);
  } catch {
    return { anon: true, admin: null, session: null };
  }
}

async function createSession(admin, req) {
  const { adminSessions } = await collections();
  const token = randomToken(32);
  const csrf = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const info = requestInfo(req);

  // Mantém no máximo 10 sessões ativas por administrador.
  const active = await adminSessions
    .find({ adminId: admin._id, expiresAt: { $gt: now } })
    .sort({ createdAt: -1 })
    .skip(9)
    .toArray();
  if (active.length) {
    await adminSessions.deleteMany({ _id: { $in: active.map((item) => item._id) } });
  }

  await adminSessions.insertOne({
    adminId: admin._id,
    tokenHash: sha256(token),
    csrfHash: sha256(csrf),
    ip: info.ip,
    userAgent: info.userAgent,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });

  return { token, csrf, expiresAt };
}

async function ensureCsrf(auth, req, res) {
  if (auth.csrf) return auth.csrf;
  const { adminSessions } = await collections();
  const csrf = randomToken(32);
  await adminSessions.updateOne(
    { _id: auth.session._id },
    { $set: { csrfHash: sha256(csrf) } }
  );
  const previous = res.getHeader('Set-Cookie');
  const list = Array.isArray(previous) ? previous.slice() : previous ? [previous] : [];
  list.push(cookie(CSRF_COOKIE, csrf, req, SESSION_TTL_SECONDS, false));
  res.setHeader('Set-Cookie', list);
  return csrf;
}

function publicAdmin(admin) {
  if (!admin) return null;
  return {
    id: admin._id.toString(),
    username: admin.username,
    displayName: admin.displayName,
    role: admin.role,
    active: Boolean(admin.active),
    permissions: admin.role === 'owner' ? [] : admin.permissions || [],
    lastLoginAt: admin.lastLoginAt || null,
  };
}

async function audit({
  admin,
  action,
  entityType,
  entityId,
  description,
  metadata,
  req,
  session,
}) {
  const { auditLogs } = await collections();
  const info = requestInfo(req);
  await auditLogs.insertOne(
    {
      adminId: admin ? admin._id : null,
      adminName: admin ? admin.displayName || admin.username : 'Sistema',
      action,
      entityType: entityType || 'system',
      entityId: entityId ? String(entityId) : null,
      description: description || '',
      metadata: metadata || {},
      ip: info.ip,
      userAgent: info.userAgent,
      createdAt: new Date(),
    },
    session ? { session } : undefined
  );
}

async function getActiveSeason() {
  const { seasons } = await collections();
  return seasons.findOne({ status: 'active' }, { sort: { activatedAt: -1, createdAt: -1 } });
}

function todayString() {
  // Data operacional no fuso do projeto.
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function serializeSeason(season) {
  if (!season) return null;
  return {
    id: season._id.toString(),
    name: season.name,
    startDate: season.startDate,
    endDate: season.endDate,
    status: season.status,
    activatedAt: season.activatedAt || null,
    endedAt: season.endedAt || null,
  };
}

module.exports = {
  HttpError,
  SESSION_COOKIE,
  CSRF_COOKIE,
  SESSION_TTL_SECONDS,
  sha256,
  randomToken,
  safeEqual,
  clientIp,
  requestInfo,
  parseCookies,
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
  hitRateLimit,
  applyLoginRateLimit,
  applySessionRateLimit,
  authenticate,
  maybeAuthenticate,
  createSession,
  ensureCsrf,
  publicAdmin,
  audit,
  getActiveSeason,
  todayString,
  serializeSeason,
};
