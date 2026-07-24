const SHEET_NAMES = Object.freeze({
  grows: "Web_Grows",
  supplies: "Web_Supplies",
  sales: "Web_Sales",
  corrections: "Web_Corrections",
  config: "Web_Config",
  weeks: "Web_Weeks"
});

const TRIMMINGS_PER_BOX = 15;
const PAYOUT_RATES = Object.freeze({ grower: 0.70, gang: 0.15, seller: 0.15 });

const HEADERS = Object.freeze({
  grows: ["id", "timestamp", "grower", "strain", "trimmings", "unitPrice", "notes", "createdAt", "weekId", "deletedAt", "deleteReason"],
  supplies: ["id", "timestamp", "buyer", "item", "quantity", "unitCost", "total", "notes", "paidAt", "createdAt", "weekId", "deletedAt", "deleteReason"],
  sales: ["id", "timestamp", "seller", "grower", "strain", "boxes", "unitPrice", "gross", "supplyDeduction", "growerPayout", "gangPayout", "sellerPayout", "reference", "growerPaidAt", "sellerPaidAt", "createdAt", "weekId", "deletedAt", "deleteReason"],
  corrections: ["id", "timestamp", "recordType", "recordId", "action", "beforeJson", "afterJson", "reason", "createdAt"],
  config: ["kind", "name", "price", "active"],
  weeks: ["id", "label", "startedAt", "closedAt", "status", "createdAt"]
});

function doGet() {
  return json_({ ok: true, service: "Clown Tent tracker", status: "online" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    assertAccess_(body.accessCode);
    const action = String(body.action || "");
    let result;
    if (["verifyAdmin", "updateGrow", "updateSupply", "updateSale", "deleteGrow", "deleteSupply", "deleteSale", "settleSale", "settleSupply", "settlePayouts", "reopenPayout", "rolloverWeek", "upsertConfig", "removeConfig"].indexOf(action) !== -1) assertAdmin_(body.adminCode);
    if (action === "bootstrap") result = bootstrap_();
    else if (action === "verifyAdmin") result = { authorized: true };
    else if (action === "addGrow") result = addGrow_(body.record || {});
    else if (action === "addSupply") result = addSupply_(body.record || {});
    else if (action === "addSale") result = addSale_(body.record || {});
    else if (action === "updateGrow") result = updateGrow_(body.id, body.record || {}, body.reason);
    else if (action === "updateSupply") result = updateSupply_(body.id, body.record || {}, body.reason);
    else if (action === "updateSale") result = updateSale_(body.id, body.record || {}, body.reason);
    else if (action === "deleteGrow") result = deleteGrow_(body.id, body.reason);
    else if (action === "deleteSupply") result = deleteSupply_(body.id, body.reason);
    else if (action === "deleteSale") result = deleteSale_(body.id, body.reason);
    else if (action === "settleSale") result = settleSale_(body.id, body.role);
    else if (action === "settleSupply") result = settleSupply_(body.id);
    else if (action === "settlePayouts") result = settlePayouts_(body.items);
    else if (action === "reopenPayout") result = reopenPayout_(body.id, body.role, body.reason);
    else if (action === "rolloverWeek") result = rolloverWeek_(body.label);
    else if (action === "upsertConfig") result = upsertConfig_(body.kind, body.name, body.price);
    else if (action === "removeConfig") result = removeConfig_(body.kind, body.name);
    else throw new Error("Unknown tracker action.");
    return json_({ ok: true, data: result });
  } catch (error) {
    return json_({ ok: false, error: error && error.message ? error.message : "Unexpected tracker error." });
  }
}

function setupTracker() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureSheets_();
    seedConfig_();
    const properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty("ACCESS_CODE")) throw new Error("Set ACCESS_CODE in Project Settings, Script properties, then run setupTracker again.");
    if (!properties.getProperty("ADMIN_CODE")) throw new Error("Set ADMIN_CODE in Project Settings, Script properties, then run setupTracker again.");
    return "Tracker ready.";
  } finally {
    lock.releaseLock();
  }
}

