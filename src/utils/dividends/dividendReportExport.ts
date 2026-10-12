import ExcelJS from "exceljs";
import type { DividendCalculationDetail } from "../../types";
import { ORDER_RECEIPT_PAYMENT_TOLERANCE } from "../orders/orderAmountTolerance";

const COLORS = {
  title: "FF0F172A",
  headerBg: "FF1E293B",
  headerFg: "FFFFFFFF",
  sectionBg: "FFE2E8F0",
  sectionFg: "FF0F172A",
  totalBg: "FFF1F5F9",
  zebra: "FFF8FAFC",
  border: "FFCBD5E1",
  muted: "FF64748B",
  paidBg: "FFD1FAE5",
  paidFg: "FF065F46",
  outstandingBg: "FFFEF3C7",
  outstandingFg: "FF92400E",
  white: "FFFFFFFF",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type DividendExportFx = {
  /** Currency shown in the report (matches "View amounts in"). */
  displayCurrency: string;
  /** Profit-calculation target currency (canonical stored amounts). */
  targetCurrency: string;
  /** Convert an amount in target currency into display currency. */
  fromTarget: (amountInTarget: number, toCode: string) => number | null;
};

function moneyNum(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function convertForExport(
  amountInTarget: number | null | undefined,
  fx: DividendExportFx,
): number {
  const n = moneyNum(amountInTarget);
  if (!fx.displayCurrency || !fx.targetCurrency || fx.displayCurrency === fx.targetCurrency) {
    return n;
  }
  const converted = fx.fromTarget(n, fx.displayCurrency);
  if (converted == null) {
    throw new Error(
      `No FX rate to convert ${fx.targetCurrency} → ${fx.displayCurrency}`,
    );
  }
  return moneyNum(converted);
}

function statusLabel(detail: DividendCalculationDetail, t: Translate): string {
  return t(`dividends.status_${detail.status}`);
}

function safeFilePart(s: string): string {
  return s.replace(/[\\/?*%[\]:<>|"]/g, "_").trim() || "dividend";
}

function applyMoneyFormat(cell: ExcelJS.Cell) {
  cell.numFmt = '#,##0.00';
  cell.alignment = { horizontal: "right", vertical: "middle" };
}

function styleHeaderRow(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.headerBg },
    };
    cell.font = { bold: true, color: { argb: COLORS.headerFg }, size: 11 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.border } },
      left: { style: "thin", color: { argb: COLORS.border } },
      bottom: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    };
  }
  row.height = 22;
}

function styleDataCell(cell: ExcelJS.Cell, zebra: boolean) {
  cell.border = {
    top: { style: "thin", color: { argb: COLORS.border } },
    left: { style: "thin", color: { argb: COLORS.border } },
    bottom: { style: "thin", color: { argb: COLORS.border } },
    right: { style: "thin", color: { argb: COLORS.border } },
  };
  cell.alignment = { ...(cell.alignment || {}), vertical: "middle" };
  if (zebra) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.zebra },
    };
  }
}

function styleSectionBanner(ws: ExcelJS.Worksheet, rowNum: number, colCount: number, title: string) {
  ws.mergeCells(rowNum, 1, rowNum, colCount);
  const cell = ws.getCell(rowNum, 1);
  cell.value = title;
  cell.font = { bold: true, size: 12, color: { argb: COLORS.sectionFg } };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.sectionBg },
  };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(rowNum).height = 24;
}

function businessRemainderLabel(
  detail: DividendCalculationDetail,
  businessId: number | null | undefined,
  t: Translate,
): string {
  if (!businessId) return t("dividends.remainderStay");
  return detail.businesses.find((b) => b.id === businessId)?.name || t("dividends.remainderStay");
}

/**
 * Build and download a presentable multi-sheet dividend Excel report.
 * Amounts use `fx.displayCurrency` (same as the page "View amounts in" selector).
 */
