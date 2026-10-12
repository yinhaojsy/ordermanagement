import {
  listDividendTemplates,
  getDividendTemplateById,
  createDividendTemplate,
  updateDividendTemplate,
  deleteDividendTemplate,
} from "../services/dividendTemplates.js";

export const listTemplates = (_req, res, next) => {
  try {
    res.json(listDividendTemplates());
  } catch (e) {
    next(e);
  }
};

export const getTemplate = (req, res, next) => {
  try {
    const detail = getDividendTemplateById(Number(req.params.id));
    if (!detail) return res.status(404).json({ message: "Not found" });
    res.json(detail);
  } catch (e) {
    next(e);
  }
};

export const createTemplate = (req, res, next) => {
  try {
    const created = createDividendTemplate(req.body || {});
    res.status(201).json(created);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};

export const updateTemplate = (req, res, next) => {
  try {
    const updated = updateDividendTemplate(Number(req.params.id), req.body || {});
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(updated);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};

export const removeTemplate = (req, res, next) => {
  try {
    const ok = deleteDividendTemplate(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
};