function bootstrap_() {
  ensureSheets_();
  const configs = readObjects_(SHEET_NAMES.config);
  return {
    members: configs.filter(function (row) { return row.kind === "member" && truthy_(row.active); }).map(function (row) { return row.name; }).sort(),
    strains: configs.filter(function (row) { return row.kind === "strain" && truthy_(row.active); }).map(function (row) { return { name: row.name, price: number_(row.price) }; }).sort(function (a, b) { return a.name.localeCompare(b.name); }),
    grows: readActiveObjects_(SHEET_NAMES.grows).map(normalizeGrow_),
    supplies: readActiveObjects_(SHEET_NAMES.supplies).map(normalizeSupply_),
    sales: readActiveObjects_(SHEET_NAMES.sales).map(normalizeSale_),
    corrections: readObjects_(SHEET_NAMES.corrections),
    weeks: readObjects_(SHEET_NAMES.weeks),
    activeWeek: activeWeek_()
  };
}

function addGrow_(record) {
  validateRequired_(record, ["timestamp", "grower", "strain", "trimmings"]);
  const trimmings = number_(record.trimmings);
  if (!Number.isInteger(trimmings) || trimmings <= 0) throw new Error("Trimmings must be a whole number greater than zero.");
  const week = activeWeek_();
  withLock_(function () {
    appendObject_(SHEET_NAMES.grows, HEADERS.grows, {
      id: Utilities.getUuid(),
      timestamp: safeDate_(record.timestamp),
      grower: clean_(record.grower, 60),
      strain: clean_(record.strain, 80),
      trimmings: trimmings,
      unitPrice: Math.max(0, number_(record.unitPrice)),
      notes: clean_(record.notes, 300),
      createdAt: new Date().toISOString(),
      weekId: week.id
    });
  });
  return bootstrap_();
}

function addSupply_(record) {
  validateRequired_(record, ["timestamp", "buyer", "item", "quantity", "unitCost"]);
  const quantity = number_(record.quantity);
  const unitCost = number_(record.unitCost);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Supply quantity must be a whole number greater than zero.");
  if (unitCost < 0) throw new Error("Supply cost cannot be negative.");
  const week = activeWeek_();
  withLock_(function () {
    appendObject_(SHEET_NAMES.supplies, HEADERS.supplies, {
      id: Utilities.getUuid(),
      timestamp: safeDate_(record.timestamp),
      buyer: clean_(record.buyer, 60),
      item: clean_(record.item, 100),
      quantity: quantity,
      unitCost: unitCost,
      total: round_(quantity * unitCost),
      notes: clean_(record.notes, 300),
      paidAt: "",
      createdAt: new Date().toISOString(),
      weekId: week.id
    });
  });
  return bootstrap_();
}

function updateSupply_(id, record, reason) {
  validateRequired_(record, ["timestamp", "buyer", "item", "quantity", "unitCost"]);
  reason = clean_(reason, 240);
  if (!reason) throw new Error("Add a short reason for the supply correction.");
  const quantity = number_(record.quantity);
  const unitCost = number_(record.unitCost);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Supply quantity must be a whole number greater than zero.");
  if (unitCost < 0) throw new Error("Supply cost cannot be negative.");
  withLock_(function () {
    const located = findObjectRow_(SHEET_NAMES.supplies, id);
    const before = normalizeSupply_(located.object);
    if (before.deletedAt) throw new Error("That supply purchase has already been deleted.");
    const buyer = clean_(record.buyer, 60);
    const item = clean_(record.item, 100);
    const affectsReimbursement = String(before.buyer) !== buyer || number_(before.quantity) !== quantity || number_(before.unitCost) !== unitCost;
    const after = Object.assign({}, before, {
      timestamp: safeDate_(record.timestamp),
      buyer: buyer,
      item: item,
      quantity: quantity,
      unitCost: unitCost,
      total: round_(quantity * unitCost),
      notes: clean_(record.notes, 300),
      paidAt: affectsReimbursement ? "" : before.paidAt
    });
    writeObjectRow_(SHEET_NAMES.supplies, located.rowNumber, after);
    logCorrection_("supply", id, "edit", before, after, reason);
  });
  return bootstrap_();
}

function deleteSupply_(id, reason) {
  reason = clean_(reason, 240);
  if (!reason) throw new Error("Add a short reason for deleting the supply purchase.");
  withLock_(function () {
    const located = findObjectRow_(SHEET_NAMES.supplies, id);
    const before = normalizeSupply_(located.object);
    if (before.deletedAt) throw new Error("That supply purchase has already been deleted.");
    const after = Object.assign({}, before, { deletedAt: new Date().toISOString(), deleteReason: reason });
    writeObjectRow_(SHEET_NAMES.supplies, located.rowNumber, after);
    logCorrection_("supply", id, "delete", before, after, reason);
  });
  return bootstrap_();
}

