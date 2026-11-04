'use strict';

/**
 * Entrada única da função serverless (Vercel / runtime Node.js).
 *
 * O vercel.json encaminha /api/* para esta função preservando a rota em
 * ?path=..., por exemplo: /api/events/123 -> /api/index?path=events/123.
 * Nenhuma credencial do MongoDB chega ao navegador.
 */
module.exports = require('../server/api');
