import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { SheetError, findAnchor, inWindow, parseLabel, parseMenu, syncWindow, type SheetRow } from "../lib/sheet-sync/parse";
import { readSheetRows } from "../lib/sheet-sync/xlsx";

// A small made-up sheet in the family's layout. The real file is not in the repo.
const HEADER: SheetRow = [null, null, "MONDAY ", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const week = (label: SheetRow[0], lunch: string[], dinner: string[]): SheetRow[] => [
  [label, "LUNCH", ...lunch],
  [null, "DINNER", ...dinner],
];
const seven = (s: string) => Array.from({ length: 7 }, (_, i) => `${s} ${i + 1}`);

const TODAY = "2026-11-26"; // a Thursday; its week starts Monday 23 Nov

function sheet(labels: SheetRow[0][]): SheetRow[] {
  return [
    ["WEEKLY MENU"],
    HEADER,
    ...labels.flatMap((l, i) => week(l, seven(`L${i}`), seven(`D${i}`))),
    // Ideas and desserts after the last week: column B is empty.
    [null, null, null, "Recetas con granada", "Dúrum kebab casero"],
    [null, null, "Pastel de chocolate", "Lemon curd"],
  ];
}

describe("sheet dates", () => {
  it("reads dd/mm/yyyy text, real dates and Excel date numbers", () => {
    expect(parseLabel("10/8/2026")).toBe("2026-08-10");
    expect(parseLabel("17/08/2024")).toBe("2024-08-17");
    expect(parseLabel("02/01/2026")).toBe("2026-01-02");
    expect(parseLabel(new Date(Date.UTC(2026, 10, 23)))).toBe("2026-11-23");
    expect(parseLabel(46349)).toBe("2026-11-23");
  });

  it("rejects labels that are not dates", () => {
    expect(parseLabel("0/01/2026")).toBeNull();
    expect(parseLabel("31/02/2026")).toBeNull();
    expect(parseLabel("next week")).toBeNull();
    expect(parseLabel(null)).toBeNull();
    expect(parseLabel("")).toBeNull();
  });

  it("anchors on the last week when its label is a Monday", () => {
    // The real sheet's labels, oldest first.
    const labels = ["10/8/2026", "17/08/2024", "24/08/2024", "02/01/2026", "0/01/2026", "16/11/2026", "23/11/2026"];
    expect(findAnchor(labels)).toEqual({ position: 6, weekStart: "2026-11-23" });
  });

  it("walks back past wrong labels to the newest Monday that fits the order", () => {
    // 02/01/2026 is a Friday and 0/01/2026 is not a date: the anchor is 26/10.
    expect(findAnchor(["19/10/2026", "26/10/2026", "02/01/2026", "0/01/2026"])).toEqual({ position: 1, weekStart: "2026-10-26" });
    // 05/01/2026 is a Monday but comes after 26/10/2026 in the sheet, so it can't be right.
    expect(findAnchor(["19/10/2026", "26/10/2026", "05/01/2026", "garbage"])).toEqual({ position: 1, weekStart: "2026-10-26" });
  });

  it("finds no anchor when no label is a Monday", () => {
    expect(findAnchor(["17/08/2024", "0/01/2026", null])).toBeNull();
  });
});

describe("sheet blocks", () => {
  it("dates every week from the anchor and ignores the ideas rows", () => {
    const parsed = parseMenu(sheet(["10/8/2026", "17/08/2024", "02/01/2026", "0/01/2026", new Date(Date.UTC(2026, 10, 16)), "23/11/2026"]), TODAY);
    expect(parsed.weeks.map((w) => w.weekStart)).toEqual(["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
    expect(parsed.anchor).toMatchObject({ position: 5, weekStart: "2026-11-23" });
    const last = parsed.weeks[5];
    expect(last.cells).toHaveLength(14);
    expect(last.cells[0]).toEqual({ day: "mon", slot: "lunch", text: "L5 1" });
    expect(last.cells[13]).toEqual({ day: "sun", slot: "dinner", text: "D5 7" });
    expect(parsed.weeks.flatMap((w) => w.cells).some((c) => /granada|Lemon/.test(c.text))).toBe(false);
  });

  it("keeps empty cells as empty text", () => {
    const rows: SheetRow[] = [HEADER, ["23/11/2026", "LUNCH", "Pasta", null, "  "], [null, "DINNER"]];
    const cells = parseMenu(rows, TODAY).weeks[0].cells;
    expect(cells.map((c) => c.text)).toEqual(["Pasta", ...Array(13).fill("")]);
  });

  it("stops when the dates are too far from today", () => {
    expect(() => parseMenu(sheet(["14/12/2026", "21/12/2026"]), TODAY)).toThrow(SheetError); // 25 days ahead
    expect(() => parseMenu(sheet(["21/09/2026", "28/09/2026"]), TODAY)).toThrow(/too far/); // 59 days back
    expect(parseMenu(sheet(["14/12/2026"]), TODAY).anchor.weekStart).toBe("2026-12-14"); // 18 days ahead is fine
    expect(parseMenu(sheet(["05/10/2026"]), TODAY).anchor.weekStart).toBe("2026-10-05"); // 52 days back is fine
  });

  it("stops when no week can be dated or the layout is wrong", () => {
    expect(() => parseMenu(sheet(["0/01/2026", "02/01/2026"]), TODAY)).toThrow(/can't be dated/);
    expect(() => parseMenu([["23/11/2026", "LUNCH", "Pasta"]], TODAY)).toThrow(/MONDAY/);
    expect(() => parseMenu([HEADER], TODAY)).toThrow(/no LUNCH/);
  });
});

describe("weeks that sync", () => {
  it("runs from three weeks back to four weeks ahead of this week", () => {
    const w = syncWindow(TODAY);
    expect(w).toEqual({ from: "2026-11-02", to: "2026-12-21" });
    expect(inWindow("2026-10-26", w)).toBe(false);
    expect(inWindow("2026-11-02", w)).toBe(true);
    expect(inWindow("2026-12-21", w)).toBe(true);
    expect(inWindow("2026-12-28", w)).toBe(false);
  });

  it("uses Ireland's date: Sunday night is still the same week", () => {
    expect(syncWindow("2026-11-29").from).toBe("2026-11-02");
    expect(syncWindow("2026-11-30").from).toBe("2026-11-09");
  });
});

describe("reading an .xlsx file", () => {
  it("turns rich text, links, formulas and dates into plain values", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["WEEKLY MENU"]);
    ws.addRow(HEADER);
    ws.addRow([{ formula: "DATE(2026,11,16)", result: new Date(Date.UTC(2026, 10, 16)) }, "LUNCH", "Fish Pie"]);
    ws.addRow([null, "DINNER", { richText: [{ text: "Crema de zanahoria" }, { text: "https://elpais.com/x" }] }]);
    ws.addRow(["23/11/2026", "LUNCH", null, "Curry con lentejas"]);
    ws.addRow([null, "DINNER", { text: "Ensalada de gnoquis", hyperlink: "https://elpais.com/y" }]);
    ws.addRow([]);
    ws.addRow([null, null, "Banana bread"]);
    const data = Buffer.from(await wb.xlsx.writeBuffer());

    const rows = await readSheetRows(data);
    const parsed = parseMenu(rows, TODAY);
    expect(parsed.weeks.map((w) => w.weekStart)).toEqual(["2026-11-16", "2026-11-23"]);
    const text = (i: number, day: string, slot: string) => parsed.weeks[i].cells.find((c) => c.day === day && c.slot === slot)?.text;
    expect(text(0, "mon", "lunch")).toBe("Fish Pie");
    expect(text(0, "mon", "dinner")).toBe("Crema de zanahoriahttps://elpais.com/x");
    expect(text(1, "tue", "lunch")).toBe("Curry con lentejas");
    expect(text(1, "mon", "dinner")).toBe("Ensalada de gnoquis");
  });
});