function calculateSaleAmounts_(boxes, unitPrice, supplyBalance) {
  const gross = round_(boxes * unitPrice);
  const growerPayout = round_(gross * PAYOUT_RATES.grower);
  const sellerPayout = round_(gross * PAYOUT_RATES.seller);
  const gangShare = round_(gross - growerPayout - sellerPayout);
  const supplyDeduction = Math.min(gangShare, Math.max(0, round_(supplyBalance)));
  return {
    gross: gross,
    supplyDeduction: supplyDeduction,
    growerPayout: growerPayout,
    gangPayout: round_(gangShare - supplyDeduction),
    sellerPayout: sellerPayout
  };
}

function addSale_(record) {
  validateRequired_(record, ["timestamp", "seller", "grower", "strain", "boxes", "unitPrice"]);
  const boxes = number_(record.boxes);
  const unitPrice = number_(record.unitPrice);
  if (!Number.isInteger(boxes) || boxes <= 0) throw new Error("Boxes must be a whole number greater than zero.");
  if (unitPrice < 0) throw new Error("Price cannot be negative.");
  const week = activeWeek_();
  withLock_(function () {
    const available = availableBoxes_(record.grower, record.strain);
    if (boxes > available + 0.0001) throw new Error("Only " + available + " boxes remain for that grower and strain.");
    const amounts = calculateSaleAmounts_(boxes, unitPrice, outstandingSupplies_());
    appendObject_(SHEET_NAMES.sales, HEADERS.sales, {
      id: Utilities.getUuid(),
      timestamp: safeDate_(record.timestamp),
      seller: clean_(record.seller, 60),
      grower: clean_(record.grower, 60),
      strain: clean_(record.strain, 80),
      boxes: boxes,
      unitPrice: unitPrice,
      gross: amounts.gross,
      supplyDeduction: amounts.supplyDeduction,
      growerPayout: amounts.growerPayout,
      gangPayout: amounts.gangPayout,
      sellerPayout: amounts.sellerPayout,
      reference: clean_(record.reference, 120),
      growerPaidAt: "",
      sellerPaidAt: "",
      createdAt: new Date().toISOString(),
      weekId: week.id
    });
  });
  return bootstrap_();
}

function updateGrow_(id, record, reason) {
  validateRequired_(record, ["timestamp", "grower", "strain", "trimmings"]);
  reason = clean_(reason, 240);
  if (!reason) throw new Error("Add a short reason for the grow correction.");
  const trimmings = number_(record.trimmings);
  if (!Number.isInteger(trimmings) || trimmings <= 0) throw new Error("Trimmings must be a whole number greater than zero.");
  withLock_(function () {
    const located = findObjectRow_(SHEET_NAMES.grows, id);
    const before = normalizeGrow_(located.object);
    if (before.deletedAt) throw new Error("That grow has already been deleted.");
    const after = Object.assign({}, before, {
      timestamp: safeDate_(record.timestamp),
      grower: clean_(record.grower, 60),
      strain: clean_(record.strain, 80),
      trimmings: trimmings,
      unitPrice: Math.max(0, number_(record.unitPrice)),
      notes: clean_(record.notes, 300)
    });
    const grows = readActiveObjects_(SHEET_NAMES.grows).map(normalizeGrow_).map(function (row) { return String(row.id) === String(id) ? after : row; });
    assertInventoryValid_(grows, readActiveObjects_(SHEET_NAMES.sales).map(normalizeSale_));
    writeObjectRow_(SHEET_NAMES.grows, located.rowNumber, after);
    logCorrection_("grow", id, "edit", before, after, reason);
  });
  return bootstrap_();
}

