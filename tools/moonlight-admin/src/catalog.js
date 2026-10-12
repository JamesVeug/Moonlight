const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const SQL_SOURCES = [
  path.join(REPO_ROOT, "Server", "sql", "02_Init_Tables_Drops.sql"),
  path.join(REPO_ROOT, "Server", "sql", "04_drops.sql"),
  path.join(REPO_ROOT, "Server", "sql", "09_InitTables_MonsterCollection.sql"),
];

const EQUIPMENT_GROUP_LABELS = {
  accessory: "Accessory",
  armor: "Armour",
  weapon: "Weapon",
  taming: "Taming Mob",
  android: "Android",
  other: "Other Equipment",
};

const EQUIPMENT_SLOT_META = {
  100: { key: "hat", label: "Hat", group: "armor" },
  101: { key: "face", label: "Face Accessory", group: "accessory" },
  102: { key: "eye", label: "Eye Accessory", group: "accessory" },
  103: { key: "earring", label: "Earring", group: "accessory" },
  104: { key: "top", label: "Top", group: "armor" },
  105: { key: "overall", label: "Overall", group: "armor" },
  106: { key: "bottom", label: "Bottom", group: "armor" },
  107: { key: "boots", label: "Boots", group: "armor" },
  108: { key: "gloves", label: "Gloves", group: "armor" },
  109: { key: "shield", label: "Shield", group: "armor" },
  110: { key: "cape", label: "Cape", group: "armor" },
  111: { key: "ring", label: "Ring", group: "accessory" },
  112: { key: "pendant", label: "Pendant", group: "accessory" },
  113: { key: "belt", label: "Belt", group: "accessory" },
  114: { key: "medal", label: "Medal", group: "accessory" },
  115: { key: "shoulder", label: "Shoulderpad", group: "accessory" },
  116: { key: "pocket", label: "Pocket", group: "accessory" },
  118: { key: "badge", label: "Badge", group: "accessory" },
  119: { key: "emblem", label: "Emblem", group: "other" },
  120: { key: "totem", label: "Totem", group: "other" },
  166: { key: "android", label: "Android", group: "android" },
  167: { key: "heart", label: "Heart", group: "other" },
  180: { key: "pet-equip", label: "Pet Equip", group: "other" },
  190: { key: "taming", label: "Taming Mob", group: "taming" },
  191: { key: "saddle", label: "Saddle", group: "taming" },
  193: { key: "monster-riding", label: "Monster Riding", group: "taming" },
};

const EQUIPMENT_SLOT_LABELS = Object.fromEntries(
  Object.entries(EQUIPMENT_SLOT_META).map(([slotCode, meta]) => [Number(slotCode), meta.label])
);

