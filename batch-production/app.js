/* UI and persistence adapter. Legacy pwa_v9_* data is never read or written. */
(function () {
  'use strict';
  const Core = window.BatchCore;
  const STORAGE_KEY = 'pwa_tfg_batch_v1';
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const money = cents => '$' + (cents / 100).toFixed(2);
  const quantity = qty => qty.toLocaleString('es', {maximumFractionDigits: 6});
  const duration = seconds => { const minutes = seconds / 60; return minutes >= 60 ? quantity(minutes / 60) + ' h' : quantity(minutes) + ' min'; };
  const date = iso => new Date(iso).toLocaleString('es', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});
  let state = Core.empty(), snapshot = null, blocked = false, activeView = 'cash', busy = false, productReturn = null, pendingCancel = null, toastTimer;

  function load() {
    try {
      snapshot = localStorage.getItem(STORAGE_KEY);
      state = snapshot === null ? Core.empty() : Core.validate(JSON.parse(snapshot));
    } catch (error) {
      blocked = true;
      $('storage-error').textContent = 'No se pueden leer o guardar los datos de esta versión. Tus datos anteriores no se han borrado. No registres operaciones hasta resolver el almacenamiento. ' + error.message;
      $('storage-error').hidden = false;
    }
  }
  function transact(command, input) {
    if (blocked) throw new Error('El almacenamiento no está disponible. No se ha cambiado nada.');
    if (localStorage.getItem(STORAGE_KEY) !== snapshot) throw new Error('Los datos cambiaron en otra pestaña. Vuelve a abrir esta página antes de guardar.');
    const change = Core.apply(state, command, input);
    const nextSnapshot = JSON.stringify(change.state);
    // A single setItem commits the complete state. Failed writes leave state unchanged.
    try { localStorage.setItem(STORAGE_KEY, nextSnapshot); }
    catch (_) { throw new Error('No se pudo guardar. Revisa el espacio o los permisos del navegador. No se ha registrado la operación.'); }
    snapshot = nextSnapshot; state = change.state;
    render();
    return change.result;
  }
  function toast(message) {
    $('toast').textContent = message; $('toast').hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
  }
  function switchView(view) {
    if (!['products', 'materials', 'production', 'cash'].includes(view)) return;
    activeView = view;
    document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== 'view-' + view; });
    document.querySelectorAll('[data-view]').forEach(btn => { if (btn.dataset.view === view) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current'); });
    $('page-title').textContent = {products:'⭐ Mis Productos', materials:'📦 Mi Almacén', production:'🏭 Registrar Fabricación', cash:'📊 Mi Caja'}[view];
    window.scrollTo({top: 0, behavior:'instant'});
  }
  function options() {
    const selected = $('production-product').value;
    $('production-product').innerHTML = '<option value="">Elige un producto</option>' + state.products.map(p => `<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('');
    if (state.products.some(p => p.id === selected)) $('production-product').value = selected;
  }
  function renderProducts() {
    $('products-list').innerHTML = state.products.length ? state.products.map(p => {
      const qty = Core.stock(state, p.id);
      return `<article class="item receta"><div class="item-fila product-head"><div><div class="item-nombre">${escape(p.name)}</div><div class="item-sub">${quantity(qty)} unidades listas para vender</div></div><span class="badge ${qty ? 'badge-ok' : 'badge-agotado'}">${qty ? quantity(qty) + ' unidades' : 'Sin stock'}</span></div><div class="item-acciones"><button class="btn btn-naranja btn-sm" type="button" data-sell="${escape(p.id)}" ${!qty || blocked ? 'disabled' : ''}>▶ Vender ahora</button><button class="btn-editar" type="button" data-produce="${escape(p.id)}">🏭 Fabricar</button></div></article>`;
    }).join('') : '<div class="vacio"><span class="ico-vacio" aria-hidden="true">⭐</span><p>No tienes productos terminados.<br>Crea un producto y registra tu primera fabricación.</p></div>';
  }
  function renderMaterials() {
    $('materials-list').innerHTML = state.materials.length ? state.materials.map(m => {
      const badge = m.qty <= 0 ? '<span class="badge badge-agotado">Sin stock</span>' : m.qty <= 2 ? '<span class="badge badge-alerta">⚠ Stock bajo</span>' : `<span class="badge badge-ok">${quantity(m.qty)} ${escape(m.unit)}</span>`;
      return `<article class="item ${m.qty <= 2 ? 'stock-bajo' : ''}"><div class="item-fila"><div><div class="item-nombre">${escape(m.name)}</div><div class="item-sub">Coste: ${money(m.qty > 0 ? m.valueCents / m.qty : 0)} / ${escape(m.unit)} · ${quantity(m.qty)} ${escape(m.unit)}</div></div><div>${badge}</div></div></article>`;
    }).join('') : '<div class="vacio"><span class="ico-vacio" aria-hidden="true">📦</span><p>Almacén vacío.<br>Registra tu primera compra arriba.</p></div>';
  }
  function renderHistory() {
    const totals = Core.totals(state);
    $('cash-total').textContent = money(totals.cashCents); $('cash-in').textContent = money(totals.incomingCents); $('cash-out').textContent = money(totals.outgoingCents);
    const activeSales = state.sales.filter(sale => !sale.cancelled).map(Core.saleTotals);
    const attributedSeconds = activeSales.reduce((sum, sale) => sum + sale.seconds, 0);
    const netCents = activeSales.reduce((sum, sale) => sum + sale.netCents, 0);
    $('cash-hourly').textContent = money(attributedSeconds > 0 ? netCents * 3600 / attributedSeconds : 0);
    const entries = [...state.purchases.map(p => ({...p, kind:'purchase'})), ...state.batches.map(b => ({...b, kind:'batch'})), ...state.sales.map(s => ({...s, kind:'sale'}))].sort((a, b) => b.sequence - a.sequence);
    $('history-list').innerHTML = entries.length ? entries.map(e => {
      const material = state.materials.find(m => m.id === e.materialId);
      const title = e.kind === 'purchase' ? 'Compra: ' + material.name : (e.kind === 'batch' ? 'Fabricación: ' : 'Venta: ') + e.productName;
      const value = e.kind === 'batch' ? quantity(e.qty) + ' unidades' : (e.kind === 'purchase' ? '−' : '+') + money(e.paymentCents);
      return `<article class="item ${e.kind === 'purchase' ? 'gasto' : e.kind === 'sale' ? 'ingreso' : 'receta'}"><div class="item-fila"><div><div class="item-nombre">${escape(title)}</div><div class="item-sub">${escape(date(e.createdAt))}${e.cancelled ? ' · ANULADO' : ''}</div></div><div class="item-monto ${e.kind === 'sale' ? 'texto-verde' : e.kind === 'purchase' ? 'texto-rojo' : ''}">${value}</div></div>${e.kind !== 'purchase' ? `<div class="item-acciones"><button class="btn-editar" type="button" data-detail="${escape(e.id)}" data-kind="${e.kind}">✏️ Ver detalle${!e.cancelled ? ' o corregir' : ''}</button></div>` : ''}</article>`;
    }).join('') : '<div class="vacio"><span class="ico-vacio" aria-hidden="true">📋</span><p>No hay movimientos aún.</p></div>';
  }
  function render() { options(); renderProducts(); renderMaterials(); renderHistory(); }
  function newProduct(origin) {
    productReturn = origin; $('product-form').reset(); $('product-error').textContent = ''; $('product-dialog').showModal(); $('product-name').focus();
  }
  function addMaterialRow() {
    const available = state.materials.filter(m => m.qty > 0);
    if (!available.length) { toast('Añade una compra en Materiales antes de usar materiales.'); return; }
    const row = document.createElement('div'); row.className = 'material-row';
    const id = 'consumption-' + crypto.randomUUID();
    row.innerHTML = `<div class="campo material-select"><label for="${id}">Material</label><select id="${id}" class="consumption-material"><option value="">Elige material</option>${available.map(m => `<option value="${escape(m.id)}">${escape(m.name)} (${quantity(m.qty)} ${escape(m.unit)})</option>`).join('')}</select></div><div class="campo material-quantity"><label for="${id}-qty">Cantidad</label><input id="${id}-qty" class="consumption-qty" type="number" min="0.000001" step="any" inputmode="decimal" placeholder="Cant."></div><button class="btn-peligro remove-row" type="button" aria-label="Quitar fila de material">×</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    $('consumption-rows').appendChild(row); row.querySelector('select').focus();
  }
  function openSale(id) {
    const p = state.products.find(p => p.id === id); if (!p) return;
    $('sale-form').reset(); $('sale-error').textContent = ''; $('sale-product-id').value = id;
    $('sale-product-name').textContent = p.name; $('sale-available').textContent = quantity(Core.stock(state, id)) + ' unidades disponibles';
    $('sale-qty').max = Core.stock(state, id); $('sale-qty').value = '1'; $('sale-minutes').value = '0';
    $('sale-dialog').showModal(); $('sale-qty').focus();
  }
  function row(label, value) { return `<div class="detail-row"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`; }
  function saleDetails(sale) {
    const totals = Core.saleTotals(sale);
    const allocations = sale.allocations.map(a => { const b = state.batches.find(b => b.id === a.batchId); return `<li>${quantity(a.qty)} unidades de ${escape(date(b.createdAt))} · ${money(a.costCents)} de materiales · ${duration(a.productionSeconds)} de fabricación</li>`; }).join('');
    return row('Materiales de esta venta', money(totals.costCents)) + row('Tiempo de fabricación asignado', duration(totals.productionSeconds)) + row('Tiempo adicional de venta', duration(sale.sellingSeconds)) + row('Después del coste de materiales', money(totals.netCents)) + row('Por hora atribuida a esta venta', totals.hourlyCents === null ? 'Sin tiempo registrado' : money(totals.hourlyCents) + '/h') + '<p class="hint">No incluye alquiler, transporte, impuestos ni otros gastos. El tiempo asignado puede proceder de días anteriores; no es todo el trabajo de hoy.</p><details><summary>Fabricaciones utilizadas (FIFO)</summary><p class="hint">Se usan primero las fabricaciones registradas más antiguas. Esta es una regla de cálculo.</p><ul>' + allocations + '</ul></details>';
  }
  function showSaleResult(sale) {
    $('result-content').innerHTML = '<div class="result-block"><h3>' + escape(sale.productName) + '</h3>' + row('Has recibido', money(sale.paymentCents)) + row('Unidades vendidas', quantity(sale.qty)) + '</div><p class="hint">Te quedan</p><p class="remaining">' + quantity(Core.stock(state, sale.productId)) + ' unidades</p><details><summary>Ver cómo se calcula</summary>' + saleDetails(sale) + '</details>';
    $('result-dialog').showModal();
  }
  function showDetail(kind, id) {
    const e = (kind === 'batch' ? state.batches : state.sales).find(e => e.id === id); if (!e) return;
    $('history-title').textContent = kind === 'batch' ? 'Fabricación registrada' : 'Venta registrada';
    let content = '<h3>' + escape(e.productName) + '</h3><p class="hint">' + escape(date(e.createdAt)) + (e.cancelled ? ' · Anulado' : '') + '</p>';
    if (kind === 'batch') {
      content += row('Unidades fabricadas', quantity(e.qty)) + row('Unidades que quedan', quantity(e.remainingQty)) + row('Materiales de toda la fabricación', money(e.costCents)) + row('Tiempo de toda la fabricación', duration(e.timeSeconds));
      content += '<ul>' + e.consumptions.map(c => '<li>' + escape(c.materialName) + ': ' + quantity(c.qty) + ' ' + escape(c.unit) + ' · ' + money(c.costCents) + '</li>').join('') + '</ul>';
    } else content += row('Unidades vendidas', quantity(e.qty)) + row('Has recibido', money(e.paymentCents)) + saleDetails(e);
    if (!e.cancelled) content += `<button type="button" class="btn btn-gris" data-cancel="${escape(e.id)}" data-kind="${kind}">Corregir: anular este registro</button>`;
    $('history-content').innerHTML = content; $('history-dialog').showModal();
  }
  function submit(formId, errorId, action) {
    $(formId).addEventListener('submit', event => {
      event.preventDefault(); if (busy) return;
      $(errorId).textContent = ''; busy = true;
      const button = $(formId).querySelector('[type=submit]'); button.disabled = true;
      try { action(); }
      catch (error) { $(errorId).textContent = error.message; }
      finally { busy = false; button.disabled = blocked; }
    });
  }

  load(); render();
  if (blocked) document.querySelectorAll('form [type=submit]').forEach(b => { b.disabled = true; });
  document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => $(btn.dataset.close).close()));
  $('new-product').addEventListener('click', () => newProduct('products'));
  $('new-product-production').addEventListener('click', () => newProduct('production'));
  $('products-list').addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    if (btn.hasAttribute('data-new-product')) newProduct('products');
    if (btn.dataset.sell) openSale(btn.dataset.sell);
    if (btn.dataset.produce) { switchView('production'); $('production-product').value = btn.dataset.produce; $('production-error').textContent = ''; }
  });
  $('add-material').addEventListener('click', addMaterialRow);
  $('no-materials').addEventListener('change', () => {
    // Keep existing rows in place if the user changes their mind.
    const off = $('no-materials').checked;
    $('consumption-rows').hidden = off; $('add-material').disabled = off;
  });
  submit('product-form', 'product-error', () => {
    const p = transact('product', {name: $('product-name').value}); $('product-dialog').close();
    if (productReturn === 'production') $('production-product').value = p.id;
    toast('Producto creado. Registra una fabricación para añadir unidades.');
  });
  submit('purchase-form', 'purchase-error', () => {
    transact('purchase', {name: $('material-name').value, qty: $('purchase-qty').value, unit: $('purchase-unit').value, payment: $('purchase-payment').value});
    $('purchase-form').reset(); toast('Compra guardada. Materiales añadidos al almacén.');
  });
  submit('production-form', 'production-error', () => {
    const noMaterials = $('no-materials').checked;
    const materials = noMaterials ? [] : Array.from($('consumption-rows').children).map(row => {
      const id = row.querySelector('select').value, qty = row.querySelector('input').value;
      if (!id || qty === '') throw new Error('Completa o quita cada fila de material.');
      return {materialId: id, qty};
    });
    const batch = transact('produce', {productId: $('production-product').value, qty: $('production-qty').value, minutes: $('production-minutes').value, materials, noMaterials});
    $('production-form').reset(); $('consumption-rows').replaceChildren(); $('consumption-rows').hidden = false; $('add-material').disabled = false;
    switchView('products'); toast('Fabricación guardada: ' + batch.qty + ' unidades de ' + batch.productName + '.');
  });
  submit('sale-form', 'sale-error', () => {
    const sale = transact('sell', {productId: $('sale-product-id').value, qty: $('sale-qty').value, payment: $('sale-payment').value, minutes: $('sale-minutes').value});
    $('sale-dialog').close(); switchView('products'); showSaleResult(sale);
  });
  $('history-list').addEventListener('click', e => { const btn = e.target.closest('[data-detail]'); if (btn) showDetail(btn.dataset.kind, btn.dataset.detail); });
  $('history-content').addEventListener('click', e => {
    const btn = e.target.closest('[data-cancel]'); if (!btn) return;
    pendingCancel = {kind: btn.dataset.kind, id: btn.dataset.cancel};
    $('cancel-description').textContent = btn.dataset.kind === 'batch' ? 'Se retirarán las unidades terminadas y se devolverán los materiales con su coste original. Si hay ventas activas, tendrás que anularlas primero.' : 'Se devolverán los productos al stock y se restará de caja la entrada registrada en esta venta.';
    $('cancel-error').textContent = ''; $('history-dialog').close(); $('cancel-dialog').showModal();
  });
  submit('cancel-form', 'cancel-error', () => {
    if (!pendingCancel) throw new Error('Elige un registro.');
    transact(pendingCancel.kind === 'batch' ? 'cancelProduction' : 'cancelSale', {id: pendingCancel.id});
    $('cancel-dialog').close(); pendingCancel = null; toast('Registro anulado. Stock y caja actualizados.');
  });
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY || e.key === null) {
      blocked = true; $('storage-error').textContent = 'Los datos cambiaron en otra pestaña. Vuelve a abrir esta página antes de registrar nuevas operaciones.'; $('storage-error').hidden = false;
      document.querySelectorAll('form [type=submit]').forEach(b => { b.disabled = true; });
    }
  });
  switchView(activeView);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => {
      $('offline-status').textContent = 'Lista sin conexión · datos guardados en este navegador.';
    }).catch(() => { $('offline-status').textContent = 'Datos locales · la preparación sin conexión no se completó. Vuelve a abrir con conexión.'; });
  }
})();