function updateSale_(id, record, reason) {
  validateRequired_(record, ["timestamp", "seller", "grower", "strain", "boxes", "unitPrice"]);
  reason = clean_(reason, 240);
  if (!reason) throw new Error("Add a short reason for the sale correction.");
  const boxes = number_(record.boxes);
  const unitPrice = number_(record.unitPrice);
  if (!Number.isInteger(boxes) || boxes <= 0) throw new Error("Boxes must be a whole number greater than zero.");
  if (unitPrice < 0) throw new Error("Price cannot be negative.");
  withLock_(function () {
    const located = findObjectRow_(SHEET_NAMES.sales, id);
    const before = normalizeSale_(located.object);
    if (before.deletedAt) throw new Error("That sale has already been deleted.");
    const suppliesWithoutThisSale = outstandingSuppliesExcludingSale_(id);
    const amounts = calculateSaleAmounts_(boxes, unitPrice, suppliesWithoutThisSale);
    const affectsPayout = String(before.seller) !== clean_(record.seller, 60) ||
      String(before.grower) !== clean_(record.grower, 60) ||
      String(before.strain) !== clean_(record.strain, 80) ||
      number_(before.boxes) !== boxes || number_(before.unitPrice) !== unitPrice;
    const after = Object.assign({}, before, {
      timestamp: safeDate_(record.timestamp),
      seller: clean_(record.seller, 60),
      grower: clean_(record.grower, 60),
      strain: clean_(record.strain, 80),
      boxes: boxes,
      unitPrice: unitPrice,
      gross: amounts.gross,
      supplyDeduction: amounts.supplyDeduction,
      growerPayout: amounts.growerPayout,
      gangPayout: amounts.gangPayout,
      sellerPayout: amounts.sellerPayout,
      reference: clean_(record.reference, 120),
      growerPaidAt: affectsPayout ? "" : before.growerPaidAt,
      sellerPaidAt: affectsPayout ? "" : before.sellerPaidAt
    });
    const sales = readActiveObjects_(SHEET_NAMES.sales).map(normalizeSale_).map(function (row) { return String(row.id) === String(id) ? after : row; });
    assertInventoryValid_(readActiveObjects_(SHEET_NAMES.grows).map(normalizeGrow_), sales);
    writeObjectRow_(SHEET_NAMES.sales, located.rowNumber, after);
    logCorrection_("sale", id, "edit", before, after, reason);
  });
  return bootstrap_();
}

function deleteGrow_(id, reason) {
  reason = clean_(reason, 240);
  if (!reason) throw new Error("Add a short reason for deleting the grow.");
  withLock_(function () {
    const located = findObjectRow_(SHEET_NAMES.grows, id);
    const before = normalizeGrow_(located.object);
    if (before.deletedAt) throw new Error("That grow has already been deleted.");
    const grows = readActiveObjects_(SHEET_NAMES.grows).map(normalizeGrow_).filter(function (row) { return String(row.id) !== String(id); });
    assertInventoryValid_(grows, readActiveObjects_(SHEET_NAMES.sales).map(normalizeSale_));
    const after = Object.assign({}, before, { deletedAt: new Date().toISOString(), deleteReason: reason });
    writeObjectRow_(SHEET_NAMES.grows, located.rowNumber, after);
    logCorrection_("grow", id, "delete", before, after, reason);
  });
  return bootstrap_();
}

function deleteSale_(id, reason) {
  reason = clean_(reason, 240);
  if (!reason) throw new Error("Add a short reason for deleting the sale and payout.");
  withLock_(function () {
    const located = findObjectRow_(SHEET_NAMES.sales, id);
    const before = normalizeSale_(located.object);
    if (before.deletedAt) throw new Error("That sale has already been deleted.");
    const after = Object.assign({}, before, { deletedAt: new Date().toISOString(), deleteReason: reason });
    writeObjectRow_(SHEET_NAMES.sales, located.rowNumber, after);
    logCorrection_("sale", id, "delete", before, after, reason);
  });
  return bootstrap_();
}

function settleSale_(id, role) {
  if (!id || ["grower", "seller", "both"].indexOf(role) === -1) throw new Error("Invalid payout update.");
  withLock_(function () {
    const sheet = sheet_(SHEET_NAMES.sales);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const idIndex = headers.indexOf("id");
    const growerIndex = headers.indexOf("growerPaidAt");
    const sellerIndex = headers.indexOf("sellerPaidAt");
    const deletedIndex = headers.indexOf("deletedAt");
    const rowIndex = values.findIndex(function (row, index) { return index > 0 && String(row[idIndex]) === String(id); });
    if (rowIndex < 1) throw new Error("Sale not found.");
    if (deletedIndex >= 0 && values[rowIndex][deletedIndex]) throw new Error("Deleted sales cannot be settled.");
    const stamp = new Date().toISOString();
    if (role === "grower" || role === "both") sheet.getRange(rowIndex + 1, growerIndex + 1).setValue(stamp);
    if (role === "seller" || role === "both") sheet.getRange(rowIndex + 1, sellerIndex + 1).setValue(stamp);
  });
  return bootstrap_();
}

