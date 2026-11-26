import ExcelJS from "exceljs";
import type { SheetRow, SheetValue } from "./parse";

// Turns the first tab of an .xlsx file into plain rows for parseMenu.

type RichText = { richText: { text: string }[] };

// exceljs gives rich text, links and formulas as objects; keep only what the cell shows.
export function plainValue(v: ExcelJS.CellValue): SheetValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  if (typeof v !== "object") return null;
  if ("richText" in v) return (v as RichText).richText.map((r) => r.text ?? "").join("");
  if ("hyperlink" in v) return plainValue((v as ExcelJS.CellHyperlinkValue).text as ExcelJS.CellValue);
  if ("formula" in v || "sharedFormula" in v) return plainValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
  if ("error" in v) return null;
  return null;
}

export async function readSheetRows(data: Buffer): Promise<SheetRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ExcelJS.Buffer); // exceljs types its own Buffer
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: SheetRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const out: SheetValue[] = [];
    for (let c = 1; c <= 9; c++) out.push(plainValue(row.getCell(c).value));
    rows.push(out);
  });
  return rows;
}
