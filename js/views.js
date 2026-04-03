import { getHashParams } from "./router.js";
import { getState } from "./state.js";
import { clamp, escapeAttr, escapeHtml } from "./utils.js";

function navLink(route, label, activeRoute) {
  const active = activeRoute === route ? "active" : "";
  return `<a class="nav-link ${active}" href="#${route}">${label}</a>`;
}

function shellLayout(content, route) {
  const state = getState();
  const greeting = state.prefs.profile_name
    ? `Welcome, ${escapeHtml(state.prefs.profile_name)}`
    : "Inventory at a glance";

  return `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand">nORDER</div>
          <div class="muted">${greeting}</div>
        </div>
        <button id="quick-add" class="primary">Add Item</button>
      </header>
      <main class="page">${content}</main>
      <nav class="bottom-nav">
        <div class="bottom-nav-inner">
          ${navLink("/dashboard", "Home", route)}
          ${navLink("/inventory", "Items", route)}
          ${navLink("/shopping", "Shop", route)}
          ${navLink("/settings", "Settings", route)}
        </div>
      </nav>
    </div>
  `;
}

export function renderWelcome() {
  const state = getState();
  const profileValue = escapeHtml(state.prefs.profile_name || "");

  return `
    <div class="welcome">
      <section class="welcome-card">
        <h1>Welcome to nORDER</h1>
        <p class="muted">A simple home inventory app in plain HTML, CSS, and JavaScript.</p>
        <div class="grid">
          <label>
            <span class="help">Your name</span>
            <input id="welcome-name" value="${profileValue}" placeholder="e.g. Alex" maxlength="30" />
          </label>
          <label>
            <span class="help">Home name</span>
            <input id="welcome-home" value="${escapeHtml(state.prefs.home_name)}" maxlength="30" />
          </label>
          <button id="welcome-start" class="primary">Enter App</button>
          <button id="welcome-reset" class="ghost">Reset Sample Data</button>
        </div>
      </section>
    </div>
  `;
}

function computeStats() {
  const state = getState();
  const total = state.items.length;
  const low = state.items.filter((i) => Number(i.percentage) <= Number(i.low_threshold || 25)).length;
  const shopping = state.items.filter((i) => i.in_shopping_list).length;
  const expiring = state.items.filter((i) => {
    if (!i.expiry_date) return false;
    const date = new Date(i.expiry_date).getTime();
    const diffDays = (date - Date.now()) / 86400000;
    return diffDays >= 0 && diffDays <= 7;
  }).length;

  return { total, low, shopping, expiring };
}

export function renderDashboard() {
  const state = getState();
  const stats = computeStats();
  const lowItems = state.items
    .filter((i) => Number(i.percentage) <= Number(i.low_threshold || 25))
    .slice(0, 5);

  return shellLayout(
    `
    <section class="section-card">
      <h1>${escapeHtml(state.prefs.home_name)}</h1>
      <p class="muted">Keep your shelves in order.</p>
    </section>

    <section class="grid stats" style="margin-top:10px;">
      <article class="section-card"><div class="help">Total Items</div><h1>${stats.total}</h1></article>
      <article class="section-card"><div class="help">Shopping List</div><h1>${stats.shopping}</h1></article>
      <article class="section-card"><div class="help">Low Stock</div><h1 class="warning">${stats.low}</h1></article>
      <article class="section-card"><div class="help">Expiring Soon</div><h1>${stats.expiring}</h1></article>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <h2>Needs Attention</h2>
      <div class="list">
        ${
          lowItems.length
            ? lowItems
                .map(
                  (item) => `
                  <div class="row space">
                    <div>
                      <div class="item-name">${escapeHtml(item.name)}</div>
                      <div class="help">${escapeHtml(item.category)}</div>
                    </div>
                    <button data-action="add-to-shop" data-id="${item.id}">Add to List</button>
                  </div>
                `
                )
                .join("")
            : `<p class="help">No low-stock items right now.</p>`
        }
      </div>
    </section>
  `,
    "/dashboard"
  );
}