function getEquipmentSlotMeta(slotCode) {
  const normalized = Number(slotCode);
  const known = EQUIPMENT_SLOT_META[normalized];
  if (known) {
    return {
      slotCode: normalized,
      ...known,
      groupLabel: EQUIPMENT_GROUP_LABELS[known.group] || EQUIPMENT_GROUP_LABELS.other,
    };
  }

  if (normalized >= 121 && normalized <= 159) {
    return {
      slotCode: normalized,
      key: `weapon-${normalized}`,
      label: "Weapon",
      group: "weapon",
      groupLabel: EQUIPMENT_GROUP_LABELS.weapon,
    };
  }

  if (normalized >= 190 && normalized <= 199) {
    return {
      slotCode: normalized,
      key: `taming-${normalized}`,
      label: "Taming Mob",
      group: "taming",
      groupLabel: EQUIPMENT_GROUP_LABELS.taming,
    };
  }

  return {
    slotCode: normalized,
    key: `slot-${normalized}`,
    label: `Slot ${normalized}`,
    group: "other",
    groupLabel: EQUIPMENT_GROUP_LABELS.other,
  };
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function humanizeToken(value) {
  return normalizeWhitespace(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/_/g, " ");
}

function setName(map, id, name) {
  const cleanName = normalizeWhitespace(name);
  if (!cleanName || cleanName.toLowerCase() === "empty") {
    return;
  }
  if (!map.has(id) || map.get(id).length < cleanName.length) {
    map.set(id, cleanName);
  }
}

function getItemCategory(itemId) {
  const id = Number(itemId);
  if (!Number.isInteger(id) || id < 0) {
    return { major: "unknown", majorLabel: "Unknown", equipmentSlot: null, equipmentGroup: null };
  }

  const major = Math.floor(id / 1000000);
  const equipmentSlot = major === 1 ? Math.floor(id / 10000) : null;

  if (major === 1) {
    const equipmentSlotMeta = getEquipmentSlotMeta(equipmentSlot);
    return {
      major: "eqp",
      majorLabel: "Equipment",
      equipmentSlot,
      equipmentGroup: equipmentSlotMeta.group,
      equipmentGroupLabel: equipmentSlotMeta.groupLabel,
      equipmentSlotLabel: equipmentSlotMeta.label,
    };
  }

  if (major === 2) {
    return { major: "use", majorLabel: "Use", equipmentSlot: null, equipmentGroup: null };
  }
  if (major === 3) {
    return { major: "setup", majorLabel: "Setup", equipmentSlot: null, equipmentGroup: null };
  }
  if (major === 4) {
    return { major: "etc", majorLabel: "Etc", equipmentSlot: null, equipmentGroup: null };
  }
  if (major === 5) {
    return { major: "cash", majorLabel: "Cash", equipmentSlot: null, equipmentGroup: null };
  }

  return { major: "unknown", majorLabel: "Unknown", equipmentSlot: null, equipmentGroup: null };
}

function parseDropTupleComments(sqlText, itemNames) {
  const tupleCommentRegex = /\(\s*(-?\d+)\s*,\s*(\d+)\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)\s*,?\s*#\s*([^\r\n]+)/g;
  let match;
  while ((match = tupleCommentRegex.exec(sqlText)) !== null) {
    const itemId = Number.parseInt(match[2], 10);
    const itemName = humanizeToken(match[3]);
    if (!Number.isInteger(itemId)) {
      continue;
    }
    setName(itemNames, itemId, itemName);
  }
}

function parseDropSummaryComments(sqlText, itemNames, mobNames) {
  const summaryRegex = /#\s*Mob:\s*(.*?)\s*\((\d+)\)\s*\|\s*Drop:\s*(.*?)\s*\((\d+)\)/g;
  let match;
  while ((match = summaryRegex.exec(sqlText)) !== null) {
    const mobId = Number.parseInt(match[2], 10);
    const itemId = Number.parseInt(match[4], 10);
    if (Number.isInteger(mobId)) {
      setName(mobNames, mobId, humanizeToken(match[1]));
    }
    if (Number.isInteger(itemId)) {
      setName(itemNames, itemId, humanizeToken(match[3]));
    }
  }
}

function parseMobCollectionComments(sqlText, mobNames) {
  const mobCollectionRegex = /\((\d+)\s*,\s*\d+\s*,\s*\d+\s*,\s*\d+\)\s*,?\s*#\s*([^\r\n;]+)/g;
  let match;
  while ((match = mobCollectionRegex.exec(sqlText)) !== null) {
    const mobId = Number.parseInt(match[1], 10);
    if (!Number.isInteger(mobId) || mobId <= 0) {
      continue;
    }
    setName(mobNames, mobId, humanizeToken(match[2]));
  }
}

function parseMobHeaderComments(sqlText, mobNames) {
  const headerRegex = /#\s*([A-Za-z0-9'().,/\-\s]+?)\s+ID\s*=\s*(\d+)/gi;
  let match;
  while ((match = headerRegex.exec(sqlText)) !== null) {
    const mobId = Number.parseInt(match[2], 10);
    if (!Number.isInteger(mobId) || mobId <= 0) {
      continue;
    }
    const rawName = humanizeToken(match[1]).replace(/\s+Drops$/i, "");
    setName(mobNames, mobId, rawName);
  }
}

function loadCatalog() {
  const itemNames = new Map();
  const mobNames = new Map();

  for (const filePath of SQL_SOURCES) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const sqlText = fs.readFileSync(filePath, "utf8");
    parseDropTupleComments(sqlText, itemNames);
    parseDropSummaryComments(sqlText, itemNames, mobNames);
    parseMobCollectionComments(sqlText, mobNames);
    parseMobHeaderComments(sqlText, mobNames);
  }

  return {
    itemNames,
    mobNames,
    stats: {
      itemsIndexed: itemNames.size,
      mobsIndexed: mobNames.size,
      sourceFiles: SQL_SOURCES.filter((sqlFile) => fs.existsSync(sqlFile)).length,
    },
  };
}

function searchByName(sourceMap, text, limit = 80) {
  const query = normalizeWhitespace(text).toLowerCase();
  if (!query || query.length < 2) {
    return [];
  }

  const rows = [];
  for (const [id, name] of sourceMap.entries()) {
    if (!name) {
      continue;
    }
    const lowered = name.toLowerCase();
    const idx = lowered.indexOf(query);
    if (idx === -1) {
      continue;
    }
    rows.push({ id, name, rank: idx });
  }

  rows.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    if (a.name.length !== b.name.length) {
      return a.name.length - b.name.length;
    }
    return a.id - b.id;
  });

  return rows.slice(0, limit).map((row) => ({ id: row.id, name: row.name }));
}

module.exports = {
  EQUIPMENT_GROUP_LABELS,
  EQUIPMENT_SLOT_META,
  EQUIPMENT_SLOT_LABELS,
  getEquipmentSlotMeta,
  getItemCategory,
  loadCatalog,
  searchByName,
};