function settleSupply_(id) {
  if (!id) throw new Error("Invalid supply reimbursement.");
  withLock_(function () {
    ensureSheets_();
    const sheet = sheet_(SHEET_NAMES.supplies);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const idIndex = headers.indexOf("id");
    const paidIndex = headers.indexOf("paidAt");
    if (paidIndex < 0) throw new Error("The supply reimbursement column is missing from the sheet.");
    const rowIndex = values.findIndex(function (row, index) { return index > 0 && String(row[idIndex]) === String(id); });
    if (rowIndex < 1) throw new Error("Supply purchase not found.");
    const deletedIndex = headers.indexOf("deletedAt");
    if (deletedIndex >= 0 && values[rowIndex][deletedIndex]) throw new Error("Deleted supply purchases cannot be settled.");
    if (!values[rowIndex][paidIndex]) sheet.getRange(rowIndex + 1, paidIndex + 1).setValue(new Date().toISOString());
  });
  return bootstrap_();
}

function settlePayouts_(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("Select at least one unpaid payout.");
  if (items.length > 500) throw new Error("Select 500 payouts or fewer at a time.");
  var normalized = [];
  var seen = {};
  items.forEach(function (item) {
    var id = clean_(item && item.id, 120);
    var role = clean_(item && item.role, 20);
    if (!id || ["grower", "seller", "supply"].indexOf(role) === -1) throw new Error("Invalid payout selection.");
    var key = id + "::" + role;
    if (!seen[key]) {
      seen[key] = true;
      normalized.push({ id: id, role: role });
    }
  });
  withLock_(function () {
    ensureSheets_();
    var salesSheet = sheet_(SHEET_NAMES.sales);
    var suppliesSheet = sheet_(SHEET_NAMES.supplies);
    var salesValues = salesSheet.getDataRange().getValues();
    var supplyValues = suppliesSheet.getDataRange().getValues();
    var salesHeaders = salesValues[0].map(String);
    var supplyHeaders = supplyValues[0].map(String);
    var saleIdIndex = salesHeaders.indexOf("id");
    var growerIndex = salesHeaders.indexOf("growerPaidAt");
    var sellerIndex = salesHeaders.indexOf("sellerPaidAt");
    var deletedIndex = salesHeaders.indexOf("deletedAt");
    var supplyIdIndex = supplyHeaders.indexOf("id");
    var supplyPaidIndex = supplyHeaders.indexOf("paidAt");
    var supplyDeletedIndex = supplyHeaders.indexOf("deletedAt");
    if (supplyPaidIndex < 0) throw new Error("The supply reimbursement column is missing from the sheet.");
    var sales = {};
    var supplies = {};
    salesValues.slice(1).forEach(function (row, offset) {
      sales[String(row[saleIdIndex])] = { row: row, rowIndex: offset + 2 };
    });
    supplyValues.slice(1).forEach(function (row, offset) {
      supplies[String(row[supplyIdIndex])] = { row: row, rowIndex: offset + 2 };
    });
    var updates = [];
    normalized.forEach(function (item) {
      if (item.role === "supply") {
        var supply = supplies[item.id];
         if (!supply) throw new Error("One selected supply purchase no longer exists. Refresh and try again.");
         if (supplyDeletedIndex >= 0 && supply.row[supplyDeletedIndex]) throw new Error("Deleted supply purchases cannot be settled.");
        if (!supply.row[supplyPaidIndex]) updates.push({ sheet: suppliesSheet, rowIndex: supply.rowIndex, column: supplyPaidIndex + 1 });
        return;
      }
      var sale = sales[item.id];
      if (!sale) throw new Error("One selected sale no longer exists. Refresh and try again.");
      if (deletedIndex >= 0 && sale.row[deletedIndex]) throw new Error("Deleted sales cannot be settled.");
      var index = item.role === "grower" ? growerIndex : sellerIndex;
      if (index < 0) throw new Error("The payout columns are missing from the sales sheet.");
      if (!sale.row[index]) updates.push({ sheet: salesSheet, rowIndex: sale.rowIndex, column: index + 1 });
    });
    var stamp = new Date().toISOString();
    updates.forEach(function (update) { update.sheet.getRange(update.rowIndex, update.column).setValue(stamp); });
  });
  return bootstrap_();
}

