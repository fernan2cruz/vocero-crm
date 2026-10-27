import { describe, expect, it } from "vitest";
import {
  AVISO_MAX_CARACTERES,
  cuerpoAviso,
  debeAvisarSistema,
  esperaReintento,
  urlDeAvisoSegura,
  urlDeConversacion,
} from "@/lib/avisos-sistema";

/** 056 — Cuándo avisa (D2), qué dice (D3) y cuánto espera para reintentar (D6). */
describe("056 — cuándo avisa", () => {
  const base = { direction: "in", campana: true, permiso: "granted", visible: false, foco: false };

  it("un mensaje del cliente con Wassapi oculto avisa", () => {
    expect(debeAvisarSistema(base)).toBe(true);
  });

  it("visible pero sin el foco (otra ventana al frente) también", () => {
    expect(debeAvisarSistema({ ...base, visible: true, foco: false })).toBe(true);
  });

  it("si el operador está mirando, no: ya suena", () => {
    expect(debeAvisarSistema({ ...base, visible: true, foco: true })).toBe(false);
  });

  it("ni con la campana silenciada, ni sin permiso, ni un saliente", () => {
    expect(debeAvisarSistema({ ...base, campana: false })).toBe(false);
    expect(debeAvisarSistema({ ...base, permiso: "default" })).toBe(false);
    expect(debeAvisarSistema({ ...base, permiso: "denied" })).toBe(false);
    expect(debeAvisarSistema({ ...base, direction: "out" })).toBe(false);
  });
});

describe("056 — qué dice", () => {
  it("el texto, en una línea y recortado a 120", () => {
    expect(cuerpoAviso({ text: "Hola,\n  ¿tienen envíos?" })).toBe("Hola, ¿tienen envíos?");
    const largo = cuerpoAviso({ text: "x".repeat(300) });
    expect(largo).toHaveLength(AVISO_MAX_CARACTERES);
    expect(largo.endsWith("…")).toBe(true);
  });

  it("un adjunto dice qué es, o su pie si trae", () => {
    expect(cuerpoAviso({ type: "audio", text: null, media: { kind: "audio" } })).toBe("Audio");
    expect(cuerpoAviso({ type: "image", text: null, media: { kind: "image", caption: "Así lo quiero" } })).toBe(
      "Así lo quiero"
    );
    expect(cuerpoAviso({ type: "location", text: null })).toBe("Ubicación");
  });

  it("lleva a su conversación, y solo a rutas de la Bandeja", () => {
    expect(urlDeConversacion("cv_abc-1")).toBe("/inbox?conversation=cv_abc-1");
    expect(urlDeAvisoSegura("/inbox?conversation=cv_abc-1")).toBe("/inbox?conversation=cv_abc-1");
    expect(urlDeAvisoSegura("/inbox")).toBe("/inbox");
    expect(urlDeAvisoSegura("https://otro.sitio/inbox")).toBeNull();
    expect(urlDeAvisoSegura("//otro.sitio")).toBeNull();
    expect(urlDeAvisoSegura("/settings")).toBeNull();
    expect(urlDeAvisoSegura(42)).toBeNull();
  });
});

describe("056 — reintentos del tiempo real", () => {
  it("1 s, 2 s, 4 s… con tope de 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(esperaReintento)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });
});
