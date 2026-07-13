(() => {
  "use strict";

  const config = window.TRACKER_CONFIG || {};
  const state = { members: [], strains: [], grows: [], sales: [], weeks: [], activeWeek: null, accessCode: sessionStorage.getItem("ct_access") || "", busy: false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: config.CURRENCY || "USD", maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "2-digit", hour: "numeric", minute: "2-digit" });
  let toastTimer;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  function num(value) { return Number(value) || 0; }
  function rounded(value) { return Math.round((num(value) + Number.EPSILON) * 100) / 100; }
  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : dateTime.format(date);
  }
  function nowInput() {
    const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return date.toISOString().slice(0, 16);
  }
  function splitSale(boxes, price) {
    const gross = rounded(num(boxes) * num(price));
    const grower = rounded(gross * 0.7);
    const gang = rounded(gross * 0.15);
    return { gross: gross, grower: grower, gang: gang, seller: rounded(gross - grower - gang) };
  }
  function toast(message) {
    const element = $("[data-toast]");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { element.classList.remove("show"); }, 2800);
  }
  function setSync(status, label) {
    const holder = $(".storage-status");
    holder.classList.toggle("synced", status === "synced");
    holder.classList.toggle("error", status === "error");
    $("[data-sync-label]").textContent = label;
  }
  async function request(action, payload) {
    if (!config.API_URL) throw new Error("The Google Sheet backend has not been connected yet.");
    const body = Object.assign({ action: action, accessCode: state.accessCode }, payload || {});
    const response = await fetch(config.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow"
    });
    if (!response.ok) throw new Error("The sheet service could not be reached.");
    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "The sheet rejected this request.");
    return result;
  }
  function applyData(data) {
    state.members = data.members || [];
    state.strains = data.strains || [];
    state.grows = data.grows || [];
    state.sales = data.sales || [];
    state.weeks = data.weeks || [];
    state.activeWeek = data.activeWeek || null;
  }
  async function loadData(showNotice) {
    if (state.busy) return;
    state.busy = true;
    setSync("loading", "Syncing shared sheet…");
    try {
      const result = await request("bootstrap");
      applyData(result.data);
      setSync("synced", "Shared sheet synced");
      renderAll();
      closeAccess();
      if (showNotice) toast("Latest sheet data loaded.");
    } catch (error) {
      setSync("error", "Sheet connection failed");
      if (/access|code|denied/i.test(error.message)) {
        sessionStorage.removeItem("ct_access");
        state.accessCode = "";
      }
      openAccess(error.message);
      throw error;
    } finally {
      state.busy = false;
    }
  }
  function openAccess(message) {
    const dialog = $("[data-access-dialog]");
    $("[data-access-error]").textContent = message || "";
    if (!dialog.open) dialog.showModal();
  }
  function closeAccess() {
    const dialog = $("[data-access-dialog]");
    if (dialog.open) dialog.close();
    $("[data-access-error]").textContent = "";
  }
  function inventoryRows() {
    const rows = new Map();
    state.grows.forEach(function (grow) {
      const key = grow.grower + "|||" + grow.strain;
      const row = rows.get(key) || { grower: grow.grower, strain: grow.strain, boxes: 0, price: num(grow.unitPrice) };
      row.boxes += num(grow.boxes);
      row.price = num(grow.unitPrice) || row.price;
      rows.set(key, row);
    });
    state.sales.forEach(function (sale) {
      const key = sale.grower + "|||" + sale.strain;
      const row = rows.get(key) || { grower: sale.grower, strain: sale.strain, boxes: 0, price: num(sale.unitPrice) };
      row.boxes -= num(sale.boxes);
      rows.set(key, row);
    });
    return Array.from(rows.values()).filter(function (row) { return row.boxes > 0.0001; }).sort(function (a, b) { return b.boxes - a.boxes; });
  }
  function payoutSummary() {
    const people = new Map();
    let gangTotal = 0;
    state.sales.forEach(function (sale) {
      gangTotal += num(sale.gangPayout);
      if (!sale.growerPaidAt) {
        const row = people.get(sale.grower) || { name: sale.grower, grower: 0, seller: 0 };
        row.grower += num(sale.growerPayout);
        people.set(sale.grower, row);
      }
      if (!sale.sellerPaidAt) {
        const row = people.get(sale.seller) || { name: sale.seller, grower: 0, seller: 0 };
        row.seller += num(sale.sellerPayout);
        people.set(sale.seller, row);
      }
    });
    const list = Array.from(people.values()).map(function (row) {
      row.total = row.grower + row.seller;
      return row;
    }).sort(function (a, b) { return b.total - a.total; });
    return { people: list, gangTotal: gangTotal };
  }
  function memberStatements() {
    const people = new Map();
    state.sales.forEach(function (sale) {
      const grower = people.get(sale.grower) || { name: sale.grower, earned: 0, paid: 0, due: 0 };
      grower.earned += num(sale.growerPayout);
      if (sale.growerPaidAt) grower.paid += num(sale.growerPayout); else grower.due += num(sale.growerPayout);
      people.set(sale.grower, grower);
      const seller = people.get(sale.seller) || { name: sale.seller, earned: 0, paid: 0, due: 0 };
      seller.earned += num(sale.sellerPayout);
      if (sale.sellerPaidAt) seller.paid += num(sale.sellerPayout); else seller.due += num(sale.sellerPayout);
      people.set(sale.seller, seller);
    });
    return Array.from(people.values()).sort(function (a, b) { return b.due - a.due || b.earned - a.earned; });
  }
  function ledgerRows() {
    return state.grows.map(function (row) { return Object.assign({ type: "grow" }, row); })
      .concat(state.sales.map(function (row) { return Object.assign({ type: "sale" }, row); }))
      .sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  }
  function metric(label, value, detail) {
    return '<article class="metric"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(detail || "") + '</small></article>';
  }
  function empty(message) { return '<div class="empty">' + esc(message) + "</div>"; }
  function table(headers, rows) {
    const head = headers.map(function (value, index) {
      return "<th" + (index >= headers.length - 2 ? ' class="num"' : "") + ">" + esc(value) + "</th>";
    }).join("");
    const body = rows.map(function (cells) {
      return "<tr>" + cells.map(function (cell) {
        if (cell && typeof cell === "object") return "<td" + (cell.num ? ' class="num"' : "") + ">" + (cell.raw ? cell.value : esc(cell.value)) + "</td>";
        return "<td>" + cell + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return '<div class="table-wrap"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }
  function activityHtml(row) {
    const grow = row.type === "grow";
    const text = grow
      ? esc(row.grower) + " logged " + number.format(row.boxes) + " boxes of " + esc(row.strain)
      : esc(row.seller) + " sold " + number.format(row.boxes) + " boxes of " + esc(row.strain);
    return '<div class="activity ' + row.type + '"><span class="activity-badge">' + (grow ? "+" : "$") + "</span><div><strong>" + text + "</strong><small>" + esc(formatDate(row.timestamp)) + "</small></div><b>" + (grow ? "+" + number.format(row.boxes) : money.format(row.gross)) + "</b></div>";
  }
  function renderDashboard() {
    const inventory = inventoryRows();
    const payouts = payoutSummary();
    const currentSales = state.sales.filter(function (sale) { return !state.activeWeek || sale.weekId === state.activeWeek.id; });
    const currentGrows = state.grows.filter(function (grow) { return !state.activeWeek || grow.weekId === state.activeWeek.id; });
    const stock = inventory.reduce(function (sum, row) { return sum + row.boxes; }, 0);
    const gross = currentSales.reduce(function (sum, sale) { return sum + num(sale.gross); }, 0);
    const grown = currentGrows.reduce(function (sum, grow) { return sum + num(grow.boxes); }, 0);
    const owed = payouts.people.reduce(function (sum, person) { return sum + person.total; }, 0);
    $("#dashboardMetrics").innerHTML = [
      metric("Boxes on shelves", number.format(stock), "Carries forward across weeks"),
      metric("Grown this week", number.format(grown), currentGrows.length + " grow entries"),
      metric("Sales this week", money.format(gross), currentSales.length + " recorded sales"),
      metric("Member payouts due", money.format(owed), payouts.people.length + " members owed"),
    ].join("");
    $("#inventoryTable").innerHTML = inventory.length ? table(
      ["Grower", "Strain", "Boxes", "Reference value"],
      inventory.slice(0, 10).map(function (row) {
        return [esc(row.grower), esc(row.strain), { value: number.format(row.boxes), num: true }, { value: money.format(row.price), num: true }];
      })
    ) : empty("No stock yet. Log the first grow to begin.");
    $("#dashboardPayouts").innerHTML = payouts.people.length ? payouts.people.slice(0, 6).map(function (person) {
      const max = payouts.people[0].total || 1;
      return '<div class="payout-row"><span>' + esc(person.name) + "</span><strong>" + money.format(person.total) + '</strong><div class="progress"><i style="width:' + Math.max(4, person.total / max * 100) + '%"></i></div></div>';
    }).join("") : empty("No open member payouts.");
    const recent = ledgerRows().slice(0, 7);
    $("#recentActivity").innerHTML = recent.length ? recent.map(activityHtml).join("") : empty("Activity will appear here after the first grow or sale.");
  }
  function queueActions(sale) {
    const buttons = [];
    if (!sale.growerPaidAt) buttons.push('<button class="mini-button" data-settle="' + esc(sale.id) + '" data-role="grower">Pay grower</button>');
    if (!sale.sellerPaidAt) buttons.push('<button class="mini-button" data-settle="' + esc(sale.id) + '" data-role="seller">Pay seller</button>');
    if (!sale.growerPaidAt && !sale.sellerPaidAt) buttons.push('<button class="mini-button" data-settle="' + esc(sale.id) + '" data-role="both">Pay both</button>');
    return '<div class="queue-actions">' + buttons.join("") + "</div>";
  }
  function renderPayouts() {
    const summary = payoutSummary();
    const statements = memberStatements();
    const growerOwed = summary.people.reduce(function (sum, row) { return sum + row.grower; }, 0);
    const sellerOwed = summary.people.reduce(function (sum, row) { return sum + row.seller; }, 0);
    $("#payoutMetrics").innerHTML = [
      metric("Growers owed", money.format(growerOwed), "70% shares not marked paid"),
      metric("Sellers owed", money.format(sellerOwed), "15% shares not marked paid"),
      metric("Total member queue", money.format(growerOwed + sellerOwed), summary.people.length + " members"),
      metric("Gang share", money.format(summary.gangTotal), "15% retained by the gang")
    ].join("");
    $("#memberPayouts").innerHTML = statements.length ? table(
      ["Member", "Total earned", "Paid out", "Remaining due"],
      statements.map(function (row) {
        return [esc(row.name), { value: money.format(row.earned), num: true }, { value: money.format(row.paid), num: true }, { value: "<strong>" + money.format(row.due) + "</strong>", num: true, raw: true }];
      })
    ) : empty("Everyone is settled.");
    const unsettled = state.sales.filter(function (sale) { return !sale.growerPaidAt || !sale.sellerPaidAt; }).sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    $("#payoutQueue").innerHTML = unsettled.length ? table(
      ["Sale", "Grower share", "Seller share", "Settle"],
      unsettled.map(function (sale) {
        return [
          "<strong>" + esc(sale.strain) + "</strong><small>" + esc(formatDate(sale.timestamp)) + " · " + number.format(sale.boxes) + " boxes</small>",
          sale.growerPaidAt ? '<span class="paid">Paid ' + esc(sale.grower) + "</span>" : esc(sale.grower) + " · " + money.format(sale.growerPayout),
          sale.sellerPaidAt ? '<span class="paid">Paid ' + esc(sale.seller) + "</span>" : esc(sale.seller) + " · " + money.format(sale.sellerPayout),
          { value: queueActions(sale), raw: true, num: true }
        ];
      })
    ) : empty("No unsettled sales.");
  }
  function renderLedger() {
    const query = $("#ledgerSearch").value.trim().toLowerCase();
    const type = $("#ledgerType").value;
    const week = $("#ledgerWeek").value;
    const rows = ledgerRows().filter(function (row) {
      const text = [row.grower, row.seller, row.strain, row.reference, row.notes].join(" ").toLowerCase();
      return (type === "all" || row.type === type) && (week === "all" || row.weekId === week) && (!query || text.includes(query));
    });
    $("#ledgerTable").innerHTML = rows.length ? table(
      ["When", "Type", "Member / source", "Strain", "Boxes", "Value"],
      rows.map(function (row) {
        return [
          esc(formatDate(row.timestamp)),
          row.type === "grow" ? '<span class="paid">Grow</span>' : "Sale",
          row.type === "grow" ? esc(row.grower) : "<strong>" + esc(row.seller) + "</strong><small>Stock: " + esc(row.grower) + "</small>",
          esc(row.strain),
          { value: number.format(row.boxes), num: true },
          { value: row.type === "grow" ? money.format(num(row.boxes) * num(row.unitPrice)) : money.format(row.gross), num: true }
        ];
      })
    ) : empty("No ledger records match that filter.");
  }
  function renderSettings() {
    $("#memberList").innerHTML = state.members.map(function (name) {
      return '<span class="chip">' + esc(name) + '<button type="button" aria-label="Remove ' + esc(name) + '" data-remove-member="' + esc(name) + '">×</button></span>';
    }).join("");
    $("#strainList").innerHTML = state.strains.map(function (strain) {
      return '<div class="strain-item"><span>' + esc(strain.name) + "</span><strong>" + money.format(strain.price) + '</strong><button type="button" aria-label="Remove ' + esc(strain.name) + '" data-remove-strain="' + esc(strain.name) + '">×</button></div>';
    }).join("");
  }
  function renderInventoryStrains() {
    const grower = $("[data-inventory-growers]").value;
    const rows = inventoryRows().filter(function (row) { return row.grower === grower; });
    const select = $("[data-inventory-strains]");
    const current = select.value;
    select.innerHTML = '<option value="">Choose available stock</option>' + rows.map(function (row) {
      return '<option value="' + esc(row.strain) + '" data-stock="' + row.boxes + '" data-price="' + row.price + '">' + esc(row.strain) + " · " + number.format(row.boxes) + " boxes</option>";
    }).join("");
    if (rows.some(function (row) { return row.strain === current; })) select.value = current;
    updateStockHint();
  }
  function updateStockHint() {
    const option = $("[data-inventory-strains]").selectedOptions[0];
    const stock = num(option && option.dataset.stock);
    $("[data-available-stock]").textContent = stock ? number.format(stock) + " boxes available from this grower." : "Choose a grower and strain to see stock.";
  }
  function renderSelects() {
    const memberOptions = state.members.map(function (name) { return '<option value="' + esc(name) + '">' + esc(name) + "</option>"; }).join("");
    $$("[data-members]").forEach(function (select) {
      const current = select.value;
      select.innerHTML = '<option value="">Choose a member</option>' + memberOptions;
      if (state.members.includes(current)) select.value = current;
    });
    const strainOptions = state.strains.map(function (strain) { return '<option value="' + esc(strain.name) + '" data-price="' + num(strain.price) + '">' + esc(strain.name) + "</option>"; }).join("");
    $$("[data-strains]").forEach(function (select) {
      const current = select.value;
      select.innerHTML = '<option value="">Choose a strain</option>' + strainOptions;
      if (state.strains.some(function (strain) { return strain.name === current; })) select.value = current;
    });
    const growers = Array.from(new Set(inventoryRows().map(function (row) { return row.grower; }))).sort();
    const growerSelect = $("[data-inventory-growers]");
    const current = growerSelect.value;
    growerSelect.innerHTML = '<option value="">Choose a grower</option>' + growers.map(function (name) { return '<option value="' + esc(name) + '">' + esc(name) + "</option>"; }).join("");
    if (growers.includes(current)) growerSelect.value = current;
    renderInventoryStrains();
  }
  function renderAll() {
    renderDashboard();
    renderPayouts();
    renderLedger();
    renderSettings();
    renderSelects();
    renderWeeks();
    $$("[data-sheet-link]").forEach(function (link) { link.href = config.SHEET_URL; });
  }
  function renderWeeks() {
    $("[data-active-week]").textContent = state.activeWeek ? state.activeWeek.label : "No active week";
    const currentSales = state.sales.filter(function (sale) { return state.activeWeek && sale.weekId === state.activeWeek.id; });
    $("[data-week-summary]").textContent = currentSales.length + " sales this week · shelf stock and unpaid balances roll forward";
    const select = $("#ledgerWeek");
    const current = select.value;
    select.innerHTML = '<option value="all">All weeks</option>' + state.weeks.slice().reverse().map(function (week) {
      return '<option value="' + esc(week.id) + '">' + esc(week.label) + (week.status === "active" ? " · active" : "") + "</option>";
    }).join("");
    if (state.weeks.some(function (week) { return week.id === current; })) select.value = current;
  }
  function showView(name, updateHash) {
    $$("[data-view-panel]").forEach(function (panel) {
      panel.hidden = panel.dataset.viewPanel !== name;
      panel.classList.toggle("active", panel.dataset.viewPanel === name);
    });
    $$("[data-view]").forEach(function (button) {
      button.setAttribute("aria-current", button.dataset.view === name ? "page" : "false");
    });
    if (updateHash !== false) history.replaceState(null, "", "#" + name);
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  async function mutate(action, payload, successMessage) {
    if (state.busy) return false;
    state.busy = true;
    $$("button[type=submit]").forEach(function (button) { button.disabled = true; });
    setSync("loading", "Saving to shared sheet…");
    try {
      const result = await request(action, payload);
      applyData(result.data);
      setSync("synced", "Shared sheet synced");
      renderAll();
      toast(successMessage);
      return true;
    } catch (error) {
      setSync("error", "Save failed");
      toast(error.message);
      return false;
    } finally {
      state.busy = false;
      $$("button[type=submit]").forEach(function (button) { button.disabled = false; });
    }
  }
  function updateSalePreview() {
    const form = $("#saleForm");
    const split = splitSale(form.boxes.value, form.price.value);
    $("[data-preview-gross]").textContent = money.format(split.gross);
    $("[data-preview-grower]").textContent = money.format(split.grower);
    $("[data-preview-gang]").textContent = money.format(split.gang);
    $("[data-preview-seller]").textContent = money.format(split.seller);
  }
  function download(filename, blob) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }
  function csvDownload(filename, rows) {
    const csv = rows.map(function (row) {
      return row.map(function (cell) { return '"' + String(cell == null ? "" : cell).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    download(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
  }
  function exportData(type) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (type === "backup") {
      const audit = { exportedAt: new Date().toISOString(), members: state.members, strains: state.strains, grows: state.grows, sales: state.sales };
      download("clown-tent-audit-" + stamp + ".json", new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" }));
      return;
    }
    if (type === "payouts") {
      csvDownload("clown-tent-payouts-" + stamp + ".csv", [["Member", "Grower due", "Seller due", "Total due"]].concat(payoutSummary().people.map(function (row) { return [row.name, row.grower, row.seller, row.total]; })));
      return;
    }
    csvDownload("clown-tent-ledger-" + stamp + ".csv", [["Date", "Type", "Grower", "Seller", "Strain", "Boxes", "Price per box", "Gross", "Grower payout", "Gang payout", "Seller payout", "Reference / notes"]].concat(ledgerRows().map(function (row) {
      return [row.timestamp, row.type, row.grower, row.seller || "", row.strain, row.boxes, row.unitPrice, row.gross || "", row.growerPayout || "", row.gangPayout || "", row.sellerPayout || "", row.reference || row.notes || ""];
    })));
  }

  $("#accessForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("accessCode") || "").trim();
    if (!code) return;
    state.accessCode = code;
    sessionStorage.setItem("ct_access", code);
    try { await loadData(); } catch (_) {}
  });
  $("#growForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const ok = await mutate("addGrow", { record: { timestamp: data.date, grower: data.grower, strain: data.strain, boxes: num(data.boxes), unitPrice: num(data.price), notes: data.notes } }, "Grow added to shared inventory.");
    if (ok) { form.reset(); form.date.value = nowInput(); }
  });
  $("#saleForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const lot = inventoryRows().find(function (row) { return row.grower === data.grower && row.strain === data.strain; });
    const available = lot ? lot.boxes : 0;
    if (num(data.boxes) > available) { toast("Only " + number.format(available) + " boxes are available for that lot."); return; }
    const ok = await mutate("addSale", { record: { timestamp: data.date, seller: data.seller, grower: data.grower, strain: data.strain, boxes: num(data.boxes), unitPrice: num(data.price), reference: data.reference } }, "Sale recorded and payout split created.");
    if (ok) { form.reset(); form.date.value = nowInput(); updateSalePreview(); showView("payouts"); }
  });
  $("#memberForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") || "").trim();
    if (await mutate("upsertConfig", { kind: "member", name: name }, name + " added to the roster.")) form.reset();
  });
  $("#strainForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const name = String(data.name || "").trim();
    if (await mutate("upsertConfig", { kind: "strain", name: name, price: num(data.price) }, name + " added to the product list.")) form.reset();
  });
  document.addEventListener("click", async function (event) {
    const viewButton = event.target.closest("[data-view], [data-go]");
    if (viewButton) showView(viewButton.dataset.view || viewButton.dataset.go);
    const actionElement = event.target.closest("[data-action]");
    const action = actionElement && actionElement.dataset.action;
    if (action === "refresh") { try { await loadData(true); } catch (_) {} }
    if (action === "sign-out") { sessionStorage.removeItem("ct_access"); state.accessCode = ""; openAccess("Tracker locked."); }
    if (action === "rollover-week") {
      const suggested = "Week of " + new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date());
      const label = prompt("Name the new tracking week. Shelf stock and unpaid balances will carry forward.", suggested);
      if (label && confirm("Close " + (state.activeWeek ? state.activeWeek.label : "the current week") + " and start " + label + "? No inventory or payout history will be deleted.")) {
        await mutate("rolloverWeek", { label: label }, "New tracking week started. Stock and balances carried forward.");
      }
    }
    const settle = event.target.closest("[data-settle]");
    if (settle) await mutate("settleSale", { id: settle.dataset.settle, role: settle.dataset.role }, "Payout status updated.");
    const removeMemberElement = event.target.closest("[data-remove-member]");
    const removeMember = removeMemberElement && removeMemberElement.dataset.removeMember;
    if (removeMember && confirm("Remove " + removeMember + " from future forms? Existing records stay intact.")) await mutate("removeConfig", { kind: "member", name: removeMember }, "Member removed.");
    const removeStrainElement = event.target.closest("[data-remove-strain]");
    const removeStrain = removeStrainElement && removeStrainElement.dataset.removeStrain;
    if (removeStrain && confirm("Remove " + removeStrain + " from future forms? Existing records stay intact.")) await mutate("removeConfig", { kind: "strain", name: removeStrain }, "Strain removed.");
    const exportElement = event.target.closest("[data-export]");
    if (exportElement) exportData(exportElement.dataset.export);
  });
  $("[data-inventory-growers]").addEventListener("change", renderInventoryStrains);
  $("[data-inventory-strains]").addEventListener("change", function () {
    const option = $("[data-inventory-strains]").selectedOptions[0];
    $("#saleForm").price.value = option && option.dataset.price || "";
    updateStockHint();
    updateSalePreview();
  });
  $("[data-strains]").addEventListener("change", function (event) {
    $("#growForm").price.value = event.target.selectedOptions[0] && event.target.selectedOptions[0].dataset.price || "";
  });
  $("#saleForm").addEventListener("input", updateSalePreview);
  $("#ledgerSearch").addEventListener("input", renderLedger);
  $("#ledgerType").addEventListener("change", renderLedger);
  $("#ledgerWeek").addEventListener("change", renderLedger);

  $("#growForm").date.value = nowInput();
  $("#saleForm").date.value = nowInput();
  const initialView = location.hash.slice(1);
  showView($('[data-view="' + initialView + '"]') ? initialView : "dashboard", false);
  if (state.accessCode) loadData().catch(function () {});
  else openAccess(config.API_URL ? "" : "The sheet connection is being finished. The interface is ready.");
})();