export function renderInventory() {
  const state = getState();
  const params = getHashParams();
  const query = (params.get("q") || "").toLowerCase();
  const filter = (params.get("cat") || "all").toLowerCase();

  const filtered = state.items.filter((item) => {
    const byText = !query || item.name.toLowerCase().includes(query);
    const byCat = filter === "all" || item.category.toLowerCase() === filter;
    return byText && byCat;
  });

  return shellLayout(
    `
    <section class="section-card">
      <div class="row space" style="margin-bottom:8px;">
        <h1>Inventory</h1>
        <button id="toggle-item-form">Add New</button>
      </div>
      <div class="toolbar">
        <input id="search-input" placeholder="Search items" value="${escapeHtml(query)}" />
        <select id="category-filter">
          <option value="all">All</option>
          ${state.categories
            .map(
              (c) =>
                `<option value="${escapeAttr(c.name.toLowerCase())}" ${
                  filter === c.name.toLowerCase() ? "selected" : ""
                }>${escapeHtml(c.name)}</option>`
            )
            .join("")}
        </select>
      </div>

      <div id="item-form" class="dialog">
        <div class="grid">
          <input id="item-name" placeholder="Item name" maxlength="50" />
          <select id="item-category">
            ${state.categories.map((c) => `<option>${escapeHtml(c.name)}</option>`).join("")}
          </select>
          <div class="row">
            <input id="item-stock" type="number" min="0" max="100" placeholder="Stock %" />
            <input id="item-threshold" type="number" min="0" max="100" placeholder="Low threshold %" />
          </div>
          <input id="item-expiry" type="date" />
          <button id="save-item" class="primary">Save Item</button>
        </div>
      </div>

      <div class="list" style="margin-top:10px;">
        ${
          filtered.length
            ? filtered
                .map(
                  (item) => `
                  <article class="item">
                    <div class="item-header">
                      <div>
                        <div class="item-name">${escapeHtml(item.name)}</div>
                        <div class="row">
                          <span class="badge">${escapeHtml(item.category)}</span>
                          <span class="help">${
                            item.expiry_date ? `Exp: ${escapeHtml(item.expiry_date)}` : "No expiry"
                          }</span>
                        </div>
                      </div>
                      <div class="row">
                        <button data-action="edit-item" data-id="${item.id}">Edit</button>
                        <button data-action="delete-item" class="danger" data-id="${item.id}">Delete</button>
                      </div>
                    </div>
                    <div class="progress"><span style="width:${clamp(item.percentage)}%"></span></div>
                    <div class="row space">
                      <span class="help">Stock: ${clamp(item.percentage)}%</span>
                      <button data-action="toggle-shopping" data-id="${item.id}">
                        ${item.in_shopping_list ? "Remove from List" : "Add to List"}
                      </button>
                    </div>
                  </article>
                `
                )
                .join("")
            : `<p class="help">No matching items.</p>`
        }
      </div>
    </section>
  `,
    "/inventory"
  );
}

export function renderShopping() {
  const state = getState();
  const items = state.items.filter((i) => i.in_shopping_list);

  return shellLayout(
    `
    <section class="section-card">
      <div class="row space" style="margin-bottom:8px;">
        <h1>Shopping</h1>
        <button id="restock-selected" class="primary">Restock Checked</button>
      </div>
      <p class="muted">Check items as you buy them.</p>

      <div class="list" style="margin-top:10px;">
        ${
          items.length
            ? items
                .map(
                  (item) => `
                  <article class="item row space">
                    <label class="row" style="flex:1;">
                      <input type="checkbox" data-role="buy-check" data-id="${item.id}" style="width:auto;" />
                      <span>
                        <strong>${escapeHtml(item.name)}</strong>
                        <span class="help"> ${escapeHtml(item.category)} | ${clamp(item.percentage)}%</span>
                      </span>
                    </label>
                    <button data-action="remove-shopping" data-id="${item.id}">Remove</button>
                  </article>
                `
                )
                .join("")
            : `<p class="help">Shopping list is empty.</p>`
        }
      </div>
    </section>
  `,
    "/shopping"
  );
}

