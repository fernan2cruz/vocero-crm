import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, toCsv } from "@/lib/csv";

describe("064 — csvCell", () => {
  it("texto plano, vacío y null", () => {
    expect(csvCell("Ana")).toBe("Ana");
    expect(csvCell("")).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("escapa comas, comillas y saltos de línea (RFC 4180)", () => {
    expect(csvCell("Pérez, Ana")).toBe('"Pérez, Ana"');
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
  });

  it("neutraliza las fórmulas: = + - @ al inicio", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(
      '"\'=HYPERLINK(""http://x"")"'
    );
    expect(csvCell("+52 55")).toBe("'+52 55");
    expect(csvCell("-1+1")).toBe("'-1+1");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });

  it("un signo en medio no es fórmula", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("Ana-Lu")).toBe("Ana-Lu");
  });

  it("los números van como número, incluso negativos", () => {
    expect(csvCell(-1200)).toBe("-1200");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(Number.NaN)).toBe("");
  });
});

describe("064 — toCsv", () => {
  it("BOM, CRLF y una fila por registro", () => {
    const csv = toCsv(["Nombre", "Notas"], [["Ana", "a, b"], ["Beto", null]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('Nombre,Notas\r\nAna,"a, b"\r\nBeto,\r\n');
  });

  it("sin filas deja solo el encabezado", () => {
    expect(toCsv(["A"], []).slice(1)).toBe("A\r\n");
  });
});
