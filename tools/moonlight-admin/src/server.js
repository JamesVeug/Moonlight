const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const morgan = require("morgan");
const dotenv = require("dotenv");
const { query } = require("./db");
const {
  EQUIPMENT_GROUP_LABELS,
  getItemCategory,
  loadCatalog,
  searchByName,
} = require("./catalog");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const app = express();
const port = Number(process.env.PORT || 8787);
const allowEdits = String(process.env.ALLOW_EDITS || "false").toLowerCase() === "true";
const allowServerControl = String(process.env.ALLOW_SERVER_CONTROL || "false").toLowerCase() === "true";
const adminUser = process.env.ADMIN_USERNAME || "admin";
const adminPass = process.env.ADMIN_PASSWORD || "change-me";
const catalog = loadCatalog();

const logsDir = path.join(__dirname, "..", "logs");
const auditFilePath = path.join(logsDir, "audit.log");
const rollbackDir = path.join(logsDir, "rollback");
const deployLogPath = path.join(logsDir, "server-deploy.log");
const deployScriptPath = path.join(__dirname, "..", "scripts", "Deploy-ServerUpdate.ps1");
const repoRoot = path.resolve(__dirname, "..", "..", "..");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
if (!fs.existsSync(rollbackDir)) {
  fs.mkdirSync(rollbackDir, { recursive: true });
}

const deployState = {
  running: false,
  action: null,
  startedAt: null,
  finishedAt: null,
  success: null,
  exitCode: null,
  triggeredBy: null,
  error: null,
  lines: [],
};

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

function appendDeployLine(message) {
  const line = String(message || "").trim();
  if (!line) {
    return;
  }
  const stamped = `[${new Date().toISOString()}] ${line}`;
  deployState.lines.push(stamped);
  if (deployState.lines.length > 500) {
    deployState.lines.splice(0, deployState.lines.length - 500);
  }
  fs.appendFileSync(deployLogPath, `${stamped}\n`, "utf8");
}

function deployStatusSnapshot() {
  return {
    running: deployState.running,
    action: deployState.action,
    startedAt: deployState.startedAt,
    finishedAt: deployState.finishedAt,
    success: deployState.success,
    exitCode: deployState.exitCode,
    triggeredBy: deployState.triggeredBy,
    error: deployState.error,
    lines: [...deployState.lines],
  };
}

function startServerWorkflow(actorName, action) {
  const normalizedAction = action === "restart" ? "restart" : "deploy";
  const actionLabel = normalizedAction === "restart" ? "Restart-only" : "Deploy";

  if (deployState.running) {
    return { started: false, reason: "A server workflow is already in progress." };
  }
  if (!fs.existsSync(deployScriptPath)) {
    return { started: false, reason: `Deploy script not found: ${deployScriptPath}` };
  }

  deployState.running = true;
  deployState.action = normalizedAction;
  deployState.startedAt = new Date().toISOString();
  deployState.finishedAt = null;
  deployState.success = null;
  deployState.exitCode = null;
  deployState.triggeredBy = actorName;
  deployState.error = null;
  deployState.lines = [];

  appendDeployLine(`${actionLabel} workflow requested by ${actorName}.`);
  appendDeployLine("Starting PowerShell workflow script.");

  const psArgs = ["-ExecutionPolicy", "Bypass", "-File", deployScriptPath];
  if (normalizedAction === "restart") {
    psArgs.push("-RestartOnly");
  }

  const child = spawn(
    "powershell",
    psArgs,
    {
      cwd: repoRoot,
      windowsHide: true,
    }
  );

  child.stdout.on("data", (chunk) => {
    const text = String(chunk || "");
    text.split(/\r?\n/).forEach((line) => appendDeployLine(line));
  });

  child.stderr.on("data", (chunk) => {
    const text = String(chunk || "");
    text.split(/\r?\n/).forEach((line) => appendDeployLine(`[stderr] ${line}`));
  });

  child.on("error", (err) => {
    deployState.running = false;
    deployState.finishedAt = new Date().toISOString();
    deployState.success = false;
    deployState.exitCode = -1;
    deployState.error = err.message;
    appendDeployLine(`Failed to start deploy process: ${err.message}`);
  });

  child.on("close", (code) => {
    deployState.running = false;
    deployState.finishedAt = new Date().toISOString();
    deployState.exitCode = Number.isInteger(code) ? code : -1;
    deployState.success = code === 0;
    if (code === 0) {
      appendDeployLine(`${actionLabel} workflow finished successfully.`);
    } else {
      deployState.error = `${actionLabel} workflow failed with exit code ${code}.`;
      appendDeployLine(deployState.error);
    }
  });

  return { started: true };
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

function getMobName(mobId) {
  return catalog.mobNames.get(Number(mobId)) || null;
}

function getItemName(itemId) {
  return catalog.itemNames.get(Number(itemId)) || null;
}

function enrichDropRows(rows) {
  return rows.map((row) => {
    const itemMeta = getItemCategory(row.itemid);
    return {
      ...row,
      mobName: getMobName(row.mobid),
      itemName: getItemName(row.itemid),
      itemMajorLabel: itemMeta.majorLabel,
      itemSlotLabel: itemMeta.equipmentSlotLabel || null,
    };
  });
}

function renderDashboard(res, values = {}) {
  return res.render("dashboard", {
    allowEdits,
    allowServerControl,
    resultType: null,
    rows: [],
    searchedValue: null,
    searchQuery: null,
    searchBy: null,
    resultSummary: null,
    error: null,
    catalogStats: catalog.stats,
    ...values,
  });
}

function renderServerOps(res, values = {}) {
  return res.render("server-ops", {
    allowServerControl,
    deploy: deployStatusSnapshot(),
    error: null,
    message: null,
    ...values,
  });
}

function toIntSet(values) {
  const out = [];
  for (const value of values) {
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isFinite(parsed)) {
      out.push(parsed);
    }
  }
  return [...new Set(out)];
}

