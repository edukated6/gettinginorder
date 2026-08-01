(function () {
  "use strict";

  var STORAGE_KEY_BASE = "norder_budget_tool_v1";
  var activeStorageKey = STORAGE_KEY_BASE + "::guest";
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
  var BUDGET_ACTIVE_PAGE_KEY = "norder_budget_active_page";
  var state = {
    activePage: "dashboard",
    monthlyIncome: 0,
    incomes: [],
    bills: [],
    activity: [],
    periodMonth: "",
    updatedAt: 0,
  };

  function getScopedStorageKey(user) {
    var uidValue = user && user.uid ? String(user.uid).trim() : "";
    return uidValue ? STORAGE_KEY_BASE + "::uid::" + uidValue : STORAGE_KEY_BASE + "::guest";
  }

  function clearBudgetState() {
    state.monthlyIncome = 0;
    state.incomes = [];
    state.bills = [];
    state.activity = [];
    state.periodMonth = "";
    state.updatedAt = 0;
  }

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

  function getMonthKey(date) {
    var current = date instanceof Date ? date : new Date();
    return current.getFullYear() + "-" + String(current.getMonth() + 1).padStart(2, "0");
  }

  function normalizeBudgetShape(input) {
    var source = input && typeof input === "object" ? input : {};
    var legacyIncome = Math.max(0, safeNum(source.monthlyIncome));
    var normalized = {
      monthlyIncome: legacyIncome,
      incomes: Array.isArray(source.incomes) ? source.incomes : [],
      bills: Array.isArray(source.bills) ? source.bills : [],
      activity: Array.isArray(source.activity) ? source.activity : [],
      periodMonth: String(source.periodMonth || "").trim(),
      updatedAt: safeNum(source.updatedAt),
    };

    normalized.incomes = normalized.incomes
      .map(function (income, index) {
        var name = String((income && income.name) || "").trim().slice(0, 60) || "Income " + (index + 1);
        return {
          id: String((income && income.id) || uid()),
          name: name,
          amount: Math.max(0, safeNum(income && income.amount)),
          order: Number.isFinite(Number(income && income.order)) ? Number(income.order) : index,
        };
      })
      .filter(function (income) {
        return income.amount > 0 || income.name;
      });

    if (!normalized.incomes.length && legacyIncome > 0) {
      normalized.incomes = [{ id: uid(), name: "Primary income", amount: legacyIncome, order: 0 }];
    }

    normalized.monthlyIncome = normalized.incomes.reduce(function (sum, income) {
      return sum + Math.max(0, safeNum(income.amount));
    }, 0);

    normalized.bills = normalized.bills.map(function (bill, index) {
      var safeName = String((bill && bill.name) || "").trim().slice(0, 60) || "Untitled";
      var safeType = String((bill && bill.type) || "bill").trim() || "bill";
      return {
        id: String((bill && bill.id) || uid()),
        name: safeName,
        amount: Math.max(0, safeNum(bill && bill.amount)),
        dueDay: Math.min(31, Math.max(1, Math.round(safeNum(bill && bill.dueDay) || 1))),
        type: safeType,
        active: bill && Object.prototype.hasOwnProperty.call(bill, "active") ? Boolean(bill.active) : true,
        paid: Boolean(bill && bill.paid),
        recurringMonthly: bill && Object.prototype.hasOwnProperty.call(bill, "recurringMonthly") ? Boolean(bill.recurringMonthly) : true,
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
    state.incomes = normalized.incomes;
    state.bills = normalized.bills;
    state.activity = normalized.activity;
    state.periodMonth = normalized.periodMonth;
    state.updatedAt = normalized.updatedAt || Date.now();
    if (!opts.skipRender) {
      rerender(opts);
    }
  }

  function buildSerializableState() {
    return {
      monthlyIncome: state.monthlyIncome,
      incomes: state.incomes,
      bills: state.bills,
      activity: state.activity,
      periodMonth: state.periodMonth || getMonthKey(),
      updatedAt: state.updatedAt || Date.now(),
    };
  }

  function applyMonthlyRollOver() {
    var currentMonth = getMonthKey();
    if (!state.periodMonth) {
      state.periodMonth = currentMonth;
      return;
    }
    if (state.periodMonth === currentMonth) {
      return;
    }

    var resetRecurringCount = 0;
    var archivedOneTimeCount = 0;

    state.bills.forEach(function (bill) {
      if (bill.recurringMonthly === false) {
        if (bill.active !== false && bill.paid) {
          bill.active = false;
          archivedOneTimeCount += 1;
        }
        return;
      }

      if (bill.paid) {
        bill.paid = false;
        resetRecurringCount += 1;
      }
    });

    state.periodMonth = currentMonth;
    if (resetRecurringCount || archivedOneTimeCount) {
      pushActivity(
        "New month rollover: reset " +
          resetRecurringCount +
          " recurring item" +
          (resetRecurringCount === 1 ? "" : "s") +
          ", archived " +
          archivedOneTimeCount +
          " one-time item" +
          (archivedOneTimeCount === 1 ? "" : "s")
      );
    }
  }

  function getSortedIncomes() {
    return state.incomes.slice().sort(function (a, b) {
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });
  }

  function syncMonthlyIncomeFromIncomes() {
    state.monthlyIncome = getSortedIncomes().reduce(function (sum, income) {
      return sum + Math.max(0, safeNum(income.amount));
    }, 0);
  }

  function findIncome(id) {
    return state.incomes.find(function (income) {
      return income.id === id;
    });
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(activeStorageKey);
      if (!raw) return;
      setStateFromPayload(JSON.parse(raw), { skipRender: true });
    } catch (_error) {
      // Ignore storage issues and continue with defaults.
    }
  }

  function saveState() {
    localStorage.setItem(activeStorageKey, JSON.stringify(buildSerializableState()));
  }

  function applyScopedLocalStateForUser(user, options) {
    var opts = options || {};
    var nextStorageKey = getScopedStorageKey(user);
    if (!opts.force && nextStorageKey === activeStorageKey) {
      return false;
    }

    activeStorageKey = nextStorageKey;
    clearBudgetState();
    loadState();
    applyMonthlyRollOver();
    return true;
  }

  function pushActivity(message) {
    state.activity.unshift({ id: uid(), message: String(message || "Updated budget"), time: nowIso() });
    state.activity = state.activity.slice(0, MAX_ACTIVITY);
  }

  function hasBudgetContent() {
    return Boolean(
      state.monthlyIncome > 0 ||
        state.incomes.length ||
        state.bills.length ||
        state.activity.length
    );
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
    var next = encodeURIComponent("/budget.html");
    window.location.href = "/#/login?next=" + next;
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
    if (cloudSync.writeTimer) {
      clearTimeout(cloudSync.writeTimer);
      cloudSync.writeTimer = null;
    }
    if (cloudSync.ref && cloudSync.uid) {
      cloudSync.ref.off();
    }
    cloudSync.uid = "";
    cloudSync.ref = null;
    cloudSync.hasLoadedRemote = false;
  }

  function queueCloudWrite() {
    if (!cloudSync.uid || !cloudSync.ref || cloudSync.isApplyingRemote) return;
    if (!cloudSync.hasLoadedRemote) return;
    if (cloudSync.writeTimer) {
      clearTimeout(cloudSync.writeTimer);
    }
    cloudSync.writeTimer = setTimeout(function () {
      cloudSync.writeTimer = null;
      if (!cloudSync.uid || !cloudSync.ref) return;
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
      if (hasBudgetContent()) {
        queueCloudWrite();
      }
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
      var switched = applyScopedLocalStateForUser(user);
      connectCloudForUser(user);
      if (switched) {
        rerender({ skipCloudWrite: true });
      }
    });
  }

  function getSortedBills(options) {
    var opts = options || {};
    var includeInactive = Boolean(opts.includeInactive);
    var source = includeInactive
      ? state.bills
      : state.bills.filter(function (bill) {
          return bill.active !== false;
        });
    return source.slice().sort(function (a, b) {
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });
  }

  function getBillsForZone(isActive) {
    var activeValue = Boolean(isActive);
    return getSortedBills({ includeInactive: true }).filter(function (bill) {
      return Boolean(bill.active !== false) === activeValue;
    });
  }

  function normalizeOrderForZone(isActive) {
    getBillsForZone(isActive).forEach(function (bill, index) {
      bill.order = index;
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
      return bill.active !== false && !bill.paid && Number.isFinite(due) && due >= day && due <= maxDay;
    }).length;
  }

  function getPlannerMonthlyTotal() {
    return getSortedBills().reduce(function (sum, bill) {
      return sum + Math.max(0, safeNum(bill.amount));
    }, 0);
  }

  function getIncomeMonthlyTotal() {
    syncMonthlyIncomeFromIncomes();
    return state.monthlyIncome;
  }

  function stats() {
    var total = getPlannerMonthlyTotal();
    var services = state.bills.filter(function (bill) {
      return bill.active !== false && (bill.type === "service" || bill.type === "subscription");
    }).length;
    return {
      totalExpenses: total,
      servicesCount: services,
      remaining: getIncomeMonthlyTotal() - total,
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

    state.bills
      .filter(function (bill) {
        return bill.active !== false;
      })
      .forEach(function (bill) {
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
    try {
      sessionStorage.setItem(BUDGET_ACTIVE_PAGE_KEY, page);
    } catch (_error) {
      // Ignore storage errors and keep in-memory routing only.
    }
  }

  function renderDashboard() {
    var computed = stats();
    var incomeTotal = getIncomeMonthlyTotal();
    document.getElementById("stat-expenses").textContent = formatMoney(computed.totalExpenses);
    document.getElementById("stat-services").textContent = String(computed.servicesCount);
    document.getElementById("stat-remaining").textContent = formatMoney(computed.remaining);
    document.getElementById("stat-due-soon").textContent = String(computed.dueSoon);

    var incomeTotalNode = document.getElementById("monthly-income-total");
    if (incomeTotalNode) {
      incomeTotalNode.textContent = formatMoney(incomeTotal);
    }

    var incomeList = document.getElementById("income-list");
    if (incomeList) {
      var incomes = getSortedIncomes();
      if (!incomes.length) {
        incomeList.innerHTML = '<li class="income-item income-empty">Add one or more income sources to build your monthly total.</li>';
      } else {
        incomeList.innerHTML = incomes
          .map(function (income) {
            return (
              '<li class="income-item" data-id="' +
              escapeAttr(income.id) +
              '">' +
              '<div class="income-main">' +
              '<input class="income-name" data-field="name" data-id="' +
              escapeAttr(income.id) +
              '" type="text" maxlength="60" value="' +
              escapeAttr(income.name || "") +
              '" aria-label="Income name" />' +
              '<input class="income-amount" data-field="amount" data-id="' +
              escapeAttr(income.id) +
              '" type="number" min="0" step="0.01" value="' +
              escapeAttr(String(Math.max(0, safeNum(income.amount)))) +
              '" aria-label="Income amount" />' +
              '</div>' +
              '<button type="button" class="ghost income-remove" data-action="remove-income" data-id="' +
              escapeAttr(income.id) +
              '">Remove</button>' +
              '</li>'
            );
          })
          .join("");
      }
    }

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

  function renderBillRows(bills) {
    return bills
      .map(function (bill) {
        return (
          '<li class="bill-item ' +
          (bill.active === false ? "is-inactive" : "") +
          '" draggable="true" data-id="' +
          escapeAttr(bill.id) +
          '" data-zone="' +
          (bill.active === false ? "inactive" : "active") +
          '">' +
          '<div class="bill-main">' +
          '<span class="drag-handle" title="Drag to move between Active/Inactive" aria-hidden="true">::</span>' +
          '<button type="button" class="bill-open" data-action="edit" data-id="' +
          escapeAttr(bill.id) +
          '">' +
          '<span class="bill-open-title">' +
          escapeHtml(bill.name || "Untitled") +
          "</span>" +
          '<span class="bill-open-meta">' +
          escapeHtml(formatMoney(safeNum(bill.amount))) +
          " · Due day " +
          escapeHtml(String(Math.min(31, Math.max(1, safeNum(bill.dueDay) || 1)))) +
          "</span>" +
          '<span class="bill-badge-row">' +
          '<span class="bill-badge">' +
          escapeHtml(capitalize(bill.type || "bill")) +
          "</span>" +
          '<span class="bill-badge">' +
          (bill.recurringMonthly === false ? "One-time" : "Monthly") +
          "</span>" +
          '<span class="bill-badge">' +
          (bill.paid ? "Paid" : "Unpaid") +
          "</span>" +
          "</span>" +
          "</button>" +
          '<div class="bill-actions">' +
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

  function renderBills() {
    var activeList = document.getElementById("bills-active-list");
    var inactiveList = document.getElementById("bills-inactive-list");
    if (!activeList || !inactiveList) return;

    var activeBills = getBillsForZone(true);
    var inactiveBills = getBillsForZone(false);

    activeList.innerHTML = activeBills.length
      ? renderBillRows(activeBills)
      : '<li class="bill-item">No active monthly bills. Drag items here to include them.</li>';

    inactiveList.innerHTML = inactiveBills.length
      ? renderBillRows(inactiveBills)
      : '<li class="bill-item">No inactive bills. Drag an active item here to pause it.</li>';
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
    syncMonthlyIncomeFromIncomes();
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

  function handleIncomeFieldUpdate(target) {
    var id = target.getAttribute("data-id");
    var field = target.getAttribute("data-field");
    if (!id || !field) return;
    var income = findIncome(id);
    if (!income) return;

    if (field === "name") {
      income.name = String(target.value || "").trim().slice(0, 60) || income.name;
      target.value = income.name;
    } else if (field === "amount") {
      income.amount = Math.max(0, safeNum(target.value));
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
    var incomeForm = document.getElementById("income-form");
    var incomeNameInput = document.getElementById("income-name");
    var incomeAmountInput = document.getElementById("income-amount");
    var incomeList = document.getElementById("income-list");

    incomeForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var name = String(incomeNameInput.value || "").trim().slice(0, 60);
      var amount = Math.max(0, safeNum(incomeAmountInput.value));
      if (!name || !amount) return;

      state.incomes.push({
        id: uid(),
        name: name,
        amount: amount,
        order: getSortedIncomes().length,
      });
      incomeForm.reset();
      pushActivity('Added income "' + name + '"');
      rerender();
    });

    if (incomeList) {
      incomeList.addEventListener("change", function (event) {
        var target = event.target.closest("[data-field]");
        if (!target || target.getAttribute("data-id") == null) return;
        handleIncomeFieldUpdate(target);
      });

      incomeList.addEventListener("click", function (event) {
        var actionNode = event.target.closest("[data-action='remove-income']");
        if (!actionNode) return;
        var id = actionNode.getAttribute("data-id");
        var income = findIncome(id);
        if (!income) return;
        state.incomes = state.incomes.filter(function (entry) {
          return entry.id !== id;
        });
        pushActivity('Removed income "' + (income.name || "income") + '"');
        rerender();
      });
    }

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

      var activeIndex = indexOf("active");
      var recurringIndex = indexOf("recurringMonthly");

      return lines.slice(1).map(function (line, lineIndex) {
        var cols = parseCsvLine(line);
        return {
          id: cols[indexOf("id")] || uid() + "-" + lineIndex,
          name: cols[indexOf("name")] || "Untitled",
          amount: Math.max(0, safeNum(cols[indexOf("amount")])),
          dueDay: Math.min(31, Math.max(1, Math.round(safeNum(cols[indexOf("dueDay")]) || 1))),
          type: cols[indexOf("type")] || "bill",
          active: activeIndex >= 0 ? String(cols[activeIndex] || "true").toLowerCase() === "true" : true,
          paid: String(cols[indexOf("paid")] || "false").toLowerCase() === "true",
          recurringMonthly: recurringIndex >= 0 ? String(cols[recurringIndex] || "true").toLowerCase() === "true" : true,
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
      var rows = [["id", "name", "amount", "dueDay", "type", "active", "paid", "recurringMonthly", "order"]];
      getSortedBills({ includeInactive: true }).forEach(function (bill) {
        rows.push([
          bill.id,
          bill.name,
          bill.amount,
          bill.dueDay,
          bill.type,
          bill.active === false ? "false" : "true",
          bill.paid ? "true" : "false",
          bill.recurringMonthly === false ? "false" : "true",
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
                incomes: state.incomes,
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
              incomes: state.incomes,
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
      var recurringMonthly = Boolean(document.getElementById("bill-recurring") && document.getElementById("bill-recurring").checked);
      if (!name || !amount || dueDay < 1 || dueDay > 31) return;

      state.bills.push({
        id: uid(),
        name: name,
        amount: amount,
        dueDay: dueDay,
        type: type,
        active: true,
        paid: false,
        recurringMonthly: recurringMonthly,
        order: getBillsForZone(true).length,
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

    var board = document.getElementById("bills-board");
    if (!board) return;

    var editorModal = document.getElementById("bill-editor-modal");
    var editorForm = document.getElementById("bill-editor-form");
    var editName = document.getElementById("edit-bill-name");
    var editAmount = document.getElementById("edit-bill-amount");
    var editDueDay = document.getElementById("edit-bill-due-day");
    var editType = document.getElementById("edit-bill-type");
    var editPaid = document.getElementById("edit-bill-paid");
    var editActive = document.getElementById("edit-bill-active");
    var editRecurring = document.getElementById("edit-bill-recurring");
    var editorCurrentId = "";

    function closeBillEditor() {
      if (!editorModal) return;
      editorModal.hidden = true;
      editorCurrentId = "";
    }

    function openBillEditor(id) {
      var bill = findBill(id);
      if (!bill || !editorModal) return;
      editorCurrentId = id;
      if (editName) editName.value = String(bill.name || "");
      if (editAmount) editAmount.value = String(Math.max(0, safeNum(bill.amount)));
      if (editDueDay) editDueDay.value = String(Math.min(31, Math.max(1, safeNum(bill.dueDay) || 1)));
      if (editType) editType.value = String(bill.type || "bill");
      if (editPaid) editPaid.checked = Boolean(bill.paid);
      if (editActive) editActive.checked = bill.active !== false;
      if (editRecurring) editRecurring.checked = bill.recurringMonthly !== false;
      editorModal.hidden = false;
      if (editName) {
        setTimeout(function () {
          editName.focus();
          editName.select();
        }, 0);
      }
    }

    if (editorForm) {
      editorForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!editorCurrentId) return;
        var bill = findBill(editorCurrentId);
        if (!bill) {
          closeBillEditor();
          return;
        }

        var nextName = String((editName && editName.value) || "").trim().slice(0, 60);
        var nextAmount = Math.max(0, safeNum(editAmount && editAmount.value));
        var nextDueDay = Math.round(safeNum(editDueDay && editDueDay.value));
        var nextType = String((editType && editType.value) || "bill");
        var nextPaid = Boolean(editPaid && editPaid.checked);
        var nextActive = Boolean(editActive && editActive.checked);
        var nextRecurring = Boolean(editRecurring && editRecurring.checked);

        if (!nextName || nextDueDay < 1 || nextDueDay > 31) {
          return;
        }

        var previousName = bill.name || "bill";
        var previousActive = bill.active !== false;
        bill.name = nextName;
        bill.amount = nextAmount;
        bill.dueDay = nextDueDay;
        bill.type = nextType;
        bill.paid = nextPaid;
        bill.active = nextActive;
        bill.recurringMonthly = nextRecurring;

        if (previousActive !== nextActive) {
          bill.order = Number.MAX_SAFE_INTEGER;
          normalizeOrderForZone(true);
          normalizeOrderForZone(false);
          pushActivity((nextActive ? "Activated monthly: " : "Moved to inactive: ") + (bill.name || previousName));
        } else {
          pushActivity('Updated "' + (bill.name || previousName) + '"');
        }

        closeBillEditor();
        rerender();
      });
    }

    var closeEditorButton = document.getElementById("bill-editor-close");
    if (closeEditorButton) {
      closeEditorButton.addEventListener("click", closeBillEditor);
    }

    var cancelEditorButton = document.getElementById("bill-editor-cancel");
    if (cancelEditorButton) {
      cancelEditorButton.addEventListener("click", closeBillEditor);
    }

    if (editorModal) {
      editorModal.addEventListener("click", function (event) {
        var actionNode = event.target.closest("[data-action='close-editor']");
        if (actionNode) {
          closeBillEditor();
        }
      });
    }

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && editorModal && !editorModal.hidden) {
        closeBillEditor();
      }
    });

    board.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-action]");
      if (!button) return;
      var id = button.getAttribute("data-id");
      var action = button.getAttribute("data-action");
      if (!id || !action) return;

      if (action === "edit") openBillEditor(id);
      if (action === "remove") removeBill(id);
    });

    var dragId = "";
    var touchDrag = {
      active: false,
      pointerId: -1,
      id: "",
      zoneName: "",
      dropId: "",
      ghost: null,
      sourceItem: null,
    };

    function clearDragState() {
      board.querySelectorAll(".bill-item").forEach(function (row) {
        row.classList.remove("drag-over");
      });
      board.querySelectorAll(".bills-zone-list").forEach(function (zone) {
        zone.classList.remove("drag-over-zone");
      });
    }

    function applyDropById(movedId, zoneName, dropId) {
      if (!movedId || !zoneName) return false;
      var targetIsActive = zoneName === "active";
      var movedBill = findBill(movedId);
      if (!movedBill) return false;

      var previousActive = movedBill.active !== false;
      movedBill.active = targetIsActive;

      var ids = getBillsForZone(targetIsActive)
        .map(function (bill) {
          return bill.id;
        })
        .filter(function (id) {
          return id !== movedId;
        });

      if (dropId) {
        var insertAt = ids.indexOf(dropId);
        if (insertAt >= 0) {
          ids.splice(insertAt, 0, movedId);
        } else {
          ids.push(movedId);
        }
      } else {
        ids.push(movedId);
      }

      writeOrderFromList(ids);
      normalizeOrderForZone(true);
      normalizeOrderForZone(false);

      if (previousActive !== targetIsActive) {
        pushActivity((targetIsActive ? "Activated monthly: " : "Moved to inactive: ") + (movedBill.name || "bill"));
      } else {
        pushActivity('Reordered "' + (movedBill.name || "bill") + '"');
      }

      rerender();
      return true;
    }

    function updateTouchHover(clientX, clientY) {
      clearDragState();
      var hit = document.elementFromPoint(clientX, clientY);
      if (!hit) {
        touchDrag.zoneName = "";
        touchDrag.dropId = "";
        return;
      }
      var zone = hit.closest(".bills-zone-list");
      if (!zone) {
        touchDrag.zoneName = "";
        touchDrag.dropId = "";
        return;
      }

      zone.classList.add("drag-over-zone");
      touchDrag.zoneName = zone.getAttribute("data-zone") || "active";

      var item = hit.closest(".bill-item");
      var itemId = item ? item.getAttribute("data-id") || "" : "";
      if (item && itemId && itemId !== touchDrag.id) {
        item.classList.add("drag-over");
        touchDrag.dropId = itemId;
      } else {
        touchDrag.dropId = "";
      }
    }

    function endTouchDrag(cancelled) {
      if (!touchDrag.active) return;
      if (touchDrag.ghost && touchDrag.ghost.parentNode) {
        touchDrag.ghost.parentNode.removeChild(touchDrag.ghost);
      }
      if (touchDrag.sourceItem) {
        touchDrag.sourceItem.classList.remove("touch-dragging");
      }

      var movedId = touchDrag.id;
      var zoneName = touchDrag.zoneName;
      var dropId = touchDrag.dropId;

      touchDrag.active = false;
      touchDrag.pointerId = -1;
      touchDrag.id = "";
      touchDrag.zoneName = "";
      touchDrag.dropId = "";
      touchDrag.ghost = null;
      touchDrag.sourceItem = null;
      clearDragState();

      if (!cancelled) {
        applyDropById(movedId, zoneName, dropId);
      }
    }

    board.addEventListener("dragstart", function (event) {
      var item = event.target.closest(".bill-item");
      if (!item) return;
      dragId = item.getAttribute("data-id") || "";
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", dragId);
      }
    });

    board.addEventListener("dragover", function (event) {
      event.preventDefault();
      clearDragState();
      var zone = event.target.closest(".bills-zone-list");
      if (!zone) return;
      zone.classList.add("drag-over-zone");
      var item = event.target.closest(".bill-item");
      if (!item) return;
      item.classList.add("drag-over");
    });

    board.addEventListener("drop", function (event) {
      event.preventDefault();
      var zone = event.target.closest(".bills-zone-list");
      if (!zone) return;
      var zoneName = zone.getAttribute("data-zone") || "active";
      var targetItem = event.target.closest(".bill-item");
      clearDragState();
      if (!dragId) return;
      var dropId = targetItem ? targetItem.getAttribute("data-id") || "" : "";
      applyDropById(dragId, zoneName, dropId);
      dragId = "";
    });

    board.addEventListener("dragend", function () {
      clearDragState();
      dragId = "";
    });

    board.addEventListener("pointerdown", function (event) {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      var handle = event.target.closest(".drag-handle");
      if (!handle) return;

      var item = handle.closest(".bill-item");
      if (!item) return;
      var id = item.getAttribute("data-id") || "";
      if (!id) return;

      event.preventDefault();
      touchDrag.active = true;
      touchDrag.pointerId = event.pointerId;
      touchDrag.id = id;
      touchDrag.zoneName = item.getAttribute("data-zone") || "";
      touchDrag.dropId = "";
      touchDrag.sourceItem = item;
      item.classList.add("touch-dragging");

      var ghost = item.cloneNode(true);
      ghost.classList.add("touch-drag-ghost");
      ghost.style.left = event.clientX + "px";
      ghost.style.top = event.clientY + "px";
      document.body.appendChild(ghost);
      touchDrag.ghost = ghost;

      updateTouchHover(event.clientX, event.clientY);
    });

    board.addEventListener("pointermove", function (event) {
      if (!touchDrag.active || event.pointerId !== touchDrag.pointerId) return;
      event.preventDefault();
      if (touchDrag.ghost) {
        touchDrag.ghost.style.left = event.clientX + "px";
        touchDrag.ghost.style.top = event.clientY + "px";
      }
      updateTouchHover(event.clientX, event.clientY);
    });

    board.addEventListener("pointerup", function (event) {
      if (!touchDrag.active || event.pointerId !== touchDrag.pointerId) return;
      event.preventDefault();
      endTouchDrag(false);
    });

    board.addEventListener("pointercancel", function (event) {
      if (!touchDrag.active || event.pointerId !== touchDrag.pointerId) return;
      endTouchDrag(true);
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

  function clearBudgetHashFromUrl() {
    if (!window.history || !window.history.replaceState) return;
    if (window.location.pathname === "/budget.html" && !window.location.hash) return;
    window.history.replaceState(null, "", "/budget.html");
  }

  function readSavedBudgetPage() {
    try {
      var saved = String(sessionStorage.getItem(BUDGET_ACTIVE_PAGE_KEY) || "").trim();
      if (saved === "dashboard" || saved === "calculator" || saved === "bills") {
        return saved;
      }
    } catch (_error) {
      // Ignore storage errors and fall back to defaults.
    }
    return "dashboard";
  }

  function initPageFromHash() {
    var hash = String(window.location.hash || "").replace(/^#/, "");
    if (hash === "dashboard" || hash === "calculator" || hash === "bills") {
      setActivePage(hash);
      clearBudgetHashFromUrl();
      return;
    }

    setActivePage(readSavedBudgetPage());
    clearBudgetHashFromUrl();
  }

  function init() {
    if (!appBootstrapped) {
      initPageFromHash();
      wireTabs();
      wireDashboard();
      wireCalculator();
      wireBills();
      if (canUseFirebaseSync()) {
        clearBudgetState();
      } else {
        applyScopedLocalStateForUser(null, { force: true });
      }
      rerender();
      appBootstrapped = true;
    }

    if (!canUseFirebaseSync()) {
      updateSyncStatus("Sync: local only", "ok");
      return;
    }

    wireFirebaseSync();
    var currentUser = firebase.auth().currentUser;
    applyScopedLocalStateForUser(currentUser, { force: true });
    connectCloudForUser(currentUser);
    rerender({ skipCloudWrite: true });
  }

  window.addEventListener("norder:budget-firebase-ready", init);
  init();
})();