export async function exportDividendReport(
  detail: DividendCalculationDetail,
  t: Translate,
  fx: DividendExportFx,
): Promise<string> {
  const targetCurrency = fx.targetCurrency || detail.targetCurrencyCode || "—";
  const displayCurrency = fx.displayCurrency || targetCurrency;
  const reportFx: DividendExportFx = {
    displayCurrency,
    targetCurrency,
    fromTarget: fx.fromTarget,
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Order Management";
  workbook.created = new Date();
  workbook.modified = new Date();

  buildReportSheet(workbook, detail, t, reportFx);
  buildDataSheets(workbook, detail, t, reportFx);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const period =
    detail.periodStartDate && detail.periodEndDate
      ? `${detail.periodStartDate}_${detail.periodEndDate}`
      : new Date().toISOString().slice(0, 10);
  const ccyPart =
    displayCurrency && displayCurrency !== "—" ? `_${safeFilePart(displayCurrency)}` : "";
  const fileName = `Dividend_${safeFilePart(detail.name)}_${period}${ccyPart}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);

  return fileName;
}

function buildReportSheet(
  workbook: ExcelJS.Workbook,
  detail: DividendCalculationDetail,
  t: Translate,
  fx: DividendExportFx,
) {
  const currency = fx.displayCurrency;
  const ws = workbook.addWorksheet(t("dividends.exportSheetReport"), {
    views: [{ state: "frozen", ySplit: 3 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
    },
  });

  const COLS = 7;
  ws.columns = [
    { width: 22 },
    { width: 12 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
  ];

  // —— Title ——
  ws.mergeCells(1, 1, 1, COLS);
  const title = ws.getCell(1, 1);
  title.value = t("dividends.exportReportTitle");
  title.font = { bold: true, size: 18, color: { argb: COLORS.title } };
  title.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, COLS);
  const subtitle = ws.getCell(2, 1);
  const periodText =
    detail.periodStartDate && detail.periodEndDate
      ? `${detail.periodStartDate} → ${detail.periodEndDate}`
      : "—";
  subtitle.value = `${detail.name}  ·  ${periodText}  ·  ${statusLabel(detail, t)}  ·  ${currency}`;
  subtitle.font = { size: 11, color: { argb: COLORS.muted } };
  ws.getRow(2).height = 18;

  let row = 4;

  // —— Meta ——
  styleSectionBanner(ws, row, COLS, t("dividends.exportSectionSummary"));
  row += 1;

  const metaRows: [string, string][] = [
    [t("dividends.name"), detail.name],
    [t("dividends.period"), periodText],
    [
      t("dividends.sourceMode"),
      detail.sourceMode === "manual" ? t("dividends.modeManual") : t("dividends.modeAuto"),
    ],
    [t("dividends.displayCurrency"), currency],
  ];
  if (fx.targetCurrency && fx.targetCurrency !== currency) {
    metaRows.push([t("dividends.exportTargetCurrency"), fx.targetCurrency]);
    metaRows.push([
      t("dividends.exportFxNote"),
      t("dividends.exportFxNoteValue", {
        display: currency,
        target: fx.targetCurrency,
      }),
    ]);
  }
  metaRows.push([t("dividends.status"), statusLabel(detail, t)]);
  if (detail.sourceMode === "manual" && detail.manualInputCurrencyCode) {
    metaRows.push([t("dividends.manualInputCurrency"), detail.manualInputCurrencyCode]);
  }
  if (detail.notes) {
    metaRows.push([t("dividends.notes"), detail.notes]);
  }
  metaRows.push([
    t("dividends.exportGeneratedAt"),
    new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
  ]);

  for (const [label, value] of metaRows) {
    ws.getCell(row, 1).value = label;
    ws.getCell(row, 1).font = { bold: true, size: 10, color: { argb: COLORS.muted } };
    ws.mergeCells(row, 2, row, COLS);
    ws.getCell(row, 2).value = value;
    ws.getCell(row, 2).font = { size: 11 };
    row += 1;
  }

  row += 1;

  // —— Business results ——
  styleSectionBanner(ws, row, COLS, t("dividends.businessResults"));
  row += 1;

  const bizHeader = ws.getRow(row);
  bizHeader.values = [
    t("dividends.business"),
    t("dividends.keepPercent"),
    `${t("dividends.orderProfit")} (${currency})`,
    `${t("dividends.expenses")} (${currency})`,
    `${t("dividends.income")} (${currency})`,
    `${t("dividends.netProfit")} (${currency})`,
    `${t("dividends.poolAmount")} (${currency})`,
  ];
  styleHeaderRow(bizHeader, COLS);
  row += 1;

  let sumOrder = 0;
  let sumExp = 0;
  let sumInc = 0;
  let sumNet = 0;
  let sumPool = 0;

  detail.businesses.forEach((b, i) => {
    const r = ws.getRow(row);
    const order = convertForExport(b.orderProfit, fx);
    const exp = convertForExport(b.expenseTotal, fx);
    const inc = convertForExport(b.incomeTotal, fx);
    const net = convertForExport(b.netProfit, fx);
    const pool = convertForExport(b.poolAmount, fx);
    sumOrder += order;
    sumExp += exp;
    sumInc += inc;
    sumNet += net;
    sumPool += pool;

    r.getCell(1).value = b.name;
    r.getCell(2).value = Number(b.keepPercent) / 100;
    r.getCell(2).numFmt = "0.00%";
    r.getCell(3).value = order;
    r.getCell(4).value = exp;
    r.getCell(5).value = inc;
    r.getCell(6).value = net;
    r.getCell(7).value = pool;
    applyMoneyFormat(r.getCell(3));
    applyMoneyFormat(r.getCell(4));
    applyMoneyFormat(r.getCell(5));
    applyMoneyFormat(r.getCell(6));
    applyMoneyFormat(r.getCell(7));
    for (let c = 1; c <= COLS; c++) styleDataCell(r.getCell(c), i % 2 === 1);
    r.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    r.getCell(2).alignment = { horizontal: "center", vertical: "middle" };
    row += 1;
  });

  const totalRow = ws.getRow(row);
  totalRow.getCell(1).value = t("dividends.total");
  totalRow.getCell(2).value = "";
  totalRow.getCell(3).value = sumOrder;
  totalRow.getCell(4).value = sumExp;
  totalRow.getCell(5).value = sumInc;
  totalRow.getCell(6).value = sumNet;
  totalRow.getCell(7).value = sumPool;
  for (let c = 1; c <= COLS; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLORS.totalBg },
    };
    cell.border = {
      top: { style: "medium", color: { argb: COLORS.headerBg } },
      left: { style: "thin", color: { argb: COLORS.border } },
      bottom: { style: "thin", color: { argb: COLORS.border } },
      right: { style: "thin", color: { argb: COLORS.border } },
    };
  }
  applyMoneyFormat(totalRow.getCell(3));
  applyMoneyFormat(totalRow.getCell(4));
  applyMoneyFormat(totalRow.getCell(5));
  applyMoneyFormat(totalRow.getCell(6));
  applyMoneyFormat(totalRow.getCell(7));
  totalRow.getCell(3).font = { bold: true };
  totalRow.getCell(4).font = { bold: true };
  totalRow.getCell(5).font = { bold: true };
  totalRow.getCell(6).font = { bold: true };
  totalRow.getCell(7).font = { bold: true };
  row += 2;

  // —— Allocation rules ——
  styleSectionBanner(ws, row, COLS, t("dividends.exportSectionRules"));
  row += 1;
  for (const b of detail.businesses) {
    const rem = businessRemainderLabel(detail, b.remainderBusinessId, t);
    ws.mergeCells(row, 1, row, COLS);
    ws.getCell(row, 1).value = t("dividends.exportRuleLine", {
      business: b.name,
      keep: b.keepPercent,
      remainder: rem,
    });
    ws.getCell(row, 1).font = { size: 10, color: { argb: COLORS.muted } };
    row += 1;
  }
  row += 1;

  // —— Stakeholder shares ——
  styleSectionBanner(ws, row, COLS, t("dividends.stakeholderShares"));
  row += 1;

  for (const b of detail.businesses) {
    ws.mergeCells(row, 1, row, COLS);
    ws.getCell(row, 1).value = `${b.name} — ${t("dividends.stakeholderShares")}`;
    ws.getCell(row, 1).font = { bold: true, size: 11 };
    row += 1;

    const shHeader = ws.getRow(row);
    shHeader.values = [
      t("dividends.person"),
      "%",
      `${t("dividends.amount")} (${currency})`,
      "",
      "",
      "",
      "",
    ];
    styleHeaderRow(shHeader, 3);
    row += 1;

    if (b.shares.length === 0) {
      ws.getCell(row, 1).value = t("dividends.noShares");
      ws.getCell(row, 1).font = { italic: true, color: { argb: COLORS.muted } };
      row += 1;
    } else {
      let shareSum = 0;
      let amountSum = 0;
      b.shares.forEach((s, i) => {
        const r = ws.getRow(row);
        const amt = convertForExport(s.amount, fx);
        shareSum += Number(s.sharePercent) || 0;
        amountSum += amt;
        r.getCell(1).value = s.personName || "—";
        r.getCell(2).value = (Number(s.sharePercent) || 0) / 100;
        r.getCell(2).numFmt = "0.000%";
        r.getCell(3).value = amt;
        applyMoneyFormat(r.getCell(3));
        for (let c = 1; c <= 3; c++) styleDataCell(r.getCell(c), i % 2 === 1);
        row += 1;
      });
      const sub = ws.getRow(row);
      sub.getCell(1).value = t("dividends.total");
      sub.getCell(2).value = shareSum / 100;
      sub.getCell(2).numFmt = "0.000%";
      sub.getCell(3).value = amountSum;
      applyMoneyFormat(sub.getCell(3));
      for (let c = 1; c <= 3; c++) {
        sub.getCell(c).font = { bold: true };
        sub.getCell(c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.totalBg },
        };
        styleDataCell(sub.getCell(c), false);
      }
      row += 1;
    }
    row += 1;
  }

  // —— Person summary ——
  styleSectionBanner(ws, row, COLS, t("dividends.personSummary"));
  row += 1;

  const ptHeader = ws.getRow(row);
  ptHeader.values = [
    t("dividends.person"),
    `${t("dividends.total")} (${currency})`,
    `${t("dividends.paid")} (${currency})`,
    `${t("dividends.remaining")} (${currency})`,
    t("dividends.status"),
    "",
    "",
  ];
  styleHeaderRow(ptHeader, 5);
  row += 1;

  if (detail.personTotals.length === 0) {
    ws.getCell(row, 1).value = t("dividends.runCalculateFirst");
    ws.getCell(row, 1).font = { italic: true, color: { argb: COLORS.muted } };
    row += 1;
  } else {
    detail.personTotals.forEach((pt, i) => {
      const r = ws.getRow(row);
      const remainingTarget = moneyNum(pt.remainingAmount);
      const fullyPaid = Math.abs(remainingTarget) <= ORDER_RECEIPT_PAYMENT_TOLERANCE;
      const amount = convertForExport(pt.amount, fx);
      const paid = convertForExport(pt.paidAmount, fx);
      const remaining = convertForExport(pt.remainingAmount, fx);
      r.getCell(1).value = pt.personName;
      r.getCell(2).value = amount;
      r.getCell(3).value = paid;
      r.getCell(4).value = remaining;
      r.getCell(5).value = fullyPaid
        ? t("dividends.fullyPaid")
        : moneyNum(pt.paidAmount) > 0
          ? t("dividends.status_partially_paid")
          : t("dividends.exportOutstanding");
      applyMoneyFormat(r.getCell(2));
      applyMoneyFormat(r.getCell(3));
      applyMoneyFormat(r.getCell(4));
      for (let c = 1; c <= 5; c++) styleDataCell(r.getCell(c), i % 2 === 1);
      if (fullyPaid && moneyNum(pt.amount) > 0) {
        r.getCell(5).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.paidBg },
        };
        r.getCell(5).font = { bold: true, color: { argb: COLORS.paidFg } };
      } else if (!fullyPaid) {
        r.getCell(4).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.outstandingBg },
        };
        r.getCell(5).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLORS.outstandingBg },
        };
        r.getCell(5).font = { bold: true, color: { argb: COLORS.outstandingFg } };
      }
      row += 1;
    });
  }
  row += 1;

  // —— Payments ——
  if (detail.payments.length > 0) {
    styleSectionBanner(ws, row, COLS, t("dividends.paymentHistory"));
    row += 1;

    const payHeader = ws.getRow(row);
    payHeader.values = [
      t("dividends.exportPaymentDate"),
      t("dividends.person"),
      t("dividends.amount"),
      t("dividends.currency"),
      t("dividends.account"),
      "",
      "",
    ];
    styleHeaderRow(payHeader, 5);
    row += 1;

    detail.payments.forEach((p, i) => {
      const r = ws.getRow(row);
      r.getCell(1).value = p.createdAt ? new Date(p.createdAt) : "";
      r.getCell(1).numFmt = "yyyy-mm-dd hh:mm";
      r.getCell(2).value = p.personName;
      r.getCell(3).value = moneyNum(p.amount);
      applyMoneyFormat(r.getCell(3));
      r.getCell(4).value = p.currencyCode;
      r.getCell(5).value = p.accountName || `#${p.accountId}`;
      for (let c = 1; c <= 5; c++) styleDataCell(r.getCell(c), i % 2 === 1);
      row += 1;
    });
    row += 1;
  }

  // —— Footer ——
  ws.mergeCells(row, 1, row, COLS);
  const footer = ws.getCell(row, 1);
  footer.value =
    fx.targetCurrency && fx.targetCurrency !== currency
      ? t("dividends.exportFooterConverted", {
          display: currency,
          target: fx.targetCurrency,
        })
      : t("dividends.exportFooter", { currency });
  footer.font = { italic: true, size: 9, color: { argb: COLORS.muted } };
}