async function queryDropsById(kind, id) {
  if (kind === "item") {
    const rows = await query(
      "SELECT id, mobid, itemid, chance, minquant, maxquant FROM mob_drops WHERE itemid = ? ORDER BY chance DESC, mobid ASC",
      [id]
    );
    return rows;
  }
  const rows = await query(
    "SELECT id, mobid, itemid, chance, minquant, maxquant FROM mob_drops WHERE mobid = ? ORDER BY chance DESC, itemid ASC",
    [id]
  );
  return rows;
}

async function queryDropsByManyIds(column, ids, rowLimit = 1500) {
  if (!ids.length) {
    return [];
  }
  const placeholders = ids.map(() => "?").join(",");
  const sql =
    `SELECT id, mobid, itemid, chance, minquant, maxquant FROM mob_drops ` +
    `WHERE ${column} IN (${placeholders}) ORDER BY chance DESC, mobid ASC LIMIT ${rowLimit}`;
  return query(sql, ids);
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
  renderDashboard(res);
});

app.get("/ops/server", requireAuth, (req, res) => {
  renderServerOps(res);
});

app.get("/ops/server/status", requireAuth, (req, res) => {
  return res.json({
    allowServerControl,
    deploy: deployStatusSnapshot(),
  });
});

app.post("/ops/server/deploy", requireAuth, (req, res) => {
  if (!allowServerControl) {
    return renderServerOps(res.status(403), {
      error: "Server control is disabled. Set ALLOW_SERVER_CONTROL=true in moonlight-admin .env.",
    });
  }

  const confirmDeploy = String(req.body.confirmDeploy || "").trim();
  if (confirmDeploy !== "DEPLOY") {
    return renderServerOps(res.status(400), {
      error: 'Type DEPLOY exactly to confirm this operation.',
    });
  }

  const actor = req.session?.user || "unknown";
  const startResult = startServerWorkflow(actor, "deploy");
  if (!startResult.started) {
    return renderServerOps(res.status(409), {
      error: startResult.reason,
    });
  }

  appendAudit({
    actor,
    action: "server_deploy_requested",
    source: "moonlight_admin",
  });

  return renderServerOps(res, {
    message: "Deploy started. This page will stream status/output.",
  });
});

app.post("/ops/server/restart", requireAuth, (req, res) => {
  if (!allowServerControl) {
    return renderServerOps(res.status(403), {
      error: "Server control is disabled. Set ALLOW_SERVER_CONTROL=true in moonlight-admin .env.",
    });
  }

  const confirmRestart = String(req.body.confirmRestart || "").trim();
  if (confirmRestart !== "RESTART") {
    return renderServerOps(res.status(400), {
      error: 'Type RESTART exactly to confirm restart-only workflow.',
    });
  }

  const actor = req.session?.user || "unknown";
  const startResult = startServerWorkflow(actor, "restart");
  if (!startResult.started) {
    return renderServerOps(res.status(409), {
      error: startResult.reason,
    });
  }

  appendAudit({
    actor,
    action: "server_restart_requested",
    source: "moonlight_admin",
  });

  return renderServerOps(res, {
    message: "Restart-only workflow started. This page will stream status/output.",
  });
});