export function renderSettings() {
  const state = getState();
  return shellLayout(
    `
    <section class="section-card">
      <h1>Settings</h1>
      <div class="grid" style="margin-top:10px;">
        <label>
          <span class="help">Profile name</span>
          <input id="prefs-profile" value="${escapeHtml(state.prefs.profile_name || "")}" maxlength="30" />
        </label>
        <label>
          <span class="help">Home name</span>
          <input id="prefs-home" value="${escapeHtml(state.prefs.home_name)}" maxlength="30" />
        </label>
        <div class="row">
          <label style="flex:1;">
            <span class="help">Theme</span>
            <select id="prefs-theme">
              ${["teal", "coral", "amber", "blue", "rose"]
                .map((t) => `<option value="${t}" ${state.prefs.theme === t ? "selected" : ""}>${t}</option>`)
                .join("")}
            </select>
          </label>
          <label style="flex:1;">
            <span class="help">Dark mode</span>
            <select id="prefs-dark">
              <option value="false" ${state.prefs.dark_mode ? "" : "selected"}>Off</option>
              <option value="true" ${state.prefs.dark_mode ? "selected" : ""}>On</option>
            </select>
          </label>
        </div>
        <button id="save-prefs" class="primary">Save Preferences</button>
      </div>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <div class="row space" style="margin-bottom:8px;">
        <h2 style="margin:0;">Categories</h2>
        <button id="add-category">Add Category</button>
      </div>
      <div class="list">
        ${
          state.categories.length
            ? state.categories
                .map(
                  (c) => `
                  <div class="row space">
                    <div><strong>${escapeHtml(c.name)}</strong> <span class="help">${escapeHtml(c.icon)}</span></div>
                    <button data-action="delete-category" data-id="${c.id}" class="danger">Delete</button>
                  </div>
                `
                )
                .join("")
            : `<p class="help">No categories yet.</p>`
        }
      </div>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <h2 style="margin:0 0 8px 0;">Collaboration</h2>
      <button id="view-collaboration-settings" class="primary">Manage Collaborators</button>
      <button id="switch-inventory" class="ghost" style="margin-left:8px;">Switch Inventory</button>
    </section>

    <section class="section-card" style="margin-top:10px;">
      <h2 style="margin:0 0 8px 0;">Data</h2>
      <button id="clear-data" class="danger">Clear Everything</button>
      <p class="help" style="margin-top:8px;">Removes all items, categories, and preferences.</p>
    </section>
  `,
    "/settings"
  );
}

