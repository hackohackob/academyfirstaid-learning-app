const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const QUESTIONS_DIR = path.join(ROOT, "questions");
const DATA_DIR = path.join(__dirname, "data");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const DB_FILE = path.join(DATA_DIR, "app.db");

const CATEGORY_LABELS = ["Again", "Hard", "Good", "Easy"];

function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function runSql(sql) {
  ensureDataDirs();
  execSync(`sqlite3 ${shellq(DB_FILE)} "${sql.replace(/"/g, '""')}"`);
}

function runSqlBatch(statements) {
  if (!statements.length) return;
  const script = statements.join(";\n");
  runSql(script);
}

function runQuery(sql) {
  ensureDataDirs();
  const out = execSync(`sqlite3 -json ${shellq(DB_FILE)} "${sql.replace(/"/g, '""')}"`, { encoding: "utf8" });
  if (!out.trim()) return [];
  return JSON.parse(out);
}

function shellq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tableHasColumn(table, column) {
  const rows = runQuery(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

function initDb() {
  ensureDataDirs();
  runSql(
    `
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      filename TEXT
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      image TEXT,
      UNIQUE(deck_id, question, answer)
    );
    CREATE TABLE IF NOT EXISTS progress (
      card_id INTEGER PRIMARY KEY,
      deck_id TEXT NOT NULL,
      category TEXT NOT NULL,
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ratings (
      card_id INTEGER PRIMARY KEY,
      deck_id TEXT NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('up','down')),
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
    `
  );

  const existingDecks = getDecksFromDb();
  if (existingDecks.length === 0) {
    seedFromCsv();
  }
  migrateProgressRatingsToCardIds();
}

function getDecksFromDb() {
  const rows = runQuery(`SELECT id, title, filename FROM decks ORDER BY id`);
  return rows;
}

function seedFromCsv() {
  if (!fs.existsSync(QUESTIONS_DIR)) return;
  const files = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
  files.forEach((file) => {
    const deckId = path.basename(file, path.extname(file));
    const title = deckId.replace(/[-_]+/g, " ");
    runSql(`INSERT OR IGNORE INTO decks (id, title, filename) VALUES (${q(deckId)}, ${q(title)}, ${q(file)})`);
    const cards = parseCsvQuestions(path.join(QUESTIONS_DIR, file));
    const values = cards
      .map((c) => `(${q(deckId)}, ${q(c.question)}, ${q(c.answer)}, NULL)`)
      .join(",");
    if (values) {
      runSql(`INSERT OR IGNORE INTO cards (deck_id, question, answer, image) VALUES ${values}`);
    }
  });
}

function migrateProgressRatingsToCardIds() {
  // If progress already uses card_id, nothing to do.
  if (tableHasColumn("progress", "card_id") && !tableHasColumn("progress", "card_key")) {
    return;
  }
  // Migrate progress
  runSqlBatch([
    `CREATE TABLE IF NOT EXISTS progress_new (
      card_id INTEGER PRIMARY KEY,
      deck_id TEXT NOT NULL,
      category TEXT NOT NULL,
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`,
    `INSERT OR IGNORE INTO progress_new (card_id, deck_id, category)
     SELECT c.id, c.deck_id, p.category
     FROM progress p
     JOIN cards c ON (c.question || '|||' || c.answer) = p.card_key`,
    `DROP TABLE progress`,
    `ALTER TABLE progress_new RENAME TO progress`,
  ]);

  // Migrate ratings
  runSqlBatch([
    `CREATE TABLE IF NOT EXISTS ratings_new (
      card_id INTEGER PRIMARY KEY,
      deck_id TEXT NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('up','down')),
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
    )`,
    `INSERT OR IGNORE INTO ratings_new (card_id, deck_id, rating)
     SELECT c.id, c.deck_id, r.rating
     FROM ratings r
     JOIN cards c ON (c.question || '|||' || c.answer) = r.card_key`,
    `DROP TABLE ratings`,
    `ALTER TABLE ratings_new RENAME TO ratings`,
  ]);
}

function listDecks() {
  return getDecksFromDb();
}

function parseCsvQuestions(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = smartSplit(lines[i], ";");
    if (cols.length < 2) continue;
    rows.push({ question: cols[0].trim(), answer: cols[1].trim() });
  }
  return rows;
}

// Basic CSV splitter that supports double-quoted values with commas.
function smartSplit(line, delimiter = ",") {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function getDeck(deckId) {
  const deckRow = runQuery(`SELECT id, title, filename FROM decks WHERE id = ${q(deckId)} LIMIT 1`)[0];
  if (!deckRow) return null;
  const cards = runQuery(`SELECT id, question, answer, image FROM cards WHERE deck_id = ${q(deckId)} ORDER BY id`);
  const enriched = cards.map((c) => {
    return {
      ...c,
      image: c.image ? `/media/${c.image}` : null,
    };
  });
  return { ...deckRow, cards: enriched };
}

function cardKey(card) {
  return `${card.question}|||${card.answer}`;
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function serveStatic(req, res) {
  const publicDir = path.join(__dirname, "public");
  const mediaDir = MEDIA_DIR;
  const urlPath = req.url.split("?")[0].replace(/\/+$/, "") || "/";
  if (urlPath.startsWith("/media/")) {
    const filePath = path.join(mediaDir, urlPath.replace("/media/", ""));
    if (filePath.startsWith(mediaDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const stream = fs.createReadStream(filePath);
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      stream.pipe(res);
      return true;
    }
    return false;
  }
  const filePath = urlPath === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, urlPath.slice(1));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end();
    return true;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const stream = fs.createReadStream(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    stream.pipe(res);
    return true;
  }
  return false;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript";
  if (ext === ".css") return "text/css";
  if (ext === ".json") return "application/json";
  if (ext === ".svg") return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1e6) req.destroy();
    });
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (req.method === "GET" && url.pathname === "/api/decks") {
      return sendJson(res, 200, { decks: listDecks() });
    }

    if (req.method === "GET" && pathParts[0] === "api" && pathParts[1] === "decks" && pathParts[2]) {
      const deck = getDeck(pathParts[2]);
      if (!deck) return sendJson(res, 404, { error: "Deck not found" });
      const progressRows = runQuery(`SELECT card_id, category FROM progress WHERE deck_id = ${q(deck.id)}`);
      const progress = Object.fromEntries(progressRows.map((p) => [String(p.card_id), p.category]));
      const ratingRows = runQuery(`SELECT card_id, rating FROM ratings WHERE deck_id = ${q(deck.id)}`);
      const ratings = Object.fromEntries(ratingRows.map((r) => [String(r.card_id), r.rating]));
      return sendJson(res, 200, { ...deck, progress, ratings, categories: CATEGORY_LABELS });
    }

    if (req.method === "POST" && pathParts[0] === "api" && pathParts[1] === "decks" && pathParts[2] && pathParts[3] === "progress") {
      const body = await parseBody(req);
      const { cardId, category } = body || {};
      if (cardId === undefined || cardId === null) return sendJson(res, 400, { error: "cardId is required" });
      if (!CATEGORY_LABELS.includes(category)) return sendJson(res, 400, { error: "Invalid category" });
      runSql(`INSERT OR REPLACE INTO progress (card_id, deck_id, category) VALUES (${q(cardId)}, ${q(pathParts[2])}, ${q(category)})`);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathParts[0] === "api" && pathParts[1] === "admin" && pathParts[2] === "decks" && pathParts[3]) {
      const deckId = pathParts[3];
      const deck = getDeck(deckId);
      if (!deck) return sendJson(res, 404, { error: "Deck not found" });
      const body = await parseBody(req);
      if (!body || !Array.isArray(body.cards)) return sendJson(res, 400, { error: "cards array required" });

      const existing = runQuery(`SELECT id, question, answer, image FROM cards WHERE deck_id = ${q(deckId)}`);
      const existingById = new Map(existing.map((c) => [c.id, c]));

      const rows = [];
      const insertValues = [];
      const updateStatements = [];
      const keepIds = new Set();

      for (const item of body.cards) {
        if (!item.question || !item.answer) continue;
        const question = String(item.question);
        const answer = String(item.answer);
        const existingCard = item.id ? existingById.get(item.id) : null;

        let filename = null;
        if (item.imageData && typeof item.imageData === "string" && item.imageData.startsWith("data:")) {
          filename = saveDataUrl(item.imageData, deckId);
        } else if (item.imagePath && typeof item.imagePath === "string") {
          filename = path.basename(item.imagePath.replace("/media/", ""));
        } else if (item.removeImage) {
          filename = null;
        } else if (existingCard && existingCard.image) {
          filename = existingCard.image;
        }

        if (existingCard) {
          keepIds.add(existingCard.id);
          updateStatements.push(
            `UPDATE cards SET question=${q(question)}, answer=${q(answer)}, image=${filename ? q(filename) : "NULL"} WHERE id=${existingCard.id}`
          );
        } else {
          insertValues.push(`(${q(deckId)}, ${q(question)}, ${q(answer)}, ${filename ? q(filename) : "NULL"})`);
        }
        rows.push({ question, answer });
      }

      const stmts = [`BEGIN`];
      if (updateStatements.length) stmts.push(...updateStatements);
      if (insertValues.length) stmts.push(`INSERT INTO cards (deck_id, question, answer, image) VALUES ${insertValues.join(",")}`);
      const keepList = [...keepIds].join(",");
      stmts.push(`DELETE FROM cards WHERE deck_id = ${q(deckId)}${keepIds.size ? ` AND id NOT IN (${keepList})` : ""}`);
      stmts.push(`DELETE FROM progress WHERE deck_id = ${q(deckId)} AND card_id NOT IN (SELECT id FROM cards WHERE deck_id=${q(deckId)})`);
      stmts.push(`DELETE FROM ratings WHERE deck_id = ${q(deckId)} AND card_id NOT IN (SELECT id FROM cards WHERE deck_id=${q(deckId)})`);
      stmts.push(`COMMIT`);
      runSqlBatch(stmts);

      writeDeckCsv(deckId, rows, deck.filename);
      cleanupUnusedMedia();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && pathParts[0] === "api" && pathParts[1] === "decks" && pathParts[2] && pathParts[3] === "rating") {
      const deckId = pathParts[2];
      const body = await parseBody(req);
      const { cardId, rating } = body || {};
      if (cardId === undefined || cardId === null) return sendJson(res, 400, { error: "cardId is required" });
      if (rating !== "up" && rating !== "down" && rating !== null) return sendJson(res, 400, { error: "rating must be up, down, or null" });
      if (rating === null) {
        runSql(`DELETE FROM ratings WHERE card_id = ${q(cardId)} AND deck_id = ${q(deckId)}`);
      } else {
        runSql(`INSERT OR REPLACE INTO ratings (card_id, deck_id, rating) VALUES (${q(cardId)}, ${q(deckId)}, ${q(rating)})`);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      res.end();
      return;
    }

    if (serveStatic(req, res)) return;
    res.writeHead(404).end("Not found");
  });
}

function writeDeckCsv(deckId, rows, filename) {
  if (!filename) return;
  const filePath = path.join(QUESTIONS_DIR, filename);
  const lines = ["Въпрос;Отговор"];
  for (const r of rows) {
    lines.push(`${escapeCsv(r.question)};${escapeCsv(r.answer)}`);
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function escapeCsv(value) {
  const needsQuotes = /[;"\n]/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function saveDataUrl(dataUrl, deckId) {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid image data");
  const mime = match[1];
  const ext = mimeToExt(mime);
  const buffer = Buffer.from(match[2], "base64");
  const filename = `${deckId}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
  return filename;
}

function mimeToExt(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}

function cleanupUnusedMedia() {
  const used = new Set(runQuery("SELECT image FROM cards WHERE image IS NOT NULL").map((row) => row.image));
  const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];
  files.forEach((file) => {
    if (!used.has(file)) {
      const filePath = path.join(MEDIA_DIR, file);
      fs.unlinkSync(filePath);
    }
  });
}

initDb();

if (require.main === module) {
  const server = createServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Flashcards server running on http://localhost:${port}`);
  });
}

module.exports = { createServer };