app.get("/browse/equipment", requireAuth, async (req, res) => {
  const requestedGroup = String(req.query.group || "all").trim().toLowerCase();
  const requestedSlot = toInt(req.query.slot, 0);

  try {
    const rows = await query(
      "SELECT itemid, COUNT(*) AS dropRows, MAX(chance) AS topChance, MAX(maxquant) AS maxQty FROM mob_drops WHERE itemid BETWEEN 1000000 AND 1999999 GROUP BY itemid"
    );

    const equipmentRows = rows
      .map((row) => {
        const itemId = Number(row.itemid);
        const category = getItemCategory(itemId);
        return {
          itemId,
          name: getItemName(itemId),
          dropRows: Number(row.dropRows) || 0,
          topChance: Number(row.topChance) || 0,
          maxQty: Number(row.maxQty) || 0,
          slotCode: category.equipmentSlot,
          slotLabel: category.equipmentSlotLabel || "Other",
          groupKey: category.equipmentGroup || "other",
          groupLabel: category.equipmentGroupLabel || EQUIPMENT_GROUP_LABELS.other,
        };
      })
      .filter((row) => Number.isInteger(row.slotCode) && row.slotCode > 0);

    const groupCounts = new Map();
    const slotMap = new Map();
    for (const row of equipmentRows) {
      groupCounts.set(row.groupKey, (groupCounts.get(row.groupKey) || 0) + 1);
      if (!slotMap.has(row.slotCode)) {
        slotMap.set(row.slotCode, {
          slotCode: row.slotCode,
          slotLabel: row.slotLabel,
          groupKey: row.groupKey,
          groupLabel: row.groupLabel,
          count: 0,
        });
      }
      slotMap.get(row.slotCode).count += 1;
    }

    const groups = [
      { key: "all", label: "All Equipment", count: equipmentRows.length },
      ...Object.entries(EQUIPMENT_GROUP_LABELS).map(([key, label]) => ({
        key,
        label,
        count: groupCounts.get(key) || 0,
      })),
    ].map((group) => ({
      ...group,
      isActive: requestedGroup === group.key,
    }));

    const validGroupKeys = new Set(groups.map((group) => group.key));
    const activeGroup = validGroupKeys.has(requestedGroup) ? requestedGroup : "all";

    let filteredByGroup = equipmentRows;
    if (activeGroup !== "all") {
      filteredByGroup = equipmentRows.filter((row) => row.groupKey === activeGroup);
    }

    const slots = [...slotMap.values()]
      .filter((slot) => activeGroup === "all" || slot.groupKey === activeGroup)
      .sort((a, b) => {
        if (a.slotLabel !== b.slotLabel) {
          return a.slotLabel.localeCompare(b.slotLabel);
        }
        return a.slotCode - b.slotCode;
      })
      .map((slot) => ({
        ...slot,
        isActive: requestedSlot === slot.slotCode,
      }));

    const validSlotCodes = new Set(slots.map((slot) => slot.slotCode));
    const activeSlotCode = validSlotCodes.has(requestedSlot) ? requestedSlot : 0;

    const filteredRows = activeSlotCode
      ? filteredByGroup.filter((row) => row.slotCode === activeSlotCode)
      : filteredByGroup;

    filteredRows.sort((a, b) => {
      if (Boolean(a.name) !== Boolean(b.name)) {
        return a.name ? -1 : 1;
      }
      if (a.name && b.name && a.name !== b.name) {
        return a.name.localeCompare(b.name);
      }
      return a.itemId - b.itemId;
    });

    const activeSlot = activeSlotCode
      ? slots.find((slot) => slot.slotCode === activeSlotCode) || null
      : null;

    return res.render("browse-equipment", {
      allowEdits,
      groups,
      activeGroup,
      slots,
      activeSlot,
      rows: filteredRows.slice(0, 450),
      totalRows: filteredRows.length,
      catalogStats: catalog.stats,
      error: null,
    });
  } catch (err) {
    return res.status(500).render("browse-equipment", {
      allowEdits,
      groups: [
        { key: "all", label: "All Equipment", count: 0, isActive: true },
        ...Object.entries(EQUIPMENT_GROUP_LABELS).map(([key, label]) => ({
          key,
          label,
          count: 0,
          isActive: false,
        })),
      ],
      activeGroup: "all",
      slots: [],
      activeSlot: null,
      rows: [],
      totalRows: 0,
      catalogStats: catalog.stats,
      error: `DB error: ${err.message}`,
    });
  }
});

app.get("/browse/equipment/accessory", requireAuth, (req, res) => {
  const legacySlotCodes = {
    badge: 118,
    belt: 113,
    earring: 103,
    eye: 102,
    face: 101,
    medal: 114,
    pendant: 112,
    pocket: 116,
    ring: 111,
    shoulder: 115,
  };
  const rawSlot = String(req.query.slot || "").trim().toLowerCase();
  const slotCode = legacySlotCodes[rawSlot] || toInt(req.query.slot, 0);
  const slotQuery = slotCode > 0 ? `&slot=${slotCode}` : "";
  return res.redirect(`/browse/equipment?group=accessory${slotQuery}`);
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
    return renderDashboard(res.status(400), {
      error: "Please enter a valid item ID.",
    });
  }
  try {
    const rows = await queryDropsById("item", itemId);
    return renderDashboard(res, {
      resultType: "item",
      rows: enrichDropRows(rows),
      searchedValue: itemId,
      resultSummary: getItemName(itemId) || null,
    });
  } catch (err) {
    return renderDashboard(res.status(500), {
      error: `DB error: ${err.message}`,
    });
  }
});

