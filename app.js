(() => {
  "use strict";

  const config = window.TRACKER_CONFIG || {};
  const TRIMMINGS_PER_BOX = 15;
  const PAYOUT_RATES = Object.freeze({ grower: 0.70, gang: 0.15, seller: 0.15 });
  const state = { members: [], strains: [], grows: [], supplies: [], sales: [], corrections: [], weeks: [], activeWeek: null, accessCode: sessionStorage.getItem("ct_access") || "", adminCode: sessionStorage.getItem("ct_admin") || "", pendingView: "", busy: false };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: config.CURRENCY || "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
  function growTrimmings(grow) {
    return num(grow.trimmings) || num(grow.boxes) * TRIMMINGS_PER_BOX;
  }
  function quantity(value, singular, plural) {
    return number.format(value) + " " + (num(value) === 1 ? singular : plural);
  }
  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown date" : dateTime.format(date);
  }
  function nowInput() {
    const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return date.toISOString().slice(0, 16);
  }
  function dateInputValue(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return nowInput();
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function splitSale(boxes, price) {
    const gross = rounded(num(boxes) * num(price));
    const grower = rounded(gross * PAYOUT_RATES.grower);
    const seller = rounded(gross * PAYOUT_RATES.seller);
    const gangShare = rounded(gross - grower - seller);
    const supplyDeduction = Math.min(gangShare, supplySummary().outstanding);
    return { gross: gross, grower: grower, seller: seller, supplyDeduction: supplyDeduction, gang: rounded(gangShare - supplyDeduction) };
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
    const body = Object.assign({ action: action, accessCode: state.accessCode, adminCode: state.adminCode }, payload || {});
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
    state.supplies = data.supplies || [];
    state.sales = data.sales || [];
    state.corrections = data.corrections || [];
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
      if (state.pendingView) showView(state.pendingView);
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
  function openAdmin(message) {
    const dialog = $("[data-admin-dialog]");
    $("[data-admin-error]").textContent = message || "";
    if (!dialog.open) dialog.showModal();
  }
  function closeAdmin() {
    const dialog = $("[data-admin-dialog]");
    if (dialog.open) dialog.close();
    $("[data-admin-error]").textContent = "";
  }
  function lockAdmin(message) {
    sessionStorage.removeItem("ct_admin");
    state.adminCode = "";
    state.pendingView = "";
    if (message) toast(message);
  }
  function inventoryRows() {
    const rows = new Map();
    state.grows.forEach(function (grow) {
      const key = grow.grower + "|||" + grow.strain;
      const row = rows.get(key) || { grower: grow.grower, strain: grow.strain, trimmings: 0, boxes: 0, price: num(grow.unitPrice) };
      row.trimmings += growTrimmings(grow);
      row.price = num(grow.unitPrice) || row.price;
      rows.set(key, row);
    });
    state.sales.forEach(function (sale) {
      const key = sale.grower + "|||" + sale.strain;
      const row = rows.get(key) || { grower: sale.grower, strain: sale.strain, trimmings: 0, boxes: 0, price: num(sale.unitPrice) };
      row.trimmings -= num(sale.boxes) * TRIMMINGS_PER_BOX;
      rows.set(key, row);
    });
    return Array.from(rows.values()).map(function (row) {
      row.trimmings = rounded(row.trimmings);
      row.boxes = Math.max(0, Math.floor((row.trimmings + 0.0001) / TRIMMINGS_PER_BOX));
      return row;
    }).filter(function (row) { return row.trimmings > 0.0001; }).sort(function (a, b) { return b.trimmings - a.trimmings; });
  }
  function payoutSummary() {
    const people = new Map();
    let gangTotal = 0;
    state.sales.forEach(function (sale) {
      gangTotal += num(sale.gangPayout);
      if (!sale.growerPaidAt) {
        const row = people.get(sale.grower) || { name: sale.grower, grower: 0, seller: 0, supplies: 0 };
        row.grower += num(sale.growerPayout);
        people.set(sale.grower, row);
      }
      if (!sale.sellerPaidAt) {
        const row = people.get(sale.seller) || { name: sale.seller, grower: 0, seller: 0, supplies: 0 };
        row.seller += num(sale.sellerPayout);
        people.set(sale.seller, row);
      }
    });
    state.supplies.forEach(function (supply) {
      if (!supply.paidAt) {
        const row = people.get(supply.buyer) || { name: supply.buyer, grower: 0, seller: 0, supplies: 0 };
        row.supplies += num(supply.total || num(supply.quantity) * num(supply.unitCost));
        people.set(supply.buyer, row);
      }
    });
    const list = Array.from(people.values()).map(function (row) {
      row.total = row.grower + row.seller + row.supplies;
      return row;
    }).sort(function (a, b) { return b.total - a.total; });
    const suppliesDue = state.supplies.reduce(function (sum, supply) {
      return sum + (supply.paidAt ? 0 : num(supply.total || num(supply.quantity) * num(supply.unitCost)));
    }, 0);
    return { people: list, gangTotal: gangTotal, suppliesDue: rounded(suppliesDue) };
  }
  function supplySummary() {
    const purchased = state.supplies.reduce(function (sum, row) { return sum + num(row.total || num(row.quantity) * num(row.unitCost)); }, 0);
    const recovered = state.sales.reduce(function (sum, row) { return sum + num(row.supplyDeduction); }, 0);
    return { purchased: rounded(purchased), recovered: rounded(recovered), outstanding: Math.max(0, rounded(purchased - recovered)) };
  }
  function memberStatements() {
    const people = new Map();
    state.sales.forEach(function (sale) {
      const grower = people.get(sale.grower) || { name: sale.grower, earned: 0, supplies: 0, paid: 0, due: 0 };
      grower.earned += num(sale.growerPayout);
      if (sale.growerPaidAt) grower.paid += num(sale.growerPayout); else grower.due += num(sale.growerPayout);
      people.set(sale.grower, grower);
      const seller = people.get(sale.seller) || { name: sale.seller, earned: 0, supplies: 0, paid: 0, due: 0 };
      seller.earned += num(sale.sellerPayout);
      if (sale.sellerPaidAt) seller.paid += num(sale.sellerPayout); else seller.due += num(sale.sellerPayout);
      people.set(sale.seller, seller);
    });
    state.supplies.forEach(function (supply) {
      const amount = num(supply.total || num(supply.quantity) * num(supply.unitCost));
      const buyer = people.get(supply.buyer) || { name: supply.buyer, earned: 0, supplies: 0, paid: 0, due: 0 };
      buyer.supplies += amount;
      if (supply.paidAt) buyer.paid += amount; else buyer.due += amount;
      people.set(supply.buyer, buyer);
    });
    return Array.from(people.values()).sort(function (a, b) { return b.due - a.due || b.earned - a.earned; });
  }
  function ledgerRows() {
    return state.grows.map(function (row) { return Object.assign({ type: "grow" }, row); })
      .concat(state.supplies.map(function (row) { return Object.assign({ type: "supply" }, row); }))
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
    const supply = row.type === "supply";
    const amount = grow ? growTrimmings(row) : supply ? num(row.quantity) : num(row.boxes);
    const text = grow
      ? esc(row.grower) + " logged " + quantity(amount, "trimming", "trimmings") + " of " + esc(row.strain)
      : supply
        ? esc(row.buyer) + " bought " + quantity(amount, "item", "items") + " of " + esc(row.item)
        : esc(row.seller) + " sold " + quantity(amount, "box", "boxes") + " of " + esc(row.strain);
    const badge = grow ? "+" : supply ? "−" : "$";
    const value = grow ? "+" + number.format(amount) : supply ? "−" + money.format(row.total) : money.format(row.gross);
    return '<div class="activity ' + row.type + '"><span class="activity-badge">' + badge + "</span><div><strong>" + text + "</strong><small>" + esc(formatDate(row.timestamp)) + "</small></div><b>" + value + "</b></div>";
  }
  function renderDashboard() {
    const inventory = inventoryRows();
    const payouts = payoutSummary();
    const supplies = supplySummary();
    const currentSales = state.sales.filter(function (sale) { return !state.activeWeek || sale.weekId === state.activeWeek.id; });
    const currentSupplies = state.supplies.filter(function (supply) { return !state.activeWeek || supply.weekId === state.activeWeek.id; });
    const stockTrimmings = inventory.reduce(function (sum, row) { return sum + row.trimmings; }, 0);
    const stockBoxes = inventory.reduce(function (sum, row) { return sum + row.boxes; }, 0);
    const gross = currentSales.reduce(function (sum, sale) { return sum + num(sale.gross); }, 0);
    const owed = payouts.people.reduce(function (sum, person) { return sum + person.total; }, 0);
    $("#dashboardMetrics").innerHTML = [
      metric("Trimmings on shelves", number.format(stockTrimmings), quantity(stockBoxes, "sale-ready box", "sale-ready boxes")),
      metric("Supply balance", money.format(supplies.outstanding), currentSupplies.length + " purchases this week"),
      metric("Sales this week", money.format(gross), currentSales.length + " recorded sales"),
      metric("Member payouts due", money.format(owed), payouts.people.length + " members owed"),
    ].join("");
    $("#inventoryTable").innerHTML = inventory.length ? table(
      ["Grower", "Strain", "Trimmings", "Sale-ready boxes"],
      inventory.slice(0, 10).map(function (row) {
        return [esc(row.grower), esc(row.strain), { value: number.format(row.trimmings), num: true }, { value: number.format(row.boxes), num: true }];
      })
    ) : empty("No stock yet. Log the first grow to begin.");
    $("#dashboardPayouts").innerHTML = payouts.people.length ? payouts.people.slice(0, 6).map(function (person) {
      const max = payouts.people[0].total || 1;
      return '<div class="payout-row"><span>' + esc(person.name) + "</span><strong>" + money.format(person.total) + '</strong><div class="progress"><i style="width:' + Math.max(4, person.total / max * 100) + '%"></i></div></div>';
    }).join("") : empty("No open member payouts.");
    const recent = ledgerRows().slice(0, 7);
    $("#recentActivity").innerHTML = recent.length ? recent.map(activityHtml).join("") : empty("Activity will appear here after the first grow, supply purchase, or sale.");
  }
  function renderSupplies() {
    const summary = supplySummary();
    $("[data-supply-balance]").textContent = money.format(summary.outstanding);
    $("#supplyTable").innerHTML = state.supplies.length ? table(
      ["When", "Bought by", "Item", "Quantity", "Per item", "Total", "Reimbursement"],
      state.supplies.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); }).map(function (row) {
        return [esc(formatDate(row.timestamp)), esc(row.buyer), esc(row.item), { value: number.format(row.quantity), num: true }, { value: money.format(row.unitCost), num: true }, { value: money.format(row.total), num: true }, row.paidAt ? '<span class="paid">Paid</span>' : '<span class="due">Owed</span>'];
      })
    ) : empty("No supply purchases yet.");
    updateSupplyPreview();
  }
  function queueActions(sale) {
    if (!state.adminCode) return "";
    const checks = [];
    const buttons = [];
    if (!sale.growerPaidAt) {
      checks.push('<label class="payout-option"><input type="checkbox" data-payout-select data-id="' + esc(sale.id) + '" data-role="grower" aria-label="Select grower payout for ' + esc(sale.grower) + '"><span>Grower · ' + money.format(sale.growerPayout) + '</span></label>');
      buttons.push('<button class="mini-button" data-settle="' + esc(sale.id) + '" data-role="grower">Pay now</button>');
    }
    if (!sale.sellerPaidAt) {
      checks.push('<label class="payout-option"><input type="checkbox" data-payout-select data-id="' + esc(sale.id) + '" data-role="seller" aria-label="Select seller payout for ' + esc(sale.seller) + '"><span>Seller · ' + money.format(sale.sellerPayout) + '</span></label>');
      buttons.push('<button class="mini-button" data-settle="' + esc(sale.id) + '" data-role="seller">Pay now</button>');
    }
    if (!sale.growerPaidAt && !sale.sellerPaidAt) buttons.push('<button class="mini-button" data-settle="' + esc(sale.id) + '" data-role="both">Pay both</button>');
    return '<div class="queue-actions"><div class="payout-options">' + checks.join("") + '</div><div class="payout-quick-actions">' + buttons.join("") + "</div></div>";
  }
  function supplyQueueActions(supply) {
    if (!state.adminCode || supply.paidAt) return "";
    const amount = num(supply.total || num(supply.quantity) * num(supply.unitCost));
    return '<div class="queue-actions"><div class="payout-options"><label class="payout-option"><input type="checkbox" data-payout-select data-id="' + esc(supply.id) + '" data-role="supply" aria-label="Select supply reimbursement for ' + esc(supply.buyer) + '"><span>Reimburse · ' + money.format(amount) + '</span></label></div><div class="payout-quick-actions"><button class="mini-button" data-settle="' + esc(supply.id) + '" data-role="supply">Pay now</button></div></div>';
  }
  function selectedPayouts() {
    return $$('[data-payout-select]:checked').map(function (input) {
      return { id: input.dataset.id, role: input.dataset.role };
    });
  }
  function updatePayoutSelection() {
    const selected = selectedPayouts();
    const total = selected.reduce(function (sum, item) {
      const sale = state.sales.find(function (row) { return String(row.id) === String(item.id); });
      if (sale) return sum + num(item.role === "grower" ? sale.growerPayout : sale.sellerPayout);
      const supply = state.supplies.find(function (row) { return String(row.id) === String(item.id); });
      return sum + (supply ? num(supply.total || num(supply.quantity) * num(supply.unitCost)) : 0);
    }, 0);
    const button = $('[data-action="settle-selected"]');
    const status = $("[data-payout-selection]");
    const all = $$('[data-payout-select]');
    const selectAll = $("[data-select-all-payouts]");
    if (button) {
      button.disabled = !selected.length || state.busy;
      button.textContent = selected.length ? "Pay selected · " + money.format(total) : "Pay selected";
    }
    if (status) status.textContent = selected.length ? selected.length + " share" + (selected.length === 1 ? "" : "s") + " selected" : "Select any unpaid shares";
    if (selectAll) {
      selectAll.checked = Boolean(all.length && selected.length === all.length);
      selectAll.indeterminate = Boolean(selected.length && selected.length < all.length);
    }
  }
  function renderPayouts() {
    const summary = payoutSummary();
    const statements = memberStatements();
    const growerOwed = summary.people.reduce(function (sum, row) { return sum + row.grower; }, 0);
    const sellerOwed = summary.people.reduce(function (sum, row) { return sum + row.seller; }, 0);
    $("#payoutMetrics").innerHTML = [
      metric("Growers owed", money.format(growerOwed), "70% shares not marked paid"),
      metric("Sellers owed", money.format(sellerOwed), "15% shares not marked paid"),
      metric("Supply reimbursements", money.format(summary.suppliesDue), "fronted costs not marked paid"),
      metric("Total member queue", money.format(growerOwed + sellerOwed + summary.suppliesDue), summary.people.length + " members"),
      metric("Gang keeps", money.format(summary.gangTotal), "after supply costs")
    ].join("");
    $("#memberPayouts").innerHTML = statements.length ? table(
      ["Member", "Sales earned", "Supply reimbursements", "Paid out", "Remaining due"],
      statements.map(function (row) {
        return [esc(row.name), { value: money.format(row.earned), num: true }, { value: money.format(row.supplies), num: true }, { value: money.format(row.paid), num: true }, { value: "<strong>" + money.format(row.due) + "</strong>", num: true, raw: true }];
      })
    ) : empty("Everyone is settled.");
    const unsettled = state.sales.filter(function (sale) { return !sale.growerPaidAt || !sale.sellerPaidAt; }).sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    const unsettledSupplies = state.supplies.filter(function (supply) { return !supply.paidAt; }).sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
    const hasUnsettled = unsettled.length || unsettledSupplies.length;
    const payoutTools = hasUnsettled && state.adminCode ? '<div class="bulk-payout-bar"><label class="bulk-select"><input type="checkbox" data-select-all-payouts><span>Select all open shares and reimbursements</span></label><span class="selection-status" data-payout-selection>Select any unpaid payouts</span><button class="button primary" type="button" data-action="settle-selected" disabled>Pay selected</button></div>' : "";
    $("#managerPayoutQueue").innerHTML = unsettled.length ? payoutTools + table(
      ["Sale", "Grower share", "Seller share", "Settle"],
      unsettled.map(function (sale) {
        return [
          "<strong>" + esc(sale.strain) + "</strong><small>" + esc(formatDate(sale.timestamp)) + " · " + quantity(sale.boxes, "box", "boxes") + "</small>",
          sale.growerPaidAt ? '<span class="paid">Paid ' + esc(sale.grower) + "</span>" : esc(sale.grower) + " · " + money.format(sale.growerPayout),
          sale.sellerPaidAt ? '<span class="paid">Paid ' + esc(sale.seller) + "</span>" : esc(sale.seller) + " · " + money.format(sale.sellerPayout),
          { value: queueActions(sale), raw: true, num: true }
        ];
      })
    ) : empty("No unsettled sales.");
    if (unsettledSupplies.length) {
      const supplyQueue = '<h3 class="queue-subheading">Supply reimbursements</h3>' + table(
        ["Purchase", "Bought by", "Amount", "Settle"],
        unsettledSupplies.map(function (supply) {
          return [
            "<strong>" + esc(supply.item) + "</strong><small>" + esc(formatDate(supply.timestamp)) + " · " + quantity(supply.quantity, "item", "items") + "</small>",
            esc(supply.buyer),
            { value: money.format(num(supply.total || num(supply.quantity) * num(supply.unitCost))), num: true },
            { value: supplyQueueActions(supply), raw: true, num: true }
          ];
        })
      );
      $("#managerPayoutQueue").innerHTML = (unsettled.length ? $("#managerPayoutQueue").innerHTML : payoutTools) + supplyQueue;
    } else if (!unsettled.length) {
      $("#managerPayoutQueue").innerHTML = empty("No unpaid sales or supply reimbursements.");
    }
    updatePayoutSelection();
  }
  function renderLedger() {
    const query = $("#ledgerSearch").value.trim().toLowerCase();
    const type = $("#ledgerType").value;
    const week = $("#ledgerWeek").value;
    const rows = ledgerRows().filter(function (row) {
      const text = [row.grower, row.seller, row.buyer, row.strain, row.item, row.reference, row.notes].join(" ").toLowerCase();
      return (type === "all" || row.type === type) && (week === "all" || row.weekId === week) && (!query || text.includes(query));
    });
    $("#ledgerTable").innerHTML = rows.length ? table(
      ["When", "Type", "Member / source", "Item / strain", "Quantity", "Value"],
      rows.map(function (row) {
        const grow = row.type === "grow";
        const supply = row.type === "supply";
        const trimmings = growTrimmings(row);
        return [
          esc(formatDate(row.timestamp)),
          grow ? '<span class="paid">Grow</span>' : supply ? '<span class="supply-label">Supply</span>' : "Sale",
          grow ? esc(row.grower) : supply ? esc(row.buyer) : "<strong>" + esc(row.seller) + "</strong><small>Stock: " + esc(row.grower) + "</small>",
          esc(supply ? row.item : row.strain),
          { value: grow ? quantity(trimmings, "trimming", "trimmings") : supply ? quantity(row.quantity, "item", "items") : quantity(row.boxes, "box", "boxes"), num: true },
          { value: supply ? "−" + money.format(row.total) : grow ? money.format(trimmings / TRIMMINGS_PER_BOX * num(row.unitPrice)) : money.format(row.gross), num: true }
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
  function correctionRow(type, row) {
    const isGrow = type === "grow";
    const label = isGrow
      ? esc(row.grower) + " · " + esc(row.strain)
      : esc(row.seller) + " sold " + quantity(row.boxes, "box", "boxes");
    const detail = isGrow
      ? quantity(growTrimmings(row), "trimming", "trimmings") + " · " + formatDate(row.timestamp)
      : esc(row.strain) + " · " + money.format(row.gross) + " · " + formatDate(row.timestamp);
    const deleteLabel = isGrow ? "Delete grow" : "Delete sale + payout";
    const payoutButtons = isGrow ? "" :
      (row.growerPaidAt ? '<button class="mini-button" type="button" data-reopen-payout="' + esc(row.id) + '" data-role="grower">Undo grower paid</button>' : "") +
      (row.sellerPaidAt ? '<button class="mini-button" type="button" data-reopen-payout="' + esc(row.id) + '" data-role="seller">Undo seller paid</button>' : "");
    return '<div class="correction-row"><div><strong>' + label + "</strong><small>" + detail + '</small></div><div class="correction-actions"><button class="mini-button" type="button" data-edit-' + type + '="' + esc(row.id) + '">Edit</button>' + payoutButtons + '<button class="mini-button danger-mini" type="button" data-delete-' + type + '="' + esc(row.id) + '">' + deleteLabel + "</button></div></div>";
  }
  function supplyCorrectionRow(row) {
    const amount = num(row.total || num(row.quantity) * num(row.unitCost));
    const action = row.paidAt ? '<button class="mini-button" type="button" data-reopen-payout="' + esc(row.id) + '" data-role="supply">Undo reimbursement paid</button>' : '<span class="due">Owed</span>';
    return '<div class="correction-row"><div><strong>' + esc(row.item) + "</strong><small>" + esc(row.buyer) + " · " + money.format(amount) + " · " + formatDate(row.timestamp) + '</small></div><div class="correction-actions">' + action + "</div></div>";
  }
  function renderCorrections() {
    const grows = state.grows.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); }).slice(0, 8);
    const sales = state.sales.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); }).slice(0, 8);
    const supplies = state.supplies.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); }).slice(0, 8);
    $("#managerGrowRecords").innerHTML = grows.length ? '<div class="correction-list">' + grows.map(function (row) { return correctionRow("grow", row); }).join("") + "</div>" : empty("No grows to correct.");
    $("#managerSaleRecords").innerHTML = sales.length ? '<div class="correction-list">' + sales.map(function (row) { return correctionRow("sale", row); }).join("") + "</div>" : empty("No sales to correct.");
    $("#managerSupplyRecords").innerHTML = supplies.length ? '<div class="correction-list">' + supplies.map(supplyCorrectionRow).join("") + "</div>" : empty("No supply reimbursements yet.");
    const history = state.corrections.slice().sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); }).slice(0, 10);
    $("#managerCorrectionHistory").innerHTML = history.length ? '<div class="history-list">' + history.map(function (row) {
      const actionName = String(row.action || "edit").toLowerCase();
      const action = actionName === "delete" ? "deleted" : actionName === "reopen" ? "reopened" : "corrected";
      return '<div class="history-item"><strong>' + esc(String(row.recordType || "record").toUpperCase()) + " " + action + "</strong><small>" + esc(row.reason) + " · " + esc(formatDate(row.timestamp)) + "</small></div>";
    }).join("") + "</div>" : empty("No corrections have been made yet.");
  }
  function setCorrectionGroup(group, active) {
    group.hidden = !active;
    $$("input, select, textarea", group).forEach(function (control) { control.disabled = !active; });
  }
  function setRecordSelectValue(select, value) {
    const exists = Array.from(select.options).some(function (option) { return option.value === String(value); });
    if (!exists && value) select.add(new Option(String(value) + " · archived", String(value)));
    select.value = value;
  }
  function openCorrection(type, id) {
    if (!state.adminCode) { state.pendingView = "manager"; openAdmin(); return; }
    const isGrow = type === "grow";
    const record = (isGrow ? state.grows : state.sales).find(function (row) { return String(row.id) === String(id); });
    if (!record) { toast("That record could not be found."); return; }
    const dialog = $("[data-correction-dialog]");
    const form = $("#correctionForm");
    form.reset();
    form.recordType.value = type;
    form.recordId.value = id;
    setCorrectionGroup($("[data-correction-grow]"), isGrow);
    setCorrectionGroup($("[data-correction-sale]"), !isGrow);
    $("[data-correction-title]").textContent = isGrow ? "Correct grow entry" : "Correct sale";
    if (isGrow) {
      form.growDate.value = dateInputValue(record.timestamp);
      setRecordSelectValue(form.growGrower, record.grower);
      setRecordSelectValue(form.growStrain, record.strain);
      form.growTrimmings.value = growTrimmings(record);
      form.growPrice.value = num(record.unitPrice);
      form.growNotes.value = record.notes || "";
    } else {
      form.saleDate.value = dateInputValue(record.timestamp);
      setRecordSelectValue(form.saleSeller, record.seller);
      setRecordSelectValue(form.saleGrower, record.grower);
      setRecordSelectValue(form.saleStrain, record.strain);
      form.saleBoxes.value = num(record.boxes);
      form.salePrice.value = num(record.unitPrice);
      form.saleReference.value = record.reference || "";
    }
    if (!dialog.open) dialog.showModal();
  }
  function closeCorrection() {
    const dialog = $("[data-correction-dialog]");
    if (dialog.open) dialog.close();
  }
  function renderInventoryStrains() {
    const grower = $("[data-inventory-growers]").value;
    const rows = inventoryRows().filter(function (row) { return row.grower === grower && row.boxes > 0; });
    const select = $("[data-inventory-strains]");
    const current = select.value;
    select.innerHTML = '<option value="">Choose available stock</option>' + rows.map(function (row) {
      return '<option value="' + esc(row.strain) + '" data-stock="' + row.boxes + '" data-trimmings="' + row.trimmings + '" data-price="' + row.price + '">' + esc(row.strain) + " · " + quantity(row.boxes, "box", "boxes") + "</option>";
    }).join("");
    if (rows.some(function (row) { return row.strain === current; })) select.value = current;
    updateStockHint();
  }
  function updateStockHint() {
    const option = $("[data-inventory-strains]").selectedOptions[0];
    const stock = num(option && option.dataset.stock);
    const trimmings = num(option && option.dataset.trimmings);
    $("[data-available-stock]").textContent = stock ? quantity(stock, "box", "boxes") + " available; " + quantity(trimmings, "trimming", "trimmings") + " remain in this lot." : "Choose a grower and strain to see stock.";
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
    const growers = Array.from(new Set(inventoryRows().filter(function (row) { return row.boxes > 0; }).map(function (row) { return row.grower; }))).sort();
    const growerSelect = $("[data-inventory-growers]");
    const current = growerSelect.value;
    growerSelect.innerHTML = '<option value="">Choose a grower</option>' + growers.map(function (name) { return '<option value="' + esc(name) + '">' + esc(name) + "</option>"; }).join("");
    if (growers.includes(current)) growerSelect.value = current;
    renderInventoryStrains();
  }
  function renderAll() {
    renderDashboard();
    renderSupplies();
    renderPayouts();
    renderLedger();
    renderSettings();
    renderCorrections();
    renderSelects();
    renderWeeks();
    $$("[data-sheet-link]").forEach(function (link) { link.href = config.SHEET_URL; });
  }
  function renderWeeks() {
    $("[data-active-week]").textContent = state.activeWeek ? state.activeWeek.label : "No active week";
    $("[data-manager-week]").textContent = state.activeWeek ? state.activeWeek.label : "No active week";
    const currentSales = state.sales.filter(function (sale) { return state.activeWeek && sale.weekId === state.activeWeek.id; });
    $("[data-week-summary]").textContent = quantity(currentSales.length, "sale", "sales") + " this week · stock, supply costs, and balances roll forward";
    const select = $("#ledgerWeek");
    const current = select.value;
    select.innerHTML = '<option value="all">All weeks</option>' + state.weeks.slice().reverse().map(function (week) {
      return '<option value="' + esc(week.id) + '">' + esc(week.label) + (week.status === "active" ? " · active" : "") + "</option>";
    }).join("");
    if (state.weeks.some(function (week) { return week.id === current; })) select.value = current;
  }
  function showView(name, updateHash) {
    if (name === "manager" && !state.adminCode) {
      state.pendingView = "manager";
      openAdmin();
      return;
    }
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
    return mutateWith(function () { return request(action, payload); }, successMessage);
  }
  async function mutateWith(operation, successMessage) {
    if (state.busy) return false;
    state.busy = true;
    $$("button[type=submit]").forEach(function (button) { button.disabled = true; });
    setSync("loading", "Saving to shared sheet…");
    try {
      const result = await operation();
      applyData(result.data);
      setSync("synced", "Shared sheet synced");
      renderAll();
      toast(successMessage);
      return true;
    } catch (error) {
      setSync("error", "Save failed");
      if (/manager|admin/i.test(error.message)) {
        lockAdmin();
        state.pendingView = "manager";
        openAdmin(error.message);
      }
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
    $("[data-preview-seller]").textContent = money.format(split.seller);
    $("[data-preview-supplies]").textContent = "−" + money.format(split.supplyDeduction);
    $("[data-preview-gang]").textContent = money.format(split.gang);
  }
  function updateSupplyPreview() {
    const form = $("#supplyForm");
    const total = rounded(num(form.quantity.value) * num(form.unitCost.value));
    const outstanding = supplySummary().outstanding;
    $("[data-preview-supply-total]").textContent = money.format(total);
    $("[data-preview-supply-balance]").textContent = money.format(outstanding + total);
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
      const audit = { exportedAt: new Date().toISOString(), members: state.members, strains: state.strains, grows: state.grows, supplies: state.supplies, sales: state.sales };
      download("clown-tent-audit-" + stamp + ".json", new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" }));
      return;
    }
    if (type === "payouts") {
      csvDownload("clown-tent-payouts-" + stamp + ".csv", [["Member", "Grower due", "Seller due", "Total due"]].concat(payoutSummary().people.map(function (row) { return [row.name, row.grower, row.seller, row.total]; })));
      return;
    }
    csvDownload("clown-tent-ledger-" + stamp + ".csv", [["Date", "Type", "Grower", "Seller", "Supply buyer", "Item / strain", "Trimmings (grow)", "Supply quantity", "Boxes (sale)", "Unit price / cost", "Gross", "Supplies from gang share", "Grower payout", "Gang keeps", "Seller payout", "Reference / notes"]].concat(ledgerRows().map(function (row) {
      return [row.timestamp, row.type, row.grower || "", row.seller || "", row.buyer || "", row.item || row.strain || "", row.type === "grow" ? growTrimmings(row) : "", row.type === "supply" ? row.quantity : "", row.type === "sale" ? row.boxes : "", row.type === "supply" ? row.unitCost : row.unitPrice, row.gross || "", row.supplyDeduction || "", row.growerPayout || "", row.gangPayout || "", row.sellerPayout || "", row.reference || row.notes || ""];
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
  $("#adminForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get("adminCode") || "").trim();
    if (!code) return;
    state.adminCode = code;
    $("[data-admin-error]").textContent = "";
    try {
      await request("verifyAdmin");
      sessionStorage.setItem("ct_admin", code);
      closeAdmin();
      form.reset();
      const destination = state.pendingView || "manager";
      state.pendingView = "";
      renderAll();
      showView(destination);
    } catch (error) {
      lockAdmin();
      $("[data-admin-error]").textContent = error.message;
    }
  });
  $("#growForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const trimmings = num(data.trimmings);
    if (!Number.isInteger(trimmings) || trimmings < 1) { toast("Enter a whole number of trimmings."); return; }
    const ok = await mutate("addGrow", { record: { timestamp: data.date, grower: data.grower, strain: data.strain, trimmings: trimmings, unitPrice: num(data.price), notes: data.notes } }, "Grow trimmings added to shared inventory.");
    if (ok) { form.reset(); form.date.value = nowInput(); }
  });
  $("#supplyForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const quantity = num(data.quantity);
    const unitCost = num(data.unitCost);
    if (!Number.isInteger(quantity) || quantity < 1) { toast("Enter a whole supply quantity."); return; }
    if (unitCost < 0) { toast("Supply cost cannot be negative."); return; }
    const ok = await mutate("addSupply", { record: { timestamp: data.date, buyer: data.buyer, item: data.item, quantity: quantity, unitCost: unitCost, notes: data.notes } }, "Supply cost added to the gang balance.");
    if (ok) { form.reset(); form.date.value = nowInput(); updateSupplyPreview(); }
  });
  $("#saleForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (!Number.isInteger(num(data.boxes)) || num(data.boxes) < 1) { toast("Sales must use whole boxes."); return; }
    const lot = inventoryRows().find(function (row) { return row.grower === data.grower && row.strain === data.strain; });
    const available = lot ? lot.boxes : 0;
    if (num(data.boxes) > available) { toast("Only " + number.format(available) + " boxes are available for that lot."); return; }
    const ok = await mutate("addSale", { record: { timestamp: data.date, seller: data.seller, grower: data.grower, strain: data.strain, boxes: num(data.boxes), unitPrice: num(data.price), reference: data.reference } }, "Sale recorded and payout split created.");
    if (ok) { form.reset(); form.date.value = nowInput(); updateSalePreview(); showView("payouts"); }
  });
  $("#correctionForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (!String(data.reason || "").trim()) { toast("Add a short correction reason."); return; }
    if (data.recordType === "grow") {
      const trimmings = num(data.growTrimmings);
      if (!Number.isInteger(trimmings) || trimmings < 1) { toast("Enter a whole number of trimmings."); return; }
      const ok = await mutate("updateGrow", { id: data.recordId, reason: data.reason, record: { timestamp: data.growDate, grower: data.growGrower, strain: data.growStrain, trimmings: trimmings, unitPrice: num(data.growPrice), notes: data.growNotes } }, "Grow correction saved to the audit history.");
      if (ok) closeCorrection();
      return;
    }
    const boxes = num(data.saleBoxes);
    if (!Number.isInteger(boxes) || boxes < 1) { toast("Sales must use whole boxes."); return; }
    if (!confirm("Save this sale correction? If the people, product, quantity, or price changed, both payouts will reopen for manager confirmation.")) return;
    const ok = await mutate("updateSale", { id: data.recordId, reason: data.reason, record: { timestamp: data.saleDate, seller: data.saleSeller, grower: data.saleGrower, strain: data.saleStrain, boxes: boxes, unitPrice: num(data.salePrice), reference: data.saleReference } }, "Sale correction saved. Any affected payouts were reopened.");
    if (ok) closeCorrection();
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
    if (action === "sign-out") { sessionStorage.removeItem("ct_access"); state.accessCode = ""; lockAdmin(); showView("dashboard"); openAccess("Tracker locked."); }
    if (action === "admin-lock") { closeCorrection(); lockAdmin("Manager controls locked."); showView("dashboard"); }
    if (action === "close-correction") closeCorrection();
    if (action === "rollover-week") {
      const suggested = "Week of " + new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date());
      const label = prompt("Name the new tracking week. Shelf trimmings, supply costs, and unpaid balances will carry forward.", suggested);
      if (label && confirm("Close " + (state.activeWeek ? state.activeWeek.label : "the current week") + " and start " + label + "? No inventory or payout history will be deleted.")) {
        await mutate("rolloverWeek", { label: label }, "New tracking week started. Stock, supply costs, and balances carried forward.");
      }
    }
    if (action === "settle-selected" && state.adminCode) {
      const items = selectedPayouts();
      if (items.length && confirm("Mark " + items.length + " selected payout" + (items.length === 1 ? "" : "s") + " as paid? The ledger rows will stay unchanged.")) {
        await mutateWith(function () {
          return request("settlePayouts", { items: items });
        }, "Selected payouts marked paid.");
      }
    }
    const selectAllPayouts = event.target.closest("[data-select-all-payouts]");
    if (selectAllPayouts) {
      $$('[data-payout-select]').forEach(function (input) { input.checked = selectAllPayouts.checked; });
      updatePayoutSelection();
    }
    if (event.target.closest("[data-payout-select]")) updatePayoutSelection();
    const settle = event.target.closest("[data-settle]");
    if (settle && state.adminCode) {
      const settleAction = settle.dataset.role === "supply" ? "settleSupply" : "settleSale";
      await mutate(settleAction, { id: settle.dataset.settle, role: settle.dataset.role }, settle.dataset.role === "supply" ? "Supply reimbursement marked paid." : "Payout status updated.");
    }
    const editGrow = event.target.closest("[data-edit-grow]");
    if (editGrow) openCorrection("grow", editGrow.dataset.editGrow);
    const editSale = event.target.closest("[data-edit-sale]");
    if (editSale) openCorrection("sale", editSale.dataset.editSale);
    const deleteGrow = event.target.closest("[data-delete-grow]");
    if (deleteGrow && state.adminCode) {
      const row = state.grows.find(function (grow) { return String(grow.id) === String(deleteGrow.dataset.deleteGrow); });
      const reason = prompt("Why should this grow be deleted? The reason will stay in the audit history.");
      if (reason && confirm("Delete " + (row ? row.grower + "'s " + row.strain + " grow" : "this grow") + "? Its stock will be removed. The deletion will be blocked if recorded sales need that stock.")) {
        await mutate("deleteGrow", { id: deleteGrow.dataset.deleteGrow, reason: reason }, "Mistaken grow removed. The deletion remains in the audit history.");
      }
    }
    const deleteSale = event.target.closest("[data-delete-sale]");
    if (deleteSale && state.adminCode) {
      const row = state.sales.find(function (sale) { return String(sale.id) === String(deleteSale.dataset.deleteSale); });
      const reason = prompt("Why should this sale and payout be deleted? The reason will stay in the audit history.");
      if (reason && confirm("Delete " + (row ? row.seller + "'s " + money.format(row.gross) + " sale and its payout" : "this sale and payout") + "? This removes it from totals and returns its boxes to inventory.")) {
        await mutate("deleteSale", { id: deleteSale.dataset.deleteSale, reason: reason }, "Mistaken sale and payout removed. Inventory and totals were restored.");
      }
    }
    const reopenPayout = event.target.closest("[data-reopen-payout]");
    if (reopenPayout && state.adminCode) {
      const row = state.sales.find(function (sale) { return String(sale.id) === String(reopenPayout.dataset.reopenPayout); });
      const role = reopenPayout.dataset.role;
      const person = row ? (role === "grower" ? row.grower : row.seller) : role;
      const reason = prompt("Why should " + person + "'s payout be marked unpaid again? The reason will stay in the audit history.");
      if (reason && confirm("Reopen " + person + "'s payout? It will return to the amount-due totals and Manager payout queue.")) {
        await mutate("reopenPayout", { id: reopenPayout.dataset.reopenPayout, role: role, reason: reason }, person + "'s payout was reopened.");
      }
    }
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
  $("#supplyForm").addEventListener("input", updateSupplyPreview);
  $("#ledgerSearch").addEventListener("input", renderLedger);
  $("#ledgerType").addEventListener("change", renderLedger);
  $("#ledgerWeek").addEventListener("change", renderLedger);

  $("#growForm").date.value = nowInput();
  $("#supplyForm").date.value = nowInput();
  $("#saleForm").date.value = nowInput();
  const initialView = location.hash.slice(1);
  const requestedView = $('[data-view="' + initialView + '"]') ? initialView : "dashboard";
  if (requestedView === "manager" && !state.accessCode) {
    state.pendingView = "manager";
    showView("dashboard", false);
  } else showView(requestedView, false);
  if (state.accessCode) loadData().catch(function () {});
  else openAccess(config.API_URL ? "" : "The sheet connection is being finished. The interface is ready.");
})();
