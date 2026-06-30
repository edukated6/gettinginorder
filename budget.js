(function () {
  "use strict";

  var STORAGE_KEY = "norder_budget_tool_v1";
  var CLOUD_ROOT_PATH = "budgetUsers";
  var MAX_ACTIVITY = 40;
  var cloudSync = {
    uid: "",
    ref: null,
    isApplyingRemote: false,
    hasLoadedRemote: false,
    writeTimer: null,
  };
  var firebaseAuthWired = false;
  var appBootstrapped = false;
  var state = {
    activePage: "dashboard",
    monthlyIncome: 0,
    bills: [],
    activity: [],
    updatedAt: 0,
  };

  function uid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Date.now() + "-" + Math.floor(Math.random() * 1000000);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function formatMoney(value) {
    var num = Number(value) || 0;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
  }

  function safeNum(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeBudgetShape(input) {
    var source = input && typeof input === "object" ? input : {};
    var normalized = {
      monthlyIncome: Math.max(0, safeNum(source.monthlyIncome)),
      bills: Array.isArray(source.bills) ? source.bills : [],
      activity: Array.isArray(source.activity) ? source.activity : [],
      updatedAt: safeNum(source.updatedAt),
    };

    normalized.bills = normalized.bills.map(function (bill, index) {
      var safeName = String((bill && bill.name) || "").trim().slice(0, 60) || "Untitled";
      var safeType = String((bill && bill.type) || "bill").trim() || "bill";
      return {
        id: String((bill && bill.id) || uid()),
        name: safeName,
        amount: Math.max(0, safeNum(bill && bill.amount)),
        dueDay: Math.min(31, Math.max(1, Math.round(safeNum(bill && bill.dueDay) || 1))),
        type: safeType,
        paid: Boolean(bill && bill.paid),
        order: Number.isFinite(Number(bill && bill.order)) ? Number(bill.order) : index,
      };
    });

    normalized.activity = normalized.activity
      .map(function (entry) {
        return {
          id: String((entry && entry.id) || uid()),
          message: String((entry && entry.message) || "Updated budget"),
          time: String((entry && entry.time) || nowIso()),
        };
      })
      .slice(0, MAX_ACTIVITY);

    return normalized;
  }

  function setStateFromPayload(payload, options) {
    var opts = options || {};
    var normalized = normalizeBudgetShape(payload);
    state.monthlyIncome = normalized.monthlyIncome;
    state.bills = normalized.bills;
    state.activity = normalized.activity;
    state.updatedAt = normalized.updatedAt || Date.now();
    if (!opts.skipRender) {
      rerender(opts);
    }
  }

  function buildSerializableState() {
    return {
      monthlyIncome: state.monthlyIncome,
      bills: state.bills,
      activity: state.activity,
      updatedAt: state.updatedAt || Date.now(),
    };
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      setStateFromPayload(JSON.parse(raw), { skipRender: true });
    } catch (_error) {
      // Ignore storage issues and continue with defaults.
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSerializableState()));
  }

  function pushActivity(message) {
    state.activity.unshift({ id: uid(), message: String(message || "Updated budget"), time: nowIso() });
    state.activity = state.activity.slice(0, MAX_ACTIVITY);
  }

  function canUseFirebaseSync() {
    return (
      typeof firebase !== "undefined" &&
      firebase.auth &&
      firebase.database &&
      Array.isArray(firebase.apps) &&
      firebase.apps.length > 0
    );
  }

  function redirectToLogin() {
    if (typeof window === "undefined") return;
    var next = encodeURIComponent("budget.html");
    window.location.href = "./index.html#/login?next=" + next;
  }

  function updateSyncStatus(text, tone) {
    var node = document.getElementById("sync-status");
    if (!node) return;
    node.textContent = text;
    if (tone === "error") {
      node.style.borderColor = "color-mix(in srgb, var(--danger) 50%, var(--border))";
      node.style.color = "var(--danger)";
      return;
    }
    node.style.borderColor = "color-mix(in srgb, var(--primary) 26%, var(--border))";
    node.style.color = "color-mix(in srgb, var(--primary) 80%, var(--text))";
  }

  function detachCloudListener() {
    if (cloudSync.ref && cloudSync.uid) {
      cloudSync.ref.off();
    }
    cloudSync.uid = "";
    cloudSync.ref = null;
    cloudSync.hasLoadedRemote = false;
  }

  function queueCloudWrite() {
    if (!cloudSync.uid || !cloudSync.ref || cloudSync.isApplyingRemote) return;
    if (cloudSync.writeTimer) {
      clearTimeout(cloudSync.writeTimer);
    }
    cloudSync.writeTimer = setTimeout(function () {
      state.updatedAt = Date.now();
      var payload = buildSerializableState();
      cloudSync.ref
        .set(payload)
        .then(function () {
          updateSyncStatus("Sync: cloud connected", "ok");
        })
        .catch(function () {
          updateSyncStatus("Sync: cloud error", "error");
        });
    }, 320);
  }

  function applyRemoteSnapshot(snapshot) {
    var remote = snapshot && typeof snapshot.val === "function" ? snapshot.val() : null;
    if (!remote || typeof remote !== "object") {
      cloudSync.hasLoadedRemote = true;
      queueCloudWrite();
      return;
    }

    var remoteNormalized = normalizeBudgetShape(remote);
    var remoteUpdatedAt = safeNum(remoteNormalized.updatedAt);
    var localUpdatedAt = safeNum(state.updatedAt);
    cloudSync.hasLoadedRemote = true;

    if (remoteUpdatedAt < localUpdatedAt) {
      queueCloudWrite();
      return;
    }

    cloudSync.isApplyingRemote = true;
    setStateFromPayload(remoteNormalized, { skipCloudWrite: true, skipActivity: true });
    cloudSync.isApplyingRemote = false;
  }

  function connectCloudForUser(user) {
    if (!canUseFirebaseSync() || !user || !user.uid) {
      detachCloudListener();
      updateSyncStatus("Sync: sign in required", "error");
      redirectToLogin();
      return;
    }

    if (cloudSync.uid === user.uid && cloudSync.ref) {
      return;
    }

    detachCloudListener();
    cloudSync.uid = user.uid;
    cloudSync.ref = firebase.database().ref(CLOUD_ROOT_PATH + "/" + user.uid);
    updateSyncStatus("Sync: connecting", "ok");

    cloudSync.ref.on(
      "value",
      function (snapshot) {
        applyRemoteSnapshot(snapshot);
        updateSyncStatus("Sync: cloud connected", "ok");
      },
      function () {
        updateSyncStatus("Sync: cloud error", "error");
      }
    );
  }

  function wireFirebaseSync() {
    if (firebaseAuthWired) return;
    if (!canUseFirebaseSync()) {
      updateSyncStatus("Sync: local only", "ok");
      return;
    }
    firebaseAuthWired = true;
    firebase.auth().onAuthStateChanged(function (user) {
      connectCloudForUser(user);
    });
  }

  function getSortedBills() {
    return state.bills.slice().sort(function (a, b) {
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });
  }

  function writeOrderFromList(idsInOrder) {
    var rank = {};
    idsInOrder.forEach(function (id, index) {
      rank[id] = index;
    });
    state.bills.forEach(function (bill) {
      if (Object.prototype.hasOwnProperty.call(rank, bill.id)) {
        bill.order = rank[bill.id];
      }
    });
  }

  function dueSoonCount() {
    var today = new Date();
    var day = today.getDate();
    var maxDay = Math.min(31, day + 7);
    return state.bills.filter(function (bill) {
      var due = Number(bill.dueDay);
      return !bill.paid && Number.isFinite(due) && due >= day && due <= maxDay;
    }).length;
  }

  function getPlannerMonthlyTotal() {
    return getSortedBills().reduce(function (sum, bill) {
      return sum + Math.max(0, safeNum(bill.amount));
    }, 0);
  }

  function stats() {
    var total = getPlannerMonthlyTotal();
    var services = state.bills.filter(function (bill) {
      return bill.type === "service" || bill.type === "subscription";
    }).length;
    return {
      totalExpenses: total,
      servicesCount: services,
      remaining: state.monthlyIncome - total,
      dueSoon: dueSoonCount(),
    };
  }

  function renderDueCalendar() {
    var mount = document.getElementById("due-calendar");
    if (!mount) return;

    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var firstWeekday = new Date(year, month, 1).getDay();
    var dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var byDay = {};

    state.bills.forEach(function (bill) {
      var day = Math.min(daysInMonth, Math.max(1, Math.round(safeNum(bill.dueDay) || 1)));
      if (!byDay[day]) {
        byDay[day] = { count: 0, total: 0 };
      }
      byDay[day].count += 1;
      byDay[day].total += Math.max(0, safeNum(bill.amount));
    });

    var weekdayHtml = dayNames
      .map(function (name) {
        return '<div class="due-calendar-weekday">' + name + "</div>";
      })
      .join("");

    var cells = [];
    for (var blank = 0; blank < firstWeekday; blank += 1) {
      cells.push('<div class="due-cell-empty" aria-hidden="true"></div>');
    }

    for (var dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
      var entry = byDay[dayNum] || { count: 0, total: 0 };
      var totalText = entry.count ? formatMoney(entry.total) : "No due bills";
      var countText = entry.count ? entry.count + (entry.count === 1 ? " bill" : " bills") : "";
      cells.push(
        '<div class="due-cell">' +
          '<div class="due-cell-day">' + dayNum + "</div>" +
          '<div class="due-cell-total">' + escapeHtml(totalText) + "</div>" +
          '<div class="due-cell-count">' + escapeHtml(countText) + "</div>" +
        "</div>"
      );
    }

    mount.innerHTML =
      '<div class="due-calendar-weekdays">' + weekdayHtml + "</div>" +
      '<div class="due-calendar-grid">' + cells.join("") + "</div>";
  }

  function setActivePage(page) {
    state.activePage = page;
    document.querySelectorAll(".tab").forEach(function (button) {
      button.classList.toggle("active", button.getAttribute("data-page") === page);
    });
    document.querySelectorAll(".page").forEach(function (section) {
      var isPage = section.id === "page-" + page;
      section.classList.toggle("active", isPage);
    });
    window.location.hash = "#" + page;
  }

  function renderDashboard() {
    var computed = stats();
    document.getElementById("stat-expenses").textContent = formatMoney(computed.totalExpenses);
    document.getElementById("stat-services").textContent = String(computed.servicesCount);
    document.getElementById("stat-remaining").textContent = formatMoney(computed.remaining);
    document.getElementById("stat-due-soon").textContent = String(computed.dueSoon);

    var activityList = document.getElementById("activity-list");
    if (!state.activity.length) {
      activityList.innerHTML = '<li class="activity-item">No activity yet. Add your first bill to get started.</li>';
      return;
    }

    activityList.innerHTML = state.activity
      .slice(0, 12)
      .map(function (entry) {
        var date = new Date(entry.time);
        return (
          '<li class="activity-item">' +
          '<strong>' +
          escapeHtml(entry.message) +
          "</strong>" +
          '<span class="activity-time">' +
          escapeHtml(date.toLocaleString()) +
          "</span>" +
          "</li>"
        );
      })
      .join("");

    renderDueCalendar();
  }

  function renderBills() {
    var list = document.getElementById("bills-list");
    var bills = getSortedBills();
    if (!bills.length) {
      list.innerHTML = '<li class="bill-item">No bills yet. Add your first recurring expense above.</li>';
      return;
    }

    list.innerHTML = bills
      .map(function (bill) {
        return (
          '<li class="bill-item" draggable="true" data-id="' +
          escapeAttr(bill.id) +
          '">' +
          '<div class="bill-main">' +
          '<span class="drag-handle" title="Drag to reorder" aria-hidden="true">::</span>' +
          '<input data-field="name" data-id="' +
          escapeAttr(bill.id) +
          '" value="' +
          escapeAttr(bill.name || "") +
          '" maxlength="60" />' +
          '<input data-field="amount" data-id="' +
          escapeAttr(bill.id) +
          '" type="number" min="0" step="0.01" value="' +
          escapeAttr(String(safeNum(bill.amount))) +
          '" />' +
          '<input data-field="dueDay" data-id="' +
          escapeAttr(bill.id) +
          '" type="number" min="1" max="31" value="' +
          escapeAttr(String(safeNum(bill.dueDay) || 1)) +
          '" />' +
          '<select data-field="type" data-id="' +
          escapeAttr(bill.id) +
          '">' +
          renderTypeOptions(bill.type) +
          "</select>" +
          '<label class="bill-paid"><input data-field="paid" data-id="' +
          escapeAttr(bill.id) +
          '" type="checkbox" ' +
          (bill.paid ? "checked" : "") +
          " />Paid</label>" +
          '<div class="bill-actions">' +
          '<button type="button" data-action="up" data-id="' +
          escapeAttr(bill.id) +
          '">Up</button>' +
          '<button type="button" data-action="down" data-id="' +
          escapeAttr(bill.id) +
          '">Down</button>' +
          '<button type="button" data-action="remove" data-id="' +
          escapeAttr(bill.id) +
          '">Remove</button>' +
          "</div>" +
          "</div>" +
          "</li>"
        );
      })
      .join("");
  }

  function renderTypeOptions(active) {
    var types = ["bill", "service", "subscription", "debt", "other"];
    return types
      .map(function (type) {
        return '<option value="' + type + '" ' + (type === active ? "selected" : "") + ">" + capitalize(type) + "</option>";
      })
      .join("");
  }

  function capitalize(value) {
    var text = String(value || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function rerender(options) {
    var opts = options || {};
    if (!opts.skipActivity) {
      state.activity = state.activity.slice(0, MAX_ACTIVITY);
    }
    renderDashboard();
    renderBills();
    saveState();
    if (!opts.skipCloudWrite) {
      queueCloudWrite();
    }
  }

  function findBill(id) {
    return state.bills.find(function (bill) {
      return bill.id === id;
    });
  }

  function removeBill(id) {
    var existing = findBill(id);
    if (!existing) return;
    state.bills = state.bills.filter(function (bill) {
      return bill.id !== id;
    });
    pushActivity('Removed "' + (existing.name || "bill") + '"');
    normalizeOrder();
    rerender();
  }

  function normalizeOrder() {
    getSortedBills().forEach(function (bill, index) {
      bill.order = index;
    });
  }

  function moveBill(id, step) {
    var bills = getSortedBills();
    var index = bills.findIndex(function (bill) {
      return bill.id === id;
    });
    if (index < 0) return;
    var target = index + step;
    if (target < 0 || target >= bills.length) return;
    var current = bills[index];
    bills[index] = bills[target];
    bills[target] = current;
    writeOrderFromList(
      bills.map(function (bill) {
        return bill.id;
      })
    );
    pushActivity('Reordered "' + (current.name || "bill") + '"');
    rerender();
  }

  function handleBillFieldUpdate(target) {
    var id = target.getAttribute("data-id");
    var field = target.getAttribute("data-field");
    if (!id || !field) return;
    var bill = findBill(id);
    if (!bill) return;

    if (field === "paid") {
      bill.paid = Boolean(target.checked);
      pushActivity((bill.paid ? "Marked paid: " : "Marked unpaid: ") + (bill.name || "bill"));
    } else if (field === "amount") {
      bill.amount = Math.max(0, safeNum(target.value));
    } else if (field === "dueDay") {
      var due = Math.round(safeNum(target.value));
      bill.dueDay = Math.min(31, Math.max(1, due || 1));
      target.value = String(bill.dueDay);
    } else if (field === "name") {
      bill.name = String(target.value || "").trim().slice(0, 60);
      target.value = bill.name;
    } else if (field === "type") {
      bill.type = String(target.value || "bill");
    }

    rerender();
  }

  function wireTabs() {
    document.querySelectorAll(".tab").forEach(function (button) {
      button.addEventListener("click", function () {
        var page = button.getAttribute("data-page");
        if (!page) return;
        setActivePage(page);
      });
    });
  }

  function wireDashboard() {
    var incomeInput = document.getElementById("monthly-income");
    incomeInput.value = String(state.monthlyIncome || "");
    incomeInput.addEventListener("change", function () {
      state.monthlyIncome = Math.max(0, safeNum(incomeInput.value));
      pushActivity("Updated monthly income");
      rerender();
    });

    document.getElementById("clear-activity").addEventListener("click", function () {
      state.activity = [];
      rerender();
    });

    var statusNode = document.getElementById("import-export-status");
    var fileInput = document.getElementById("import-file");
    var importTrigger = document.getElementById("import-file-trigger");

    function setImportExportStatus(message, isError) {
      if (!statusNode) return;
      statusNode.textContent = String(message || "");
      statusNode.style.color = isError ? "var(--danger)" : "var(--text-soft)";
    }

    function downloadFile(filename, content, mimeType) {
      var blob = new Blob([content], { type: mimeType });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    function csvEscape(value) {
      var text = String(value == null ? "" : value);
      if (/[",\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    }

    function toCsv(rows) {
      return rows
        .map(function (row) {
          return row.map(csvEscape).join(",");
        })
        .join("\n");
    }

    function parseCsvLine(line) {
      var values = [];
      var current = "";
      var inQuotes = false;
      for (var i = 0; i < line.length; i += 1) {
        var ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          values.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
      values.push(current);
      return values;
    }

    function fromCsv(text) {
      var lines = String(text || "")
        .replace(/\r/g, "")
        .split("\n")
        .filter(function (line) {
          return line.trim().length > 0;
        });
      if (lines.length <= 1) {
        return [];
      }

      var header = parseCsvLine(lines[0]).map(function (h) {
        return h.trim();
      });
      var indexOf = function (name) {
        return header.indexOf(name);
      };

      return lines.slice(1).map(function (line, lineIndex) {
        var cols = parseCsvLine(line);
        return {
          id: cols[indexOf("id")] || uid() + "-" + lineIndex,
          name: cols[indexOf("name")] || "Untitled",
          amount: Math.max(0, safeNum(cols[indexOf("amount")])),
          dueDay: Math.min(31, Math.max(1, Math.round(safeNum(cols[indexOf("dueDay")]) || 1))),
          type: cols[indexOf("type")] || "bill",
          paid: String(cols[indexOf("paid")] || "false").toLowerCase() === "true",
          order: Number.isFinite(Number(cols[indexOf("order")])) ? Number(cols[indexOf("order")]) : lineIndex,
        };
      });
    }

    document.getElementById("export-json").addEventListener("click", function () {
      var payload = buildSerializableState();
      downloadFile("norder-budget-export.json", JSON.stringify(payload, null, 2), "application/json");
      setImportExportStatus("Exported JSON backup.");
    });

    document.getElementById("export-csv").addEventListener("click", function () {
      var rows = [["id", "name", "amount", "dueDay", "type", "paid", "order"]];
      getSortedBills().forEach(function (bill) {
        rows.push([
          bill.id,
          bill.name,
          bill.amount,
          bill.dueDay,
          bill.type,
          bill.paid ? "true" : "false",
          bill.order,
        ]);
      });
      downloadFile("norder-budget-bills.csv", toCsv(rows), "text/csv;charset=utf-8");
      setImportExportStatus("Exported CSV backup.");
    });

    importTrigger.addEventListener("click", function () {
      fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var text = String(reader.result || "");
          var lowerName = String(file.name || "").toLowerCase();
          if (lowerName.endsWith(".json")) {
            var parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
              setStateFromPayload({
                monthlyIncome: state.monthlyIncome,
                bills: parsed,
                activity: state.activity,
                updatedAt: Date.now(),
              });
            } else {
              setStateFromPayload(parsed);
            }
            pushActivity("Imported JSON backup");
            rerender();
            setImportExportStatus("Imported JSON successfully.");
          } else {
            var csvBills = fromCsv(text);
            setStateFromPayload({
              monthlyIncome: state.monthlyIncome,
              bills: csvBills,
              activity: state.activity,
              updatedAt: Date.now(),
            });
            pushActivity("Imported CSV backup");
            rerender();
            setImportExportStatus("Imported CSV successfully.");
          }
        } catch (_error) {
          setImportExportStatus("Import failed. Use a valid JSON or CSV export file.", true);
        } finally {
          fileInput.value = "";
        }
      };
      reader.readAsText(file);
    });
  }

  function evaluateExpression(raw) {
    var expression = String(raw || "").trim();
    if (!expression) return 0;
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      throw new Error("Only numbers and + - * / ( ) are allowed.");
    }
    var result = Function("return (" + expression + ");")();
    var number = Number(result);
    if (!Number.isFinite(number)) throw new Error("Expression did not return a valid number.");
    return number;
  }

  function wireCalculator() {
    var expressionInput = document.getElementById("calc-expression");
    var resultNode = document.getElementById("calc-result");

    document.getElementById("calc-evaluate").addEventListener("click", function () {
      try {
        var value = evaluateExpression(expressionInput.value);
        resultNode.textContent = "Result: " + formatMoney(value);
      } catch (error) {
        resultNode.textContent = "Result: " + (error && error.message ? error.message : "Invalid expression");
      }
    });

    document.getElementById("percent-of").addEventListener("click", function () {
      var p = safeNum(document.getElementById("percent-value").value);
      var base = safeNum(document.getElementById("percent-base").value);
      var output = (p / 100) * base;
      document.getElementById("percent-of-result").textContent = p + "% of " + formatMoney(base) + " is " + formatMoney(output);
    });

    document.getElementById("adjust-add").addEventListener("click", function () {
      var base = safeNum(document.getElementById("adjust-base").value);
      var p = safeNum(document.getElementById("adjust-percent").value);
      var output = base * (1 + p / 100);
      document.getElementById("adjust-result").textContent = "Add " + p + "%: " + formatMoney(output);
    });

    document.getElementById("adjust-subtract").addEventListener("click", function () {
      var base = safeNum(document.getElementById("adjust-base").value);
      var p = safeNum(document.getElementById("adjust-percent").value);
      var output = base * (1 - p / 100);
      document.getElementById("adjust-result").textContent = "Subtract " + p + "%: " + formatMoney(output);
    });

    document.getElementById("ratio-solve").addEventListener("click", function () {
      var a = safeNum(document.getElementById("ratio-a").value);
      var b = safeNum(document.getElementById("ratio-b").value);
      if (!b) {
        document.getElementById("ratio-result").textContent = "B cannot be 0.";
        return;
      }
      var ratio = (a / b) * 100;
      document.getElementById("ratio-result").textContent = formatMoney(a) + " is " + ratio.toFixed(2) + "% of " + formatMoney(b);
    });
  }

  function wireBills() {
    var form = document.getElementById("bill-form");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var name = document.getElementById("bill-name").value.trim();
      var amount = Math.max(0, safeNum(document.getElementById("bill-amount").value));
      var dueDay = Math.round(safeNum(document.getElementById("bill-due-day").value));
      var type = document.getElementById("bill-type").value || "bill";
      if (!name || !amount || dueDay < 1 || dueDay > 31) return;

      state.bills.push({
        id: uid(),
        name: name,
        amount: amount,
        dueDay: dueDay,
        type: type,
        paid: false,
        order: state.bills.length,
      });
      pushActivity('Added "' + name + '" for ' + formatMoney(amount));
      form.reset();
      rerender();
    });

    document.getElementById("clear-bills").addEventListener("click", function () {
      if (!state.bills.length) return;
      state.bills = [];
      pushActivity("Cleared all bills");
      rerender();
    });

    var list = document.getElementById("bills-list");

    list.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-action]");
      if (!button) return;
      var id = button.getAttribute("data-id");
      var action = button.getAttribute("data-action");
      if (!id || !action) return;

      if (action === "remove") removeBill(id);
      if (action === "up") moveBill(id, -1);
      if (action === "down") moveBill(id, 1);
    });

    list.addEventListener("change", function (event) {
      var target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.getAttribute("data-field")) return;
      handleBillFieldUpdate(target);
    });

    var dragId = "";

    list.addEventListener("dragstart", function (event) {
      var item = event.target.closest(".bill-item");
      if (!item) return;
      dragId = item.getAttribute("data-id") || "";
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", dragId);
      }
    });

    list.addEventListener("dragover", function (event) {
      event.preventDefault();
      var item = event.target.closest(".bill-item");
      if (!item) return;
      list.querySelectorAll(".bill-item").forEach(function (row) {
        row.classList.remove("drag-over");
      });
      item.classList.add("drag-over");
    });

    list.addEventListener("drop", function (event) {
      event.preventDefault();
      var targetItem = event.target.closest(".bill-item");
      if (!targetItem) return;
      var dropId = targetItem.getAttribute("data-id") || "";
      list.querySelectorAll(".bill-item").forEach(function (row) {
        row.classList.remove("drag-over");
      });
      if (!dragId || !dropId || dragId === dropId) return;

      var ids = getSortedBills().map(function (bill) {
        return bill.id;
      });
      var from = ids.indexOf(dragId);
      var to = ids.indexOf(dropId);
      if (from < 0 || to < 0) return;
      var moved = ids.splice(from, 1)[0];
      ids.splice(to, 0, moved);
      writeOrderFromList(ids);
      var movedBill = findBill(dragId);
      pushActivity('Moved "' + ((movedBill && movedBill.name) || "bill") + '"');
      rerender();
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function initPageFromHash() {
    var hash = String(window.location.hash || "").replace(/^#/, "");
    if (hash === "dashboard" || hash === "calculator" || hash === "bills") {
      setActivePage(hash);
      return;
    }
    setActivePage("dashboard");
  }

  function init() {
    if (appBootstrapped) return;
    if (!canUseFirebaseSync()) {
      updateSyncStatus("Sync: connecting", "ok");
      return;
    }

    firebase.auth().onAuthStateChanged(function handleInitialAuth(user) {
      if (!user || !user.uid) {
        updateSyncStatus("Sync: sign in required", "error");
        redirectToLogin();
        return;
      }
      if (appBootstrapped) return;
      appBootstrapped = true;

      loadState();
      wireTabs();
      wireDashboard();
      wireCalculator();
      wireBills();
      wireFirebaseSync();
      initPageFromHash();
      rerender();
      window.addEventListener("hashchange", initPageFromHash);
    });
  }

  window.addEventListener("norder:budget-firebase-ready", init);
  init();
})();
