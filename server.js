const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 5
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scores (
      id SERIAL PRIMARY KEY,
      nickname VARCHAR(20) NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 0),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_scores_score ON scores (score DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS counters (
      name VARCHAR(32) PRIMARY KEY,
      value BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`INSERT INTO counters (name, value) VALUES ('visits', 0) ON CONFLICT (name) DO NOTHING`);
}

app.use(express.json({ limit: '32kb' }));
app.use(express.static(__dirname, {
  index: 'login.html',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.get('/api/top', async (req, res) => {
  const limit = Math.max(1, Math.min(30, parseInt(req.query.limit) || 10));
  try {
    const { rows } = await pool.query(
      'SELECT nickname, score, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT $1',
      [limit]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/scores', async (req, res) => {
  const { nickname, score } = req.body || {};
  const nick = typeof nickname === 'string' ? nickname.trim() : '';
  if (nick.length < 1 || nick.length > 20) {
    return res.status(400).json({ error: '닉네임은 1~20자' });
  }
  const s = Number(score);
  if (!Number.isFinite(s) || s < 0 || s > 99999999) {
    return res.status(400).json({ error: '점수가 올바르지 않습니다' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO scores (nickname, score) VALUES ($1, $2) RETURNING id, nickname, score, created_at',
      [nick, Math.floor(s)]
    );
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/visits', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM counters WHERE name='visits'");
    res.json({ value: rows[0] ? Number(rows[0].value) : 0 });
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/visits', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE counters SET value = value + 1, updated_at = NOW() WHERE name='visits' RETURNING value"
    );
    res.json({ value: rows[0] ? Number(rows[0].value) : 0 });
  } catch (e) {
    res.status(500).json({ error: 'db_error' });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    app.listen(PORT, () => console.log('suika-hsh listening on', PORT));
  })
  .catch((e) => {
    console.error('DB init failed:', e);
    app.listen(PORT, () => console.log('suika-hsh listening (no DB) on', PORT));
  });
