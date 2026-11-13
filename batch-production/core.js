/* Batch production domain model. All money is stored in integer cents.
   Standalone browser/Node module; no DOM, storage or network access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BatchCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const units = ['kg', 'gramos', 'litros', 'metros', 'unidades'];
  function fail(message) { throw new Error(message); }
  function number(value, label, min = 0, integer = false) {
    if (value === '' || value === null || value === undefined || typeof value === 'boolean') fail('Indica ' + label + '.');
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > 1e9 || (integer && !Number.isInteger(n))) fail('Revisa ' + label + '.');
    return n;
  }
  function name(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) fail('Escribe un nombre de entre 1 y 100 caracteres.');
    return value.trim();
  }
  const normalize = value => value.normalize('NFKC').trim().toLocaleLowerCase('es');
  const roundQty = value => Math.round(value * 1e6) / 1e6;
  function quantity(value) {
    const n = roundQty(number(value, 'una cantidad mayor que cero', 0));
    if (n <= 0) fail('La cantidad debe ser mayor que cero.');
    return n;
  }
  function cents(value) {
    const n = number(value, 'un importe mayor que cero');
    const result = Math.round((n + Number.EPSILON) * 100);
    if (result <= 0) fail('El importe debe ser al menos 0,01.');
    return result;
  }
  function empty() { return {schemaVersion: VERSION, nextSequence: 1, products: [], materials: [], purchases: [], batches: [], sales: []}; }
  function validate(state) {
    const savedNumber = (value, label, min = 0, integer = false) => {
      if (typeof value !== 'number') fail('Un valor guardado no es numérico.');
      return number(value, label, min, integer);
    };
    if (!state || state.schemaVersion !== VERSION || !Number.isSafeInteger(state.nextSequence) || state.nextSequence < 1) fail('El formato de los datos no es compatible. No se ha cambiado nada.');
    const ids = new Set();
    for (const table of ['products', 'materials', 'purchases', 'batches', 'sales']) {
      if (!Array.isArray(state[table])) fail('Los datos guardados están incompletos.');
      for (const row of state[table]) {
        if (!row || typeof row.id !== 'string' || ids.has(row.id)) fail('Hay un identificador no válido.');
        ids.add(row.id);
        if (!Number.isSafeInteger(row.sequence) || row.sequence < 1 || row.sequence >= state.nextSequence || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || typeof row.cancelled !== 'boolean') fail('Un registro guardado está incompleto.');
        if (table === 'products' || table === 'materials') name(row.name);
      }
    }
    for (const m of state.materials) {
      savedNumber(m.qty, 'el stock'); savedNumber(m.valueCents, 'el valor del stock', 0, true);
      if (!units.includes(m.unit)) fail('Unidad de material no compatible.');
    }
    for (const b of state.batches) {
      savedNumber(b.qty, 'el número de unidades', 1, true);
      savedNumber(b.remainingQty, 'las unidades disponibles', 0, true);
      savedNumber(b.costCents, 'el coste de producción', 0, true);
      savedNumber(b.remainingCostCents, 'el coste restante', 0, true);
      savedNumber(b.timeSeconds, 'el tiempo de producción', 0, true);
      savedNumber(b.remainingTimeSeconds, 'el tiempo restante', 0, true);
      if (b.remainingQty > b.qty || b.remainingCostCents > b.costCents || b.remainingTimeSeconds > b.timeSeconds || !state.products.some(p => p.id === b.productId)) fail('Una fabricación no es coherente con el stock.');
      if (!Array.isArray(b.consumptions) || b.consumptions.some(c => !state.materials.some(m => m.id === c.materialId))) fail('Falta un material de una fabricación.');
      for (const c of b.consumptions) { savedNumber(c.qty, 'la cantidad consumida'); savedNumber(c.costCents, 'el coste consumido', 0, true); }
      if (b.consumptions.reduce((sum, c) => sum + c.costCents, 0) !== b.costCents) fail('El coste de fabricación no coincide con los materiales.');
    }
    for (const p of state.purchases) {
      savedNumber(p.paymentCents, 'el importe de compra', 1, true); savedNumber(p.qty, 'la cantidad comprada');
      if (!state.materials.some(m => m.id === p.materialId)) fail('Falta el material de una compra.');
    }
    for (const s of state.sales) {
      savedNumber(s.paymentCents, 'el importe de venta', 1, true); savedNumber(s.qty, 'el número vendido', 1, true);
      savedNumber(s.sellingSeconds, 'el tiempo de venta', 0, true);
      if (!Array.isArray(s.allocations) || s.allocations.reduce((sum, a) => sum + a.qty, 0) !== s.qty) fail('Una venta tiene una asignación incompleta.');
      for (const a of s.allocations) {
        const batch = state.batches.find(b => b.id === a.batchId);
        if (!batch || batch.productId !== s.productId) fail('Falta una fabricación de una venta.');
        savedNumber(a.qty, 'la cantidad asignada', 1, true); savedNumber(a.costCents, 'el coste asignado', 0, true); savedNumber(a.productionSeconds, 'el tiempo asignado', 0, true);
      }
    }
    for (const b of state.batches) {
      const allocated = state.sales.filter(s => !s.cancelled).flatMap(s => s.allocations).filter(a => a.batchId === b.id);
      if (b.cancelled) {
        if (allocated.length || b.remainingQty || b.remainingCostCents || b.remainingTimeSeconds) fail('Una fabricación anulada conserva movimientos activos.');
      } else if (b.remainingQty + allocated.reduce((s, a) => s + a.qty, 0) !== b.qty || b.remainingCostCents + allocated.reduce((s, a) => s + a.costCents, 0) !== b.costCents || b.remainingTimeSeconds + allocated.reduce((s, a) => s + a.productionSeconds, 0) !== b.timeSeconds) fail('No coinciden la fabricación y sus ventas.');
    }
    for (const m of state.materials) {
      const purchases = state.purchases.filter(p => p.materialId === m.id);
      const consumption = state.batches.filter(b => !b.cancelled).flatMap(b => b.consumptions).filter(c => c.materialId === m.id);
      const expectedQty = roundQty(purchases.reduce((sum, p) => sum + p.qty, 0) - consumption.reduce((sum, c) => sum + c.qty, 0));
      const expectedCents = purchases.reduce((sum, p) => sum + p.paymentCents, 0) - consumption.reduce((sum, c) => sum + c.costCents, 0);
      if (expectedQty !== m.qty || expectedCents !== m.valueCents) fail('No coinciden las compras y el almacén.');
    }
    return state;
  }
  function event(state, kind) {
    const sequence = state.nextSequence++;
    return {id: kind + '-' + sequence, sequence, createdAt: new Date().toISOString(), cancelled: false};
  }
  function product(state, id) { const p = state.products.find(p => p.id === id); if (!p) fail('Elige un producto.'); return p; }
  function stock(state, productId) { return state.batches.filter(b => !b.cancelled && b.productId === productId).reduce((sum, b) => sum + b.remainingQty, 0); }
  function apply(state, command, input) {
    validate(state);
    const next = JSON.parse(JSON.stringify(state));
    let result;
    if (command === 'product') {
      const n = name(input.name);
      if (next.products.some(p => normalize(p.name) === normalize(n))) fail('Este producto ya existe. Elígelo en la lista.');
      result = {...event(next, 'product'), name: n}; next.products.push(result);
    } else if (command === 'purchase') {
      const n = name(input.name), qty = quantity(input.qty), paymentCents = cents(input.payment);
      if (!units.includes(input.unit)) fail('Elige una unidad.');
      let material = next.materials.find(m => normalize(m.name) === normalize(n));
      if (material && material.unit !== input.unit) fail('Este material usa ' + material.unit + '. Mantén esa unidad; no se convierten unidades automáticamente.');
      if (!material) { material = {...event(next, 'material'), name: n, unit: input.unit, qty: 0, valueCents: 0}; next.materials.push(material); }
      material.qty = roundQty(material.qty + qty); material.valueCents += paymentCents;
      result = {...event(next, 'purchase'), materialId: material.id, qty, paymentCents}; next.purchases.push(result);
    } else if (command === 'produce') {
      const p = product(next, input.productId), qty = number(input.qty, 'un número entero de unidades', 1, true);
      const timeSeconds = number(input.minutes, 'el tiempo total en minutos', 0, true) * 60;
      if (!Array.isArray(input.materials)) fail('Revisa los materiales.');
      if (!input.materials.length && input.noMaterials !== true) fail('Añade los materiales usados o marca que no se usaron materiales.');
      if (input.noMaterials && input.materials.length) fail('Revisa la selección de materiales.');
      const grouped = new Map();
      for (const c of input.materials) grouped.set(c.materialId, roundQty((grouped.get(c.materialId) || 0) + quantity(c.qty)));
      const consumptions = [];
      for (const [id, usedQty] of grouped) {
        const m = next.materials.find(m => m.id === id);
        if (!m) fail('El material ya no está disponible.');
        if (usedQty > m.qty) fail('No hay suficiente ' + m.name + ': tienes ' + m.qty + ' ' + m.unit + '.');
        const costCents = usedQty === m.qty ? m.valueCents : Math.round(m.valueCents * usedQty / m.qty);
        consumptions.push({materialId: id, qty: usedQty, costCents, materialName: m.name, unit: m.unit});
      }
      for (const c of consumptions) { const m = next.materials.find(m => m.id === c.materialId); m.qty = roundQty(m.qty - c.qty); m.valueCents -= c.costCents; }
      const costCents = consumptions.reduce((sum, c) => sum + c.costCents, 0);
      result = {...event(next, 'batch'), productId: p.id, productName: p.name, qty, costCents, timeSeconds, remainingQty: qty, remainingCostCents: costCents, remainingTimeSeconds: timeSeconds, consumptions};
      next.batches.push(result);
    } else if (command === 'sell') {
      const p = product(next, input.productId), qty = number(input.qty, 'un número entero de unidades', 1, true), paymentCents = cents(input.payment);
      const sellingSeconds = number(input.minutes, 'el tiempo adicional de venta en minutos', 0, true) * 60;
      if (qty > stock(next, p.id)) fail('No hay suficientes productos terminados. Tienes ' + stock(next, p.id) + ' unidades.');
      let needed = qty; const allocations = [];
      for (const b of next.batches.filter(b => !b.cancelled && b.productId === p.id && b.remainingQty > 0).sort((a, b) => a.sequence - b.sequence)) {
        const take = Math.min(needed, b.remainingQty);
        const costCents = take === b.remainingQty ? b.remainingCostCents : Math.min(b.remainingCostCents, Math.round(b.costCents * take / b.qty));
        const productionSeconds = take === b.remainingQty ? b.remainingTimeSeconds : Math.min(b.remainingTimeSeconds, Math.round(b.timeSeconds * take / b.qty));
        allocations.push({batchId: b.id, qty: take, costCents, productionSeconds});
        b.remainingQty -= take; b.remainingCostCents -= costCents; b.remainingTimeSeconds -= productionSeconds;
        needed -= take; if (!needed) break;
      }
      result = {...event(next, 'sale'), productId: p.id, productName: p.name, qty, paymentCents, sellingSeconds, allocations}; next.sales.push(result);
    } else if (command === 'cancelSale') {
      result = next.sales.find(s => s.id === input.id);
      if (!result || result.cancelled) fail('Esta venta ya no está activa.');
      for (const a of result.allocations) { const b = next.batches.find(b => b.id === a.batchId); b.remainingQty += a.qty; b.remainingCostCents += a.costCents; b.remainingTimeSeconds += a.productionSeconds; }
      result.cancelled = true; result.cancelledAt = new Date().toISOString();
    } else if (command === 'cancelProduction') {
      result = next.batches.find(b => b.id === input.id);
      if (!result || result.cancelled) fail('Esta fabricación ya no está activa.');
      if (next.sales.some(s => !s.cancelled && s.allocations.some(a => a.batchId === result.id))) fail('Esta fabricación tiene ventas. Anula primero esas ventas si quieres corregirla.');
      for (const c of result.consumptions) { const m = next.materials.find(m => m.id === c.materialId); m.qty = roundQty(m.qty + c.qty); m.valueCents += c.costCents; }
      result.cancelled = true; result.cancelledAt = new Date().toISOString(); result.remainingQty = result.remainingCostCents = result.remainingTimeSeconds = 0;
    } else fail('Operación no disponible.');
    validate(next);
    return {state: next, result};
  }
  function saleTotals(sale) {
    const costCents = sale.allocations.reduce((sum, a) => sum + a.costCents, 0);
    const productionSeconds = sale.allocations.reduce((sum, a) => sum + a.productionSeconds, 0);
    const seconds = productionSeconds + sale.sellingSeconds;
    return {costCents, productionSeconds, seconds, netCents: sale.paymentCents - costCents, hourlyCents: seconds > 0 ? (sale.paymentCents - costCents) * 3600 / seconds : null};
  }
  function totals(state) {
    const sales = state.sales.filter(s => !s.cancelled);
    const incomingCents = sales.reduce((s, a) => s + a.paymentCents, 0);
    const outgoingCents = state.purchases.reduce((s, p) => s + p.paymentCents, 0);
    return {incomingCents, outgoingCents, cashCents: incomingCents - outgoingCents};
  }
  return {VERSION, units, empty, validate, apply, stock, saleTotals, totals};
});
