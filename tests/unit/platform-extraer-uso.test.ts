import { describe, expect, it } from "vitest";
import { extraerUso } from "@/server/platform/ai-usage";

const respuesta = { model: "modelo/real", usage: { prompt_tokens: 123, completion_tokens: 45, cost: 0.001 } };
describe("extracción tolerante de consumo", () => {
  it("lee JSON y el objeto ya parseado", () => {
    const uso = { promptTokens: 123, completionTokens: 45, costoUsd: 0.001, modelo: "modelo/real" };
    expect(extraerUso(JSON.stringify(respuesta), "application/json; charset=utf-8")).toEqual(uso);
    expect(extraerUso(respuesta, "application/json")).toEqual(uso);
  });
  it("toma el último usage del SSE, sin sumar los acumulados", () => {
    const sse = `: comentario\r\n\r\ndata: ${JSON.stringify(respuesta)}\r\n\r\ndata: basura\r\n\r\ndata: {"usage":{"prompt_tokens":200,"completion_tokens":50}}\r\n\r\ndata: [DONE]\r\n\r\n`;
    expect(extraerUso(sse, "text/event-stream")).toEqual({ promptTokens: 200, completionTokens: 50 });
  });
  it("acepta frames sin separador vacío y datos multilínea", () => {
    expect(extraerUso(`data: ${JSON.stringify(respuesta)}\ndata: [DONE]`, "text/event-stream")?.promptTokens).toBe(123);
    expect(extraerUso('data: {"usage":\ndata: {"prompt_tokens":1,"completion_tokens":2}}\n\n', "text/event-stream"))
      .toEqual({ promptTokens: 1, completionTokens: 2 });
  });
  it.each(["basura", "null", "{}", "[]", '{"usage":null}', '{"usage":{"prompt_tokens":-1,"completion_tokens":4}}',
    '{"usage":{"prompt_tokens":"1","completion_tokens":4}}', '{"usage":{"prompt_tokens":1.5,"completion_tokens":4}}'])
  ("ignora entradas inválidas: %s", (cuerpo) => expect(extraerUso(cuerpo, "application/json")).toBeNull());
  it("no exige costo ni modelo", () => {
    expect(extraerUso('{"usage":{"prompt_tokens":0,"completion_tokens":0}}', "application/json"))
      .toEqual({ promptTokens: 0, completionTokens: 0 });
  });
});
