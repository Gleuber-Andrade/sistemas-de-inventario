// =========================================================
// API do Portal "Sistemas do Inventário" — rodando no servidor Ubuntu
// Guarda só a tabela de usuários (login/permissões) de forma
// centralizada, pra não precisar recriar contas em cada computador.
// Banco de dados: SQLite (arquivo próprio, separado do Guarda de Lentes).
// =========================================================

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '2mb' }));

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));

const db = new Database(path.join(__dirname, 'portal.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    login TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    perfil TEXT NOT NULL DEFAULT 'usuario',
    ativo INTEGER NOT NULL DEFAULT 1,
    sistemas_permitidos TEXT NOT NULL DEFAULT '[]',
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Mesma trava simples por senha usada nos outros backends próprios.
const API_KEY = process.env.API_KEY || '';
function verificarChave(req, res, next) {
  if (!API_KEY) return next();
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== API_KEY) {
    return res.status(401).json({ erro: 'Chave de acesso inválida ou ausente.' });
  }
  next();
}
app.use(verificarChave);

function usuarioParaApi(row) {
  return {
    id: row.id,
    nome: row.nome,
    login: row.login,
    senhaHash: row.senha_hash,
    perfil: row.perfil,
    ativo: !!row.ativo,
    sistemasPermitidos: JSON.parse(row.sistemas_permitidos),
    criadoEm: row.criado_em,
  };
}

app.get('/', (req, res) => {
  let tamanhoBancoBytes = 0;
  try {
    tamanhoBancoBytes = fs.statSync(path.join(__dirname, 'portal.db')).size;
  } catch (err) {
    // banco ainda não existe / vazio
  }
  const total = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  res.json({
    ok: true,
    servico: 'Portal API',
    banco: 'SQLite (servidor próprio)',
    tamanhoBancoMB: (tamanhoBancoBytes / (1024 * 1024)).toFixed(2),
    totalUsuarios: total,
  });
});

app.get('/usuarios', (req, res) => {
  try {
    const linhas = db.prepare('SELECT * FROM usuarios ORDER BY id ASC').all();
    res.json(linhas.map(usuarioParaApi));
  } catch (err) {
    res.status(500).json({ erro: String(err) });
  }
});

app.get('/usuarios/:id', (req, res) => {
  try {
    const linha = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
    if (!linha) return res.status(404).json({ erro: 'Usuário não encontrado.' });
    res.json(usuarioParaApi(linha));
  } catch (err) {
    res.status(500).json({ erro: String(err) });
  }
});

// Cria OU atualiza (se o corpo vier com "id", atualiza; senão, cria novo).
// É assim que o portal já funciona hoje com o IndexedDB local — aqui só
// reproduzimos o mesmo comportamento, agora compartilhado entre computadores.
app.post('/usuarios', (req, res) => {
  try {
    const { id, nome, login, senhaHash, perfil, ativo, sistemasPermitidos } = req.body || {};
    if (!nome || !login || !senhaHash) {
      return res.status(400).json({ erro: 'Campos obrigatórios: nome, login, senhaHash.' });
    }
    const ativoInt = ativo === false ? 0 : 1;
    const sistemasJson = JSON.stringify(sistemasPermitidos || []);

    if (id) {
      db.prepare(
        `UPDATE usuarios SET nome=?, login=?, senha_hash=?, perfil=?, ativo=?, sistemas_permitidos=? WHERE id=?`
      ).run(nome, login, senhaHash, perfil || 'usuario', ativoInt, sistemasJson, id);
      return res.json({ id });
    }

    const info = db
      .prepare(
        `INSERT INTO usuarios (nome, login, senha_hash, perfil, ativo, sistemas_permitidos) VALUES (?,?,?,?,?,?)`
      )
      .run(nome, login, senhaHash, perfil || 'usuario', ativoInt, sistemasJson);
    res.json({ id: info.lastInsertRowid });
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return res.status(409).json({ erro: 'Já existe um usuário com esse login.' });
    }
    res.status(500).json({ erro: String(err) });
  }
});

app.delete('/usuarios/:id', (req, res) => {
  try {
    const info = db.prepare('DELETE FROM usuarios WHERE id = ?').run(req.params.id);
    if (info.changes === 0) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: String(err) });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Portal API rodando na porta ' + PORT + ' (todas as interfaces de rede)');
});