function reopenPayout_(id, role, reason) {
  if (!id || ["grower", "seller", "supply", "both"].indexOf(role) === -1) throw new Error("Invalid payout correction.");
  reason = clean_(reason, 240);
  if (!reason) throw new Error("Add a short reason for reopening the payout.");
  withLock_(function () {
    if (role === "supply") {
      const locatedSupply = findObjectRow_(SHEET_NAMES.supplies, id);
      const beforeSupply = normalizeSupply_(locatedSupply.object);
      if (beforeSupply.deletedAt) throw new Error("Deleted supply purchases cannot have reimbursements reopened.");
      const afterSupply = Object.assign({}, beforeSupply, { paidAt: "" });
      writeObjectRow_(SHEET_NAMES.supplies, locatedSupply.rowNumber, afterSupply);
      logCorrection_("supply", id, "reopen", beforeSupply, afterSupply, reason);
      return;
    }
    const located = findObjectRow_(SHEET_NAMES.sales, id);
    const before = normalizeSale_(located.object);
    if (before.deletedAt) throw new Error("Deleted sales cannot have payouts reopened.");
    const after = Object.assign({}, before);
    if (role === "grower" || role === "both") after.growerPaidAt = "";
    if (role === "seller" || role === "both") after.sellerPaidAt = "";
    writeObjectRow_(SHEET_NAMES.sales, located.rowNumber, after);
    logCorrection_("payout", id, "reopen", before, after, reason);
  });
  return bootstrap_();
}

function upsertConfig_(kind, name, price) {
  if (["member", "strain"].indexOf(kind) === -1) throw new Error("Invalid config type.");
  name = clean_(name, 80);
  if (!name) throw new Error("A name is required.");
  withLock_(function () {
    const sheet = sheet_(SHEET_NAMES.config);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const kindIndex = headers.indexOf("kind");
    const nameIndex = headers.indexOf("name");
    const priceIndex = headers.indexOf("price");
    const activeIndex = headers.indexOf("active");
    const rowIndex = values.findIndex(function (row, index) {
      return index > 0 && String(row[kindIndex]).toLowerCase() === kind && String(row[nameIndex]).toLowerCase() === name.toLowerCase();
    });
    if (rowIndex > 0) {
      sheet.getRange(rowIndex + 1, priceIndex + 1).setValue(kind === "strain" ? Math.max(0, number_(price)) : "");
      sheet.getRange(rowIndex + 1, activeIndex + 1).setValue(true);
    } else {
      sheet.appendRow([kind, name, kind === "strain" ? Math.max(0, number_(price)) : "", true]);
    }
  });
  return bootstrap_();
}

function removeConfig_(kind, name) {
  withLock_(function () {
    const sheet = sheet_(SHEET_NAMES.config);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const kindIndex = headers.indexOf("kind");
    const nameIndex = headers.indexOf("name");
    const activeIndex = headers.indexOf("active");
    const rowIndex = values.findIndex(function (row, index) {
      return index > 0 && String(row[kindIndex]) === String(kind) && String(row[nameIndex]) === String(name);
    });
    if (rowIndex < 1) throw new Error("Config item not found.");
    sheet.getRange(rowIndex + 1, activeIndex + 1).setValue(false);
  });
  return bootstrap_();
}

function rolloverWeek_(label) {
  withLock_(function () {
    const sheet = sheet_(SHEET_NAMES.weeks);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(String);
    const statusIndex = headers.indexOf("status");
    const closedIndex = headers.indexOf("closedAt");
    const activeIndex = values.findIndex(function (row, index) { return index > 0 && String(row[statusIndex]).toLowerCase() === "active"; });
    const stamp = new Date().toISOString();
    if (activeIndex > 0) {
      sheet.getRange(activeIndex + 1, statusIndex + 1).setValue("closed");
      sheet.getRange(activeIndex + 1, closedIndex + 1).setValue(stamp);
    }
    const cleanLabel = clean_(label, 80) || "Week of " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, yyyy");
    sheet.appendRow(["week-" + Utilities.getUuid(), cleanLabel, stamp, "", "active", stamp]);
  });
  return bootstrap_();
}

