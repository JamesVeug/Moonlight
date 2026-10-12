const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const morgan = require("morgan");
const dotenv = require("dotenv");
const { query } = require("./db");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const app = express();
const port = Number(process.env.PORT || 8787);
const allowEdits = String(process.env.ALLOW_EDITS || "false").toLowerCase() === "true";
const adminUser = process.env.ADMIN_USERNAME || "admin";
const adminPass = process.env.ADMIN_PASSWORD || "change-me";

const logsDir = path.join(__dirname, "..", "logs");
const auditFilePath = path.join(logsDir, "audit.log");
const rollbackDir = path.join(logsDir, "rollback");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
if (!fs.existsSync(rollbackDir)) {
  fs.mkdirSync(rollbackDir, { recursive: true });
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("tiny"));
app.use("/public", express.static(path.join(__dirname, "..", "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "moonlight-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 12,
    },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.user === adminUser) {
    return next();
  }
  return res.redirect("/login");
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function appendAudit(event) {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`;
  fs.appendFileSync(auditFilePath, line, "utf8");
}

function rollbackSqlForDropRow(row) {
  return [
    `-- rollback for mob_drops row ${row.id}`,
    `UPDATE mob_drops`,
    `SET chance = ${row.chance}, minquant = ${row.minquant}, maxquant = ${row.maxquant}`,
    `WHERE id = ${row.id};`,
    "",
  ].join("\n");
}

function writeRollbackSql(row) {
  const filename = `rollback_drop_${row.id}_${Date.now()}.sql`;
  const fullPath = path.join(rollbackDir, filename);
  fs.writeFileSync(fullPath, rollbackSqlForDropRow(row), "utf8");
  return fullPath;
}

app.get("/", (req, res) => {
  if (req.session && req.session.user === adminUser) {
    return res.redirect("/dashboard");
  }
  return res.redirect("/login");
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  if (username === adminUser && password === adminPass) {
    req.session.user = username;
    return res.redirect("/dashboard");
  }
  return res.status(401).render("login", { error: "Invalid credentials." });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/dashboard", requireAuth, (req, res) => {
  res.render("dashboard", {
    allowEdits,
    resultType: null,
    rows: [],
    searchedValue: null,
    error: null,
  });
});

app.get("/spawn-hints", requireAuth, (req, res) => {
  res.render("spawn-hints", {
    result: null,
    error: null,
  });
});

app.post("/spawn-hints", requireAuth, async (req, res) => {
  const mobId = toInt(req.body.mobId, -1);
  if (mobId < 0) {
    return res.status(400).render("spawn-hints", {
      result: null,
      error: "Please enter a valid mob ID.",
    });
  }
  try {
    const drops = await query(
      "SELECT id, itemid, chance, minquant, maxquant FROM mob_drops WHERE mobid = ? ORDER BY chance DESC, itemid ASC",
      [mobId]
    );
    const collectionRows = await query(
      "SELECT mobid, region, session, position FROM monster_collection WHERE mobid = ? ORDER BY region ASC, session ASC, position ASC",
      [mobId]
    );
    return res.render("spawn-hints", {
      error: null,
      result: {
        mobId,
        drops,
        collectionRows,
      },
    });
  } catch (err) {
    return res.status(500).render("spawn-hints", {
      result: null,
      error: `DB error: ${err.message}`,
    });
  }
});

app.get("/account-rescue", requireAuth, (req, res) => {
  res.render("account-rescue", {
    error: null,
    result: null,
  });
});

app.post("/account-rescue", requireAuth, async (req, res) => {
  const username = String(req.body.username || "").trim();
  if (!username) {
    return res.status(400).render("account-rescue", {
      error: "Please enter a username.",
      result: null,
    });
  }

  try {
    const users = await query(
      "SELECT id, name, accounttype FROM users WHERE name = ? LIMIT 1",
      [username]
    );
    if (!users.length) {
      return res.status(404).render("account-rescue", {
        error: `User '${username}' not found.`,
        result: null,
      });
    }

    const user = users[0];
    const guildMembersResult = await query(
      "UPDATE guildmembers SET loggedin = 0 WHERE name = ?",
      [username]
    );
    const guildRequestorsResult = await query(
      "UPDATE guildrequestors SET loggedin = 0 WHERE name = ?",
      [username]
    );

    appendAudit({
      actor: req.session.user,
      action: "account_rescue_cleanup",
      username,
      userId: user.id,
      guildmembersAffected: guildMembersResult.affectedRows || 0,
      guildrequestorsAffected: guildRequestorsResult.affectedRows || 0,
    });

    return res.render("account-rescue", {
      error: null,
      result: {
        user,
        guildmembersAffected: guildMembersResult.affectedRows || 0,
        guildrequestorsAffected: guildRequestorsResult.affectedRows || 0,
        runtimeNote:
          "AlreadyConnected lock is in JVM memory (Server.users set). Use !unstuckuser <name> from a Tester+ account after server patch deployment.",
      },
    });
  } catch (err) {
    return res.status(500).render("account-rescue", {
      error: `DB error: ${err.message}`,
      result: null,
    });
  }
});

app.post("/search/item", requireAuth, async (req, res) => {
  const itemId = toInt(req.body.itemId, -1);
  if (itemId < 0) {
    return res.status(400).render("dashboard", {
      allowEdits,
      resultType: null,
      rows: [],
      searchedValue: null,
      error: "Please enter a valid item ID.",
    });
  }
  try {
    const rows = await query(
      "SELECT id, mobid, itemid, chance, minquant, maxquant FROM mob_drops WHERE itemid = ? ORDER BY chance DESC, mobid ASC",
      [itemId]
    );
    return res.render("dashboard", {
      allowEdits,
      resultType: "item",
      rows,
      searchedValue: itemId,
      error: null,
    });
  } catch (err) {
    return res.status(500).render("dashboard", {
      allowEdits,
      resultType: null,
      rows: [],
      searchedValue: null,
      error: `DB error: ${err.message}`,
    });
  }
});

app.post("/search/mob", requireAuth, async (req, res) => {
  const mobId = toInt(req.body.mobId, -1);
  if (mobId < 0) {
    return res.status(400).render("dashboard", {
      allowEdits,
      resultType: null,
      rows: [],
      searchedValue: null,
      error: "Please enter a valid mob ID.",
    });
  }
  try {
    const rows = await query(
      "SELECT id, mobid, itemid, chance, minquant, maxquant FROM mob_drops WHERE mobid = ? ORDER BY chance DESC, itemid ASC",
      [mobId]
    );
    return res.render("dashboard", {
      allowEdits,
      resultType: "mob",
      rows,
      searchedValue: mobId,
      error: null,
    });
  } catch (err) {
    return res.status(500).render("dashboard", {
      allowEdits,
      resultType: null,
      rows: [],
      searchedValue: null,
      error: `DB error: ${err.message}`,
    });
  }
});

app.get("/drop/:id", requireAuth, async (req, res) => {
  const dropId = toInt(req.params.id, -1);
  if (dropId < 0) {
    return res.status(400).send("Invalid row ID.");
  }
  try {
    const rows = await query(
      "SELECT id, mobid, itemid, chance, minquant, maxquant FROM mob_drops WHERE id = ?",
      [dropId]
    );
    if (!rows.length) {
      return res.status(404).send("Drop row not found.");
    }
    return res.render("drop-edit", {
      allowEdits,
      row: rows[0],
      message: null,
      error: null,
    });
  } catch (err) {
    return res.status(500).send(`DB error: ${err.message}`);
  }
});

app.post("/drop/:id/preview", requireAuth, async (req, res) => {
  const dropId = toInt(req.params.id, -1);
  const chance = toInt(req.body.chance, -1);
  const minquant = toInt(req.body.minquant, -1);
  const maxquant = toInt(req.body.maxquant, -1);

  if (dropId < 0 || chance < 0 || minquant < 0 || maxquant < 0 || minquant > maxquant) {
    return res.status(400).send("Invalid update values.");
  }

  try {
    const existing = await query(
      "SELECT id, mobid, itemid, chance, minquant, maxquant FROM mob_drops WHERE id = ?",
      [dropId]
    );
    if (!existing.length) {
      return res.status(404).send("Drop row not found.");
    }
    const after = {
      id: existing[0].id,
      mobid: existing[0].mobid,
      itemid: existing[0].itemid,
      chance,
      minquant,
      maxquant,
    };
    return res.render("drop-preview", {
      allowEdits,
      before: existing[0],
      after,
      rollbackSql: rollbackSqlForDropRow(existing[0]),
      error: null,
    });
  } catch (err) {
    return res.status(500).send(`DB error: ${err.message}`);
  }
});

app.post("/drop/:id/apply", requireAuth, async (req, res) => {
  if (!allowEdits) {
    return res.status(403).send("Edits are disabled. Set ALLOW_EDITS=true in .env");
  }

  const dropId = toInt(req.params.id, -1);
  const chance = toInt(req.body.chance, -1);
  const minquant = toInt(req.body.minquant, -1);
  const maxquant = toInt(req.body.maxquant, -1);
  const confirmApply = String(req.body.confirmApply || "");

  if (
    dropId < 0 ||
    chance < 0 ||
    minquant < 0 ||
    maxquant < 0 ||
    minquant > maxquant ||
    confirmApply !== "YES"
  ) {
    return res.status(400).send("Invalid update values.");
  }

  try {
    const existing = await query(
      "SELECT id, mobid, itemid, chance, minquant, maxquant FROM mob_drops WHERE id = ?",
      [dropId]
    );
    if (!existing.length) {
      return res.status(404).send("Drop row not found.");
    }

    await query(
      "UPDATE mob_drops SET chance = ?, minquant = ?, maxquant = ? WHERE id = ?",
      [chance, minquant, maxquant, dropId]
    );

    const rollbackPath = writeRollbackSql(existing[0]);

    const updated = await query(
      "SELECT id, mobid, itemid, chance, minquant, maxquant FROM mob_drops WHERE id = ?",
      [dropId]
    );

    appendAudit({
      actor: req.session.user,
      action: "update_mob_drop",
      dropId,
      before: existing[0],
      after: updated[0],
      rollbackSql: rollbackPath,
    });

    return res.render("drop-edit", {
      allowEdits,
      row: updated[0],
      message: `Updated successfully. Rollback file: ${rollbackPath}`,
      error: null,
    });
  } catch (err) {
    return res.status(500).send(`DB error: ${err.message}`);
  }
});

app.get("/health", async (req, res) => {
  try {
    await query("SELECT 1 AS ok");
    return res.json({ ok: true, db: true });
  } catch (err) {
    return res.status(500).json({ ok: false, db: false, error: err.message });
  }
});

app.listen(port, () => {
  // Keep startup output small and explicit for local ops.
  console.log(`Moonlight admin panel listening on http://localhost:${port}`);
});
