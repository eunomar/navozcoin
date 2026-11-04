'use strict';

/**
 * Carregador mínimo de .env para os scripts locais (seed/check).
 * Em produção (Vercel) as variáveis são injetadas pelo painel do projeto.
 * Nenhuma credencial real é incluída no repositório.
 */
const fs = require('fs');
const path = require('path');

function parse(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value.replace(/\\n/g, '\n');
  }
  return result;
}

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    const fullPath = path.join(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;
    const parsed = parse(fs.readFileSync(fullPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

module.exports = { loadEnv };