function activeWeek_() {
  const weeks = readObjects_(SHEET_NAMES.weeks);
  const active = weeks.filter(function (week) { return String(week.status).toLowerCase() === "active"; }).pop();
  if (active) return active;
  const stamp = new Date().toISOString();
  const week = { id: "week-" + Utilities.getUuid(), label: "Week of " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, yyyy"), startedAt: stamp, closedAt: "", status: "active", createdAt: stamp };
  appendObject_(SHEET_NAMES.weeks, HEADERS.weeks, week);
  return week;
}

function availableBoxes_(grower, strain) {
  const grownTrimmings = readActiveObjects_(SHEET_NAMES.grows).filter(function (row) {
    return String(row.grower) === String(grower) && String(row.strain) === String(strain);
  }).reduce(function (sum, row) { return sum + trimmingsForGrow_(row); }, 0);
  const soldTrimmings = readActiveObjects_(SHEET_NAMES.sales).filter(function (row) {
    return String(row.grower) === String(grower) && String(row.strain) === String(strain);
  }).reduce(function (sum, row) { return sum + number_(row.boxes) * TRIMMINGS_PER_BOX; }, 0);
  return Math.max(0, Math.floor((grownTrimmings - soldTrimmings + 0.0001) / TRIMMINGS_PER_BOX));
}

function outstandingSupplies_() {
  const purchased = readActiveObjects_(SHEET_NAMES.supplies).reduce(function (sum, row) {
    return sum + number_(row.total || number_(row.quantity) * number_(row.unitCost));
  }, 0);
  const recovered = readActiveObjects_(SHEET_NAMES.sales).reduce(function (sum, row) {
    return sum + number_(row.supplyDeduction);
  }, 0);
  return Math.max(0, round_(purchased - recovered));
}

function outstandingSuppliesExcludingSale_(saleId) {
  const purchased = readActiveObjects_(SHEET_NAMES.supplies).reduce(function (sum, row) {
    return sum + number_(row.total || number_(row.quantity) * number_(row.unitCost));
  }, 0);
  const recovered = readActiveObjects_(SHEET_NAMES.sales).reduce(function (sum, row) {
    return String(row.id) === String(saleId) ? sum : sum + number_(row.supplyDeduction);
  }, 0);
  return Math.max(0, round_(purchased - recovered));
}

function assertInventoryValid_(grows, sales) {
  const lots = {};
  grows.forEach(function (row) {
    const key = String(row.grower) + "|||" + String(row.strain);
    lots[key] = number_(lots[key]) + trimmingsForGrow_(row);
  });
  sales.forEach(function (row) {
    const key = String(row.grower) + "|||" + String(row.strain);
    lots[key] = number_(lots[key]) - number_(row.boxes) * TRIMMINGS_PER_BOX;
  });
  Object.keys(lots).forEach(function (key) {
    if (lots[key] < -0.0001) {
      const parts = key.split("|||");
      throw new Error("That correction would oversell " + parts[0] + "'s " + parts[1] + " inventory.");
    }
  });
}

function findObjectRow_(name, id) {
  const sheet = sheet_(name);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idIndex = headers.indexOf("id");
  const rowIndex = values.findIndex(function (row, index) { return index > 0 && String(row[idIndex]) === String(id); });
  if (rowIndex < 1) throw new Error("Record not found.");
  const object = headers.reduce(function (result, header, index) {
    result[header] = values[rowIndex][index] instanceof Date ? values[rowIndex][index].toISOString() : values[rowIndex][index];
    return result;
  }, {});
  return { rowNumber: rowIndex + 1, object: object };
}

function writeObjectRow_(name, rowNumber, object) {
  const sheet = sheet_(name);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([headers.map(function (header) {
    return object[header] === undefined ? "" : object[header];
  })]);
}

function logCorrection_(recordType, recordId, action, before, after, reason) {
  const stamp = new Date().toISOString();
  appendObject_(SHEET_NAMES.corrections, HEADERS.corrections, {
    id: Utilities.getUuid(),
    timestamp: stamp,
    recordType: recordType,
    recordId: recordId,
    action: action,
    beforeJson: JSON.stringify(before),
    afterJson: JSON.stringify(after),
    reason: reason,
    createdAt: stamp
  });
}

function ensureSheets_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_NAMES).forEach(function (key) {
    let sheet = book.getSheetByName(SHEET_NAMES[key]);
    if (!sheet) sheet = book.insertSheet(SHEET_NAMES[key]);
    const headers = HEADERS[key];
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
    if (current.join("") === "") {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#173c17").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, headers.length);
    } else {
      const missing = headers.filter(function (header) { return current.indexOf(header) === -1; });
      if (missing.length) {
        const start = current.length + 1;
        sheet.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight("bold").setBackground("#173c17").setFontColor("#ffffff");
        sheet.autoResizeColumns(start, missing.length);
      }
    }
  });
}

