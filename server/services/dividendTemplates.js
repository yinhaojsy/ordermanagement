import { db } from "../db.js";

export function listDividendTemplates() {
  return db
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM dividend_template_businesses b WHERE b.templateId = t.id) AS businessCount,
              (SELECT COUNT(*) FROM dividend_template_persons p WHERE p.templateId = t.id) AS personCount
       FROM dividend_templates t
       ORDER BY t.name ASC, t.id ASC`,
    )
    .all()
    .map((r) => ({
      ...r,
      businessCount: Number(r.businessCount) || 0,
      personCount: Number(r.personCount) || 0,
    }));
}

export function getDividendTemplateById(id) {
  const template = db.prepare("SELECT * FROM dividend_templates WHERE id = ?").get(id);
  if (!template) return null;

  const businesses = db
    .prepare(
      `SELECT * FROM dividend_template_businesses
       WHERE templateId = ?
       ORDER BY sortOrder ASC, id ASC`,
    )
    .all(id);

  const persons = db
    .prepare(
      `SELECT * FROM dividend_template_persons
       WHERE templateId = ?
       ORDER BY sortOrder ASC, id ASC`,
    )
    .all(id);

  const businessIds = businesses.map((b) => b.id);
  const sharesByBusiness = new Map();
  if (businessIds.length > 0) {
    const placeholders = businessIds.map(() => "?").join(", ");
    const shares = db
      .prepare(
        `SELECT s.*, p.name AS personName
         FROM dividend_template_shares s
         INNER JOIN dividend_template_persons p ON p.id = s.templatePersonId
         WHERE s.templateBusinessId IN (${placeholders})
         ORDER BY s.id ASC`,
      )
      .all(...businessIds);
    for (const s of shares) {
      if (!sharesByBusiness.has(s.templateBusinessId)) {
        sharesByBusiness.set(s.templateBusinessId, []);
      }
      sharesByBusiness.get(s.templateBusinessId).push({
        id: s.id,
        templatePersonId: s.templatePersonId,
        personName: s.personName,
        sharePercent: Number(s.sharePercent),
      });
    }
  }

  return {
    ...template,
    businesses: businesses.map((b) => ({
      ...b,
      keepPercent: Number(b.keepPercent),
      shares: sharesByBusiness.get(b.id) || [],
    })),
    persons,
  };
}

function replaceTemplateConfig(templateId, payload) {
  const { businesses = [], persons = [] } = payload;

  db.prepare("DELETE FROM dividend_template_businesses WHERE templateId = ?").run(templateId);
  db.prepare("DELETE FROM dividend_template_persons WHERE templateId = ?").run(templateId);

  const insertBusiness = db.prepare(
    `INSERT INTO dividend_template_businesses
       (templateId, name, sortOrder, keepPercent, remainderBusinessId)
     VALUES (@templateId, @name, @sortOrder, @keepPercent, NULL)`,
  );
  const insertPerson = db.prepare(
    `INSERT INTO dividend_template_persons (templateId, name, sortOrder)
     VALUES (?, ?, ?)`,
  );
  const insertShare = db.prepare(
    `INSERT INTO dividend_template_shares (templateBusinessId, templatePersonId, sharePercent)
     VALUES (?, ?, ?)`,
  );
  const updateRemainder = db.prepare(
    `UPDATE dividend_template_businesses SET remainderBusinessId = ? WHERE id = ?`,
  );

  const businessIdByTempKey = new Map();
  const personIdByTempKey = new Map();

  businesses.forEach((biz, index) => {
    const tempKey = biz.tempKey ?? `b${index}`;
    const result = insertBusiness.run({
      templateId,
      name: String(biz.name || "").trim(),
      sortOrder: Number.isFinite(Number(biz.sortOrder)) ? Number(biz.sortOrder) : index,
      keepPercent: Number.isFinite(Number(biz.keepPercent)) ? Number(biz.keepPercent) : 100,
    });
    businessIdByTempKey.set(tempKey, result.lastInsertRowid);
    if (biz.id != null) businessIdByTempKey.set(`id:${biz.id}`, result.lastInsertRowid);
  });

  businesses.forEach((biz, index) => {
    const tempKey = biz.tempKey ?? `b${index}`;
    const businessId = businessIdByTempKey.get(tempKey);
    if (!businessId) return;
    let remainderId = null;
    if (biz.remainderBusinessTempKey) {
      remainderId = businessIdByTempKey.get(biz.remainderBusinessTempKey) ?? null;
    } else if (biz.remainderBusinessId != null) {
      remainderId = businessIdByTempKey.get(`id:${biz.remainderBusinessId}`) ?? null;
    }
    if (remainderId && remainderId !== businessId) {
      updateRemainder.run(remainderId, businessId);
    }
  });

  persons.forEach((person, index) => {
    const tempKey = person.tempKey ?? `p${index}`;
    const name = String(person.name || "").trim();
    if (!name) return;
    const result = insertPerson.run(
      templateId,
      name,
      Number.isFinite(Number(person.sortOrder)) ? Number(person.sortOrder) : index,
    );
    personIdByTempKey.set(tempKey, result.lastInsertRowid);
    if (person.id != null) personIdByTempKey.set(`id:${person.id}`, result.lastInsertRowid);
  });

  businesses.forEach((biz, index) => {
    const tempKey = biz.tempKey ?? `b${index}`;
    const businessId = businessIdByTempKey.get(tempKey);
    if (!businessId) return;
    for (const share of biz.shares || []) {
      const personId =
        (share.personTempKey && personIdByTempKey.get(share.personTempKey)) ||
        (share.templatePersonId != null &&
          personIdByTempKey.get(`id:${share.templatePersonId}`)) ||
        null;
      if (!personId) continue;
      insertShare.run(
        businessId,
        personId,
        Number.isFinite(Number(share.sharePercent)) ? Number(share.sharePercent) : 0,
      );
    }
  });
}

export function createDividendTemplate(payload) {
  const name = String(payload.name || "").trim();
  if (!name) {
    throw Object.assign(new Error("Template name is required"), { status: 400 });
  }
  const businesses = payload.businesses || [];
  if (!Array.isArray(businesses) || businesses.length === 0) {
    throw Object.assign(new Error("At least one business is required"), { status: 400 });
  }
  for (const biz of businesses) {
    if (!String(biz.name || "").trim()) {
      throw Object.assign(new Error("Each business needs a name"), { status: 400 });
    }
  }

  const now = new Date().toISOString();
  let id;
  try {
    const result = db
      .prepare(
        `INSERT INTO dividend_templates (name, notes, createdAt, updatedAt)
         VALUES (@name, @notes, @createdAt, @updatedAt)`,
      )
      .run({
        name,
        notes: payload.notes || null,
        createdAt: now,
        updatedAt: now,
      });
    id = result.lastInsertRowid;
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) {
      throw Object.assign(new Error("A template with this name already exists"), { status: 400 });
    }
    throw e;
  }

  replaceTemplateConfig(id, {
    businesses,
    persons: payload.persons || [],
  });
  return getDividendTemplateById(id);
}

export function updateDividendTemplate(id, payload) {
  const existing = db.prepare("SELECT * FROM dividend_templates WHERE id = ?").get(id);
  if (!existing) return null;

  const name =
    payload.name != null ? String(payload.name).trim() : existing.name;
  if (!name) {
    throw Object.assign(new Error("Template name is required"), { status: 400 });
  }

  if (Array.isArray(payload.businesses)) {
    if (payload.businesses.length === 0) {
      throw Object.assign(new Error("At least one business is required"), { status: 400 });
    }
    for (const biz of payload.businesses) {
      if (!String(biz.name || "").trim()) {
        throw Object.assign(new Error("Each business needs a name"), { status: 400 });
      }
    }
  }

  try {
    db.prepare(
      `UPDATE dividend_templates
       SET name = @name, notes = @notes, updatedAt = @updatedAt
       WHERE id = @id`,
    ).run({
      id,
      name,
      notes: payload.notes !== undefined ? payload.notes || null : existing.notes,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    if (String(e.message || "").includes("UNIQUE")) {
      throw Object.assign(new Error("A template with this name already exists"), { status: 400 });
    }
    throw e;
  }

  if (Array.isArray(payload.businesses) || Array.isArray(payload.persons)) {
    replaceTemplateConfig(id, {
      businesses: payload.businesses || [],
      persons: payload.persons || [],
    });
  }

  return getDividendTemplateById(id);
}

export function deleteDividendTemplate(id) {
  const existing = db.prepare("SELECT id FROM dividend_templates WHERE id = ?").get(id);
  if (!existing) return false;
  db.prepare("DELETE FROM dividend_templates WHERE id = ?").run(id);
  return true;
}