export function renderLogin() {
  return `
    <div class="welcome">
      <section class="welcome-card">
        <h1>nORDER</h1>
        <p class="muted">Collaborative home inventory management</p>
        <div class="grid">
          <div id="login-form">
            <h2>Sign In</h2>
            <input id="login-email" type="email" placeholder="Email" maxlength="100" />
            <input id="login-password" type="password" placeholder="Password" />
            <label class="row" style="gap:8px;align-items:center;justify-content:flex-start;margin:2px 0 6px 0;">
              <input id="login-remember" type="checkbox" checked style="width:auto;" />
              <span class="help" style="margin:0;">Remember me on this device</span>
            </label>
            <button id="login-btn" class="primary">Sign In</button>
            <p class="help">
              No account yet?
              <a href="#" id="toggle-signup-btn" style="cursor:pointer;color:var(--primary);">Create one</a>
            </p>
            <div id="login-error" class="help" style="color:#f85b5b;"></div>
          </div>

          <div id="signup-form" style="display:none;">
            <h2>Create Account</h2>
            <input id="signup-name" type="text" placeholder="Your name" maxlength="50" />
            <input id="signup-email" type="email" placeholder="Email" maxlength="100" />
            <input id="signup-password" type="password" placeholder="Password" />
            <input id="signup-password-confirm" type="password" placeholder="Confirm password" />
            <button id="signup-btn" class="primary">Create Account</button>
            <p class="help">
              Already have an account?
              <a href="#" id="toggle-login-btn" style="cursor:pointer;color:var(--primary);">Sign in</a>
            </p>
            <div id="signup-error" class="help" style="color:#f85b5b;"></div>
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderMyInventories(inventories) {
  return `
    <div class="app-shell">
      <header class="topbar">
        <div>
          <div class="brand">nORDER</div>
          <div class="muted">My Inventories</div>
        </div>
        <button id="logout-btn" class="ghost">Logout</button>
      </header>
      <main class="page">
        <section class="section-card">
          <div class="row space" style="margin-bottom:8px;">
            <h1>My Inventories</h1>
            <button id="create-new-inventory">New Inventory</button>
          </div>
          <p class="muted">Select an inventory to manage or create a new shared one.</p>

          <div class="list" style="margin-top:10px;">
            ${
              inventories && Object.keys(inventories).length
                ? Object.entries(inventories)
                    .map(
                      ([id, inv]) => `
                  <div class="row space" style="padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
                    <div>
                      <strong>${escapeHtml(inv.name)}</strong>
                      <p class="help" style="margin:4px 0 0 0;">Role: <strong>${inv.role}</strong></p>
                      <p class="help" style="margin:2px 0;">Joined ${new Date(inv.joined_at).toLocaleDateString()}</p>
                    </div>
                    <button data-action="select-inventory" data-id="${id}" class="primary">Open</button>
                  </div>
                `
                    )
                    .join("")
                : `<p class="help">No inventories yet. Create one to get started!</p>`
            }
          </div>
        </section>

        <section class="section-card" style="margin-top:10px;">
          <h2>Join Shared Inventory</h2>
          <p class="muted">Already have an invite code?</p>
          <div class="grid">
            <input id="join-code-input" placeholder="Paste invitation code here" maxlength="10" />
            <button id="join-inventory-btn" class="primary">Join Inventory</button>
          </div>
          <div id="join-error" class="help" style="color:#f85b5b;margin-top:8px;"></div>
        </section>
      </main>
    </div>
  `;
}

export function renderCollaborationSettings(collaborators, inviteCodes, isOwner) {
  return `
    <section class="section-card" style="margin-top:10px;">
      <h2 style="margin:0 0 8px 0;">Collaborators</h2>
      <div class="list">
        ${
          collaborators && Object.keys(collaborators).length
            ? Object.entries(collaborators)
                .map(
                  ([userId, collab]) => `
                  <div class="row space">
                    <div>
                      <strong>${escapeHtml(collab.name)}</strong>
                      <p class="help" style="margin:2px 0;">${collab.role === "admin" ? "👑 Admin" : "Member"} • Joined ${new Date(collab.joined_at).toLocaleDateString()}</p>
                    </div>
                    ${isOwner ? `<button data-action="remove-collaborator" data-id="${userId}" class="danger">Remove</button>` : ""}
                  </div>
                `
                )
                .join("")
            : `<p class="help">No collaborators yet.</p>`
        }
      </div>
    </section>

    ${
      isOwner
        ? `
    <section class="section-card" style="margin-top:10px;">
      <div class="row space" style="margin-bottom:8px;">
        <h2 style="margin:0;">Invite Codes</h2>
        <button id="generate-new-code" class="primary">Generate Code</button>
      </div>
      <p class="muted">Share these codes to invite people to this inventory.</p>
      <div class="list" style="margin-top:10px;">
        ${
          inviteCodes && Object.keys(inviteCodes).length
            ? Object.entries(inviteCodes)
                .map(
                  ([code, codeData]) => `
                  <div class="row space" style="background:#f5f5f5;padding:8px;border-radius:4px;margin-bottom:8px;">
                    <div>
                      <code style="font-weight:600;font-size:16px;letter-spacing:2px;">${code}</code>
                      <p class="help" style="margin:4px 0 0 0;">Used ${codeData.uses || 0} time${codeData.uses === 1 ? "" : "s"}</p>
                    </div>
                    <button data-action="delete-invite-code" data-code="${code}" class="danger">Delete</button>
                  </div>
                `
                )
                .join("")
            : `<p class="help">No invite codes yet. Generate one to start sharing.</p>`
        }
      </div>
    </section>
    `
        : ""
    }
  `;
}