function buildDataSheets(
  workbook: ExcelJS.Workbook,
  detail: DividendCalculationDetail,
  t: Translate,
  fx: DividendExportFx,
) {
  const currency = fx.displayCurrency;

  // Business results flat
  {
    const ws = workbook.addWorksheet(t("dividends.exportSheetBusiness"));
    ws.columns = [
      { header: t("dividends.business"), key: "name", width: 20 },
      { header: t("dividends.keepPercent"), key: "keep", width: 12 },
      { header: `${t("dividends.orderProfit")} (${currency})`, key: "order", width: 16 },
      { header: `${t("dividends.expenses")} (${currency})`, key: "exp", width: 14 },
      { header: `${t("dividends.income")} (${currency})`, key: "inc", width: 14 },
      { header: `${t("dividends.netProfit")} (${currency})`, key: "net", width: 14 },
      { header: `${t("dividends.poolAmount")} (${currency})`, key: "pool", width: 16 },
      { header: t("dividends.remainderTo"), key: "rem", width: 18 },
    ];
    styleHeaderRow(ws.getRow(1), 8);
    detail.businesses.forEach((b) => {
      ws.addRow({
        name: b.name,
        keep: Number(b.keepPercent),
        order: convertForExport(b.orderProfit, fx),
        exp: convertForExport(b.expenseTotal, fx),
        inc: convertForExport(b.incomeTotal, fx),
        net: convertForExport(b.netProfit, fx),
        pool: convertForExport(b.poolAmount, fx),
        rem: businessRemainderLabel(detail, b.remainderBusinessId, t),
      });
    });
    for (let r = 2; r <= ws.rowCount; r++) {
      for (const col of [3, 4, 5, 6, 7]) applyMoneyFormat(ws.getRow(r).getCell(col));
    }
  }

  // Shares flat
  {
    const ws = workbook.addWorksheet(t("dividends.exportSheetShares"));
    ws.columns = [
      { header: t("dividends.business"), key: "biz", width: 20 },
      { header: t("dividends.person"), key: "person", width: 18 },
      { header: "%", key: "pct", width: 10 },
      { header: `${t("dividends.amount")} (${currency})`, key: "amt", width: 16 },
    ];
    styleHeaderRow(ws.getRow(1), 4);
    for (const b of detail.businesses) {
      for (const s of b.shares) {
        ws.addRow({
          biz: b.name,
          person: s.personName || "",
          pct: Number(s.sharePercent),
          amt: convertForExport(s.amount, fx),
        });
      }
    }
    for (let r = 2; r <= ws.rowCount; r++) applyMoneyFormat(ws.getRow(r).getCell(4));
  }

  // Person totals
  {
    const ws = workbook.addWorksheet(t("dividends.exportSheetPersons"));
    ws.columns = [
      { header: t("dividends.person"), key: "person", width: 18 },
      { header: `${t("dividends.total")} (${currency})`, key: "total", width: 14 },
      { header: `${t("dividends.paid")} (${currency})`, key: "paid", width: 14 },
      { header: `${t("dividends.remaining")} (${currency})`, key: "rem", width: 14 },
    ];
    styleHeaderRow(ws.getRow(1), 4);
    for (const pt of detail.personTotals) {
      ws.addRow({
        person: pt.personName,
        total: convertForExport(pt.amount, fx),
        paid: convertForExport(pt.paidAmount, fx),
        rem: convertForExport(pt.remainingAmount, fx),
      });
    }
    for (let r = 2; r <= ws.rowCount; r++) {
      for (const col of [2, 3, 4]) applyMoneyFormat(ws.getRow(r).getCell(col));
    }
  }

  // Payments (kept in the currency actually paid — not display-converted)
  if (detail.payments.length > 0) {
    const ws = workbook.addWorksheet(t("dividends.exportSheetPayments"));
    ws.columns = [
      { header: t("dividends.exportPaymentDate"), key: "date", width: 20 },
      { header: t("dividends.person"), key: "person", width: 18 },
      { header: t("dividends.amount"), key: "amt", width: 14 },
      { header: t("dividends.currency"), key: "ccy", width: 10 },
      { header: t("dividends.account"), key: "acct", width: 22 },
    ];
    styleHeaderRow(ws.getRow(1), 5);
    for (const p of detail.payments) {
      const r = ws.addRow({
        date: p.createdAt ? new Date(p.createdAt) : null,
        person: p.personName,
        amt: moneyNum(p.amount),
        ccy: p.currencyCode,
        acct: p.accountName || `#${p.accountId}`,
      });
      r.getCell(1).numFmt = "yyyy-mm-dd hh:mm";
      applyMoneyFormat(r.getCell(3));
    }
  }
}