function seedConfig_() {
  const sheet = sheet_(SHEET_NAMES.config);
  if (sheet.getLastRow() > 1) return;
  const members = ["Smabbles", "Jack", "Dottie", "Grace", "MJ", "Dante", "Clicky", "Vince", "Bubbles", "Hunii", "Rage", "Marr", "Mazy", "SHMO", "Trashman", "Lottie", "Giggles", "JuggsMcNuggs"];
  const strains = [["9 Pound Hammer",450],["Alaskan Thunderfuck",450],["Alien OG",450],["Black Diamond",525],["Blue Diesel",469],["Blueberry",431],["Blueberry Diesel",431],["Charlotte's Web",450],["Chemdawg",469],["Chem Wreck",544],["Cherry AK-47",431],["Cherry Bomb",431],["Cherry Pie",506],["Chernobyl",450],["Chocolate Thai",431],["Cinex",431],["Cotton Candy",431],["Dr. Grinspoon",469],["El Chapo",600],["Forbidden Fruit",431],["Girl Scout Cookies",488],["Golden Goat",469],["Gorilla Glue",450],["Grape Ape",431],["Harlequin",431],["Hawaiian Snow",488],["Headband",431],["Heavy Duty Fruity",488],["Hindu Kush",600],["J1",506],["Jedi Kush",450],["Kimbo Kush",450],["King Louis XIII",431],["Kosher Kush",450],["Kryptonite",431],["Lamb's Bread",638],["Lemon Kush",488],["Lemon Meringue",431],["Lemon Sour Diesel",431],["Lucky Charms",488],["Mango Haze",450],["Northern Lights",450],["Orange Cookies",506],["Pink Cookies",488],["Pink Lemonade",488],["Pineapple Express",525],["Purple Diesel",431],["Purple Haze",544],["Romulan",469],["Sage N Sour",431],["Shark Shock",431],["Skywalker OG",431],["Sour Diesel",450],["Strawberry Cough",581],["Strawberry Diesel",431],["Sweet Tooth",488],["Tahoe Alien",431],["Tahoe OG Kush",469],["Tangie",431],["Trainwreck Haze",431],["Uncle Andy",806],["Vanilla Frosting",450],["Vanilla Kush",431],["Violator Kush",431],["Wedding Cake",431],["Wedding Crasher",544],["Yoda OG",488],["Zkittlez",656]];
  const rows = members.map(function (name) { return ["member", name, "", true]; }).concat(strains.map(function (row) { return ["strain", row[0], row[1], true]; }));
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
}

function readObjects_(name) {
  const sheet = sheet_(name);
  if (sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(String);
  return values.filter(function (row) {
    return row.some(function (cell) { return cell !== ""; });
  }).map(function (row) {
    return headers.reduce(function (object, header, index) {
      object[header] = row[index] instanceof Date ? row[index].toISOString() : row[index];
      return object;
    }, {});
  });
}

function readActiveObjects_(name) {
  return readObjects_(name).filter(function (row) { return !row.deletedAt; });
}

function appendObject_(name, headers, object) {
  const sheet = sheet_(name);
  const actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(actualHeaders.map(function (header) { return object[header] === undefined ? "" : object[header]; }));
}
function trimmingsForGrow_(row) {
  return number_(row.trimmings) || number_(row.boxes) * TRIMMINGS_PER_BOX;
}
function normalizeGrow_(row) {
  row.trimmings = trimmingsForGrow_(row);
  row.unitPrice = number_(row.unitPrice);
  return row;
}
function normalizeSupply_(row) {
  row.quantity = number_(row.quantity);
  row.unitCost = number_(row.unitCost);
  row.total = number_(row.total) || round_(row.quantity * row.unitCost);
  return row;
}
function normalizeSale_(row) {
  ["boxes", "unitPrice", "gross", "supplyDeduction", "growerPayout", "gangPayout", "sellerPayout"].forEach(function (key) { row[key] = number_(row[key]); });
  return row;
}
function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("Missing sheet: " + name);
  return sheet;
}
function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return callback(); } finally { lock.releaseLock(); }
}
function assertAccess_(code) {
  const expected = PropertiesService.getScriptProperties().getProperty("ACCESS_CODE");
  if (!expected) throw new Error("Tracker setup is incomplete.");
  if (String(code || "") !== expected) throw new Error("Access code denied.");
}
function assertAdmin_(code) {
  const expected = PropertiesService.getScriptProperties().getProperty("ADMIN_CODE");
  if (!expected) throw new Error("Manager access is not configured.");
  if (String(code || "") !== expected) throw new Error("Manager password denied.");
}
function validateRequired_(record, fields) {
  fields.forEach(function (field) {
    if (record[field] === undefined || record[field] === null || record[field] === "") throw new Error("Missing required field: " + field);
  });
}
function clean_(value, limit) { return String(value || "").trim().slice(0, limit || 200); }
function number_(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function round_(value) { return Math.round((number_(value) + Number.EPSILON) * 100) / 100; }
function truthy_(value) { return value === true || String(value).toLowerCase() === "true" || value === 1; }
function safeDate_(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) throw new Error("Invalid date.");
  return date.toISOString();
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