app.get("/search/item/:itemId", requireAuth, async (req, res) => {
  const itemId = toInt(req.params.itemId, -1);
  if (itemId < 0) {
    return renderDashboard(res.status(400), { error: "Invalid item ID." });
  }
  try {
    const rows = await queryDropsById("item", itemId);
    return renderDashboard(res, {
      resultType: "item",
      rows: enrichDropRows(rows),
      searchedValue: itemId,
      resultSummary: getItemName(itemId) || null,
    });
  } catch (err) {
    return renderDashboard(res.status(500), { error: `DB error: ${err.message}` });
  }
});

app.post("/search/item-name", requireAuth, async (req, res) => {
  const itemQuery = String(req.body.itemQuery || "").trim();
  if (itemQuery.length < 2) {
    return renderDashboard(res.status(400), {
      error: "Please enter at least 2 characters for item search.",
      searchQuery: itemQuery,
      searchBy: "item-name",
    });
  }

  try {
    const matches = searchByName(catalog.itemNames, itemQuery, 120);
    const itemIds = toIntSet(matches.map((m) => m.id));
    if (!itemIds.length) {
      return renderDashboard(res, {
        resultType: "item-name",
        rows: [],
        searchQuery: itemQuery,
        searchBy: "item-name",
      });
    }

    const rows = await queryDropsByManyIds("itemid", itemIds, 1800);
    return renderDashboard(res, {
      resultType: "item-name",
      rows: enrichDropRows(rows),
      searchQuery: itemQuery,
      searchBy: "item-name",
      resultSummary: `${itemIds.length} matching item IDs`,
    });
  } catch (err) {
    return renderDashboard(res.status(500), {
      searchQuery: itemQuery,
      searchBy: "item-name",
      error: `DB error: ${err.message}`,
    });
  }
});

app.post("/search/mob", requireAuth, async (req, res) => {
  const mobId = toInt(req.body.mobId, -1);
  if (mobId < 0) {
    return renderDashboard(res.status(400), {
      error: "Please enter a valid mob ID.",
    });
  }
  try {
    const rows = await queryDropsById("mob", mobId);
    return renderDashboard(res, {
      resultType: "mob",
      rows: enrichDropRows(rows),
      searchedValue: mobId,
      resultSummary: getMobName(mobId) || null,
    });
  } catch (err) {
    return renderDashboard(res.status(500), {
      error: `DB error: ${err.message}`,
    });
  }
});

app.get("/search/mob/:mobId", requireAuth, async (req, res) => {
  const mobId = toInt(req.params.mobId, -1);
  if (mobId < 0) {
    return renderDashboard(res.status(400), { error: "Invalid mob ID." });
  }
  try {
    const rows = await queryDropsById("mob", mobId);
    return renderDashboard(res, {
      resultType: "mob",
      rows: enrichDropRows(rows),
      searchedValue: mobId,
      resultSummary: getMobName(mobId) || null,
    });
  } catch (err) {
    return renderDashboard(res.status(500), { error: `DB error: ${err.message}` });
  }
});

app.post("/search/mob-name", requireAuth, async (req, res) => {
  const mobQuery = String(req.body.mobQuery || "").trim();
  if (mobQuery.length < 2) {
    return renderDashboard(res.status(400), {
      error: "Please enter at least 2 characters for mob search.",
      searchQuery: mobQuery,
      searchBy: "mob-name",
    });
  }

  try {
    const matches = searchByName(catalog.mobNames, mobQuery, 120);
    const mobIds = toIntSet(matches.map((m) => m.id));
    if (!mobIds.length) {
      return renderDashboard(res, {
        resultType: "mob-name",
        rows: [],
        searchQuery: mobQuery,
        searchBy: "mob-name",
      });
    }

    const rows = await queryDropsByManyIds("mobid", mobIds, 1800);
    return renderDashboard(res, {
      resultType: "mob-name",
      rows: enrichDropRows(rows),
      searchQuery: mobQuery,
      searchBy: "mob-name",
      resultSummary: `${mobIds.length} matching mobs`,
    });
  } catch (err) {
    return renderDashboard(res.status(500), {
      searchQuery: mobQuery,
      searchBy: "mob-name",
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
