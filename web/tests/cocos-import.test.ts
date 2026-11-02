import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv } from "../lib/import/csv";

test("Cocos uses its settled total, Argentinian separators and ticket reference", () => {
  const csv = 'nroTicket;nroComprobante;fechaEjecucion;fechaLiquidacion;tipoOperacion;instrumento;moneda;mercado;cantidad;precio;montoBruto;comision;ddmm;iva;otros;total\n'
    + 'abc;1;10-04-2026;11-04-2026;Recibo De Cobro;;ARS;;;;46.000;2;0;0;0;46.000\n'
    + 'def;2;10-04-2026;10-04-2026;Liq Suscripcion Fci Usd;FONDO;USD;;1;1;-1.200;0;0;0;0;-1.200\n'
    + 'ghi;3;19-05-2026;19-05-2026;Recibo;;USD;;;;257,09;0;0;0;0;257,09';
  const result = parseCsv(csv);
  assert.equal(result.format, "cocos"); assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].amount, 46000); assert.equal(result.rows[0].date, "2026-04-11");
  assert.equal(result.rows[1].amount, -1200); assert.equal(result.rows[1].description, "Liq Suscripcion Fci Usd — FONDO");
  assert.equal(result.rows[2].amount, 257.09); assert.equal(result.rows[2].reference, "ghi");
});
