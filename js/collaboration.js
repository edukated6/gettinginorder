/*
  collaboration.js
  Purpose:
  - Firebase Realtime Database access layer for shared inventories.
  - Handles invite codes, collaborators, activity logs, and sync helpers.
*/

import { getCurrentUser } from "./auth.js";

const COLLABORATORS_KEY = "collaborators";
const INVITE_CODES_KEY = "invite_codes";
const DEFAULT_ITEM_TOMBSTONE_RETENTION_DAYS = 30;
const MIN_ITEM_TOMBSTONE_RETENTION_DAYS = 1;
const MAX_ITEM_TOMBSTONE_RETENTION_DAYS = 365;

function isPermissionDeniedError(error) {
  const code = String((error && error.code) || "").toUpperCase();
  const msg = String((error && error.message) || error || "");
  return code.includes("PERMISSION_DENIED") || /permission|denied/i.test(msg);
}

// Generate a random 6-character invite code
function generateInviteCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function normalizeInviteCode(inviteCode) {
  return String(inviteCode || "").trim().toUpperCase();
}

function toFiniteTimestamp(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeItem(item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id || "").trim();
  if (!id) return null;
  return { ...item, id };
}

function normalizeTombstones(value) {
  if (!value || typeof value !== "object") return {};
  const next = {};
  Object.entries(value).forEach(([id, timestamp]) => {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) return;
    const ts = toFiniteTimestamp(timestamp);
    if (!ts) return;
    next[normalizedId] = ts;
  });
  return next;
}

function mergeItemTombstones(currentTombstones, incomingTombstones) {
  const merged = { ...normalizeTombstones(currentTombstones) };
  const incoming = normalizeTombstones(incomingTombstones);
  Object.entries(incoming).forEach(([id, ts]) => {
    const existing = toFiniteTimestamp(merged[id]);
    merged[id] = Math.max(existing, ts);
  });
  return merged;
}

function normalizeRetentionDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ITEM_TOMBSTONE_RETENTION_DAYS;
  return Math.min(MAX_ITEM_TOMBSTONE_RETENTION_DAYS, Math.max(MIN_ITEM_TOMBSTONE_RETENTION_DAYS, Math.round(parsed)));
}

function retentionDaysToMs(days) {
  return normalizeRetentionDays(days) * 24 * 60 * 60 * 1000;
}

function pruneItemTombstones(tombstones, items, retentionDays, nowTs = Date.now()) {
  const cutoffTs = toFiniteTimestamp(nowTs) - retentionDaysToMs(retentionDays);
  const next = normalizeTombstones(tombstones);
  const latestItemTsById = new Map();

  toArray(items)
    .map(normalizeItem)
    .filter(Boolean)
    .forEach((item) => {
      const updatedTs = toFiniteTimestamp(item.updated_date);
      const existing = toFiniteTimestamp(latestItemTsById.get(item.id));
      latestItemTsById.set(item.id, Math.max(existing, updatedTs));
    });

  Object.entries(next).forEach(([id, tombstoneTs]) => {
    const normalizedTombstoneTs = toFiniteTimestamp(tombstoneTs);
    if (normalizedTombstoneTs <= cutoffTs) {
      delete next[id];
      return;
    }

    const latestItemTs = toFiniteTimestamp(latestItemTsById.get(id));
    if (latestItemTs > normalizedTombstoneTs) {
      delete next[id];
    }
  });

  return next;
}

function mergeInventoryItems(currentItems, incomingItems, tombstones) {
  const normalizedCurrent = toArray(currentItems).map(normalizeItem).filter(Boolean);
  const normalizedIncoming = toArray(incomingItems).map(normalizeItem).filter(Boolean);
  const normalizedTombstones = normalizeTombstones(tombstones);

  const currentById = new Map(normalizedCurrent.map((item) => [item.id, item]));
  const incomingIds = new Set();
  const merged = [];
  let latestIncomingTimestamp = 0;

  normalizedIncoming.forEach((item) => {
    incomingIds.add(item.id);
    const incomingTs = toFiniteTimestamp(item.updated_date);
    if (incomingTs > latestIncomingTimestamp) latestIncomingTimestamp = incomingTs;

    const current = currentById.get(item.id);
    if (!current) {
      merged.push(item);
      return;
    }

    const currentTs = toFiniteTimestamp(current.updated_date);
    merged.push(currentTs > incomingTs ? current : item);
  });

  // Preserve remote items that were likely edited concurrently after this local snapshot was produced.
  normalizedCurrent.forEach((item) => {
    if (incomingIds.has(item.id)) return;
    const currentTs = toFiniteTimestamp(item.updated_date);
    if (currentTs > latestIncomingTimestamp) {
      merged.push(item);
    }
  });

  const filtered = merged.filter((item) => {
    const itemTs = toFiniteTimestamp(item.updated_date);
    const tombstoneTs = toFiniteTimestamp(normalizedTombstones[item.id]);
    return itemTs > tombstoneTs;
  });

  filtered.sort((a, b) => toFiniteTimestamp(b.updated_date) - toFiniteTimestamp(a.updated_date));
  return filtered;
}

function mergeInventoryData(currentData, incomingData) {
  const current = currentData && typeof currentData === "object" ? currentData : {};
  const incoming = incomingData && typeof incomingData === "object" ? incomingData : {};

  const currentPrefs = current.prefs && typeof current.prefs === "object" ? current.prefs : {};
  const incomingPrefs = incoming.prefs && typeof incoming.prefs === "object" ? incoming.prefs : {};
  const retentionDays = normalizeRetentionDays(
    incomingPrefs.item_tombstone_retention_days || currentPrefs.item_tombstone_retention_days
  );

  const mergedTombstones = mergeItemTombstones(current.item_tombstones, incoming.item_tombstones);
  const mergedItems = mergeInventoryItems(current.items, incoming.items, mergedTombstones);
  const currentCategories = Array.isArray(current.categories) ? current.categories : [];
  const incomingCategories = Array.isArray(incoming.categories) ? incoming.categories : null;
  const currentCategoriesUpdatedAt = toFiniteTimestamp(current.categories_updated_at);
  const incomingCategoriesUpdatedAt = toFiniteTimestamp(incoming.categories_updated_at);

  const shouldApplyIncomingCategories = Boolean(
    incomingCategories && (incomingCategoriesUpdatedAt >= currentCategoriesUpdatedAt || !Array.isArray(current.categories))
  );
  const mergedCategories = shouldApplyIncomingCategories ? incomingCategories : currentCategories;
  const mergedCategoriesUpdatedAt = shouldApplyIncomingCategories
    ? incomingCategoriesUpdatedAt
    : currentCategoriesUpdatedAt;

  // Drop tombstones already superseded by newer item updates.
  mergedItems.forEach((item) => {
    const itemTs = toFiniteTimestamp(item.updated_date);
    const tombstoneTs = toFiniteTimestamp(mergedTombstones[item.id]);
    if (itemTs > tombstoneTs) {
      delete mergedTombstones[item.id];
    }
  });

  const prunedTombstones = pruneItemTombstones(mergedTombstones, mergedItems, retentionDays);

  return {
    prefs: {
      home_name: String(incomingPrefs.home_name || currentPrefs.home_name || "").trim() || "Inventory Hub",
      item_tombstone_retention_days: retentionDays,
    },
    categories: mergedCategories,
    categories_updated_at: mergedCategoriesUpdatedAt,
    items: mergedItems,
    item_tombstones: prunedTombstones,
  };
}

// Get the database reference for an inventory
export function getInventoryRef(inventoryId) {
  if (typeof firebase === "undefined") return null;
  return firebase.database().ref(`inventories/${inventoryId}`);
}

// Get current user's inventories
export async function getUserInventories(userId) {
  if (typeof firebase === "undefined") return [];

  try {
    const snapshot = await firebase
      .database()
      .ref(`user_inventories/${userId}`)
      .once("value");
    const inventories = snapshot.val() || {};
    const inventoryIds = Object.keys(inventories);
    if (!inventoryIds.length) return inventories;

    const cleaned = {};
    await Promise.all(
      inventoryIds.map(async (inventoryId) => {
        const meta = inventories[inventoryId] || {};
        try {
          const collabSnapshot = await firebase
            .database()
            .ref(`inventories/${inventoryId}/collaborators/${userId}`)
            .once("value");

          if (!collabSnapshot.exists()) {
            await firebase.database().ref(`user_inventories/${userId}/${inventoryId}`).remove();
            return;
          }

          cleaned[inventoryId] = meta;
        } catch (error) {
          if (isPermissionDeniedError(error)) {
            try {
              await firebase.database().ref(`user_inventories/${userId}/${inventoryId}`).remove();
            } catch (_removeErr) {
              // Ignore local cleanup failures and continue processing.
            }
            return;
          }

          // Keep entry on transient/read failures that are not authorization-related.
          cleaned[inventoryId] = meta;
        }
      })
    );

    return cleaned;
  } catch (error) {
    console.error("Error fetching inventories:", error);
    return {};
  }
}

// Create a new shared inventory
export async function createSharedInventory(userId, inventoryName, initialData) {
  if (typeof firebase === "undefined") return null;

  try {
    const inventoryRef = firebase.database().ref("inventories").push();
    const inventoryId = inventoryRef.key;

    const inviteCode = generateInviteCode();

    const inventoryPayload = {
      id: inventoryId,
      name: inventoryName,
      owner_id: userId,
      created_at: firebase.database.ServerValue.TIMESTAMP,
      data: initialData,
      collaborators: {
        [userId]: {
          role: "admin",
          name: (getCurrentUser() && getCurrentUser().displayName) || "Owner",
          joined_at: firebase.database.ServerValue.TIMESTAMP,
        },
      },
      invite_codes: {
        [inviteCode]: {
          created_by: userId,
          created_at: firebase.database.ServerValue.TIMESTAMP,
          uses: 0,
          max_uses: null, // unlimited
        },
      },
    };

    await inventoryRef.set(inventoryPayload);

    try {
      await firebase.database().ref().update({
        [`user_inventories/${userId}/${inventoryId}`]: {
          name: inventoryName,
          role: "admin",
          joined_at: firebase.database.ServerValue.TIMESTAMP,
        },
        [`invite_code_index/${inviteCode}`]: {
          inventory_id: inventoryId,
          created_by: userId,
          created_at: firebase.database.ServerValue.TIMESTAMP,
        },
      });
    } catch (secondaryWriteError) {
      // Roll back root inventory if index writes fail so we do not leave orphaned inventories.
      try {
        await inventoryRef.remove();
      } catch (_rollbackError) {
        // If rollback fails, surface original secondary write failure.
      }
      throw secondaryWriteError;
    }

    return { inventoryId, inviteCode };
  } catch (error) {
    console.error("Error creating shared inventory:", error);
    const msg = String(error && error.message ? error.message : error);
    if ((error && error.code === "PERMISSION_DENIED") || /permission|denied/i.test(msg)) {
      throw new Error("Permission denied by Firebase Realtime Database rules.");
    }
    throw error;
  }
}

// Join an inventory with invite code
export async function joinInventoryWithCode(userId, inventoryId, inviteCode) {
  if (typeof firebase === "undefined") return false;

  try {
    const code = normalizeInviteCode(inviteCode);
    const inventoryRef = firebase.database().ref(`inventories/${inventoryId}`);
    const codeRef = inventoryRef.child(`invite_codes/${code}`);
    const codeSnapshot = await codeRef.once("value");
    const codeData = codeSnapshot.val();
    if (!codeData) {
      throw new Error("Invalid invite code");
    }

    if (codeData.max_uses && codeData.uses >= codeData.max_uses) {
      throw new Error("Invite code has reached its usage limit");
    }

    const currentUser = getCurrentUser();
    const displayName =
      (currentUser && currentUser.displayName) || (currentUser && currentUser.email) || "Member";
    const fallbackInventoryName = "Shared Inventory";

    const updates = {
      [`inventories/${inventoryId}/collaborators/${userId}`]: {
        role: "member",
        name: displayName,
        invite_code: code,
        joined_at: firebase.database.ServerValue.TIMESTAMP,
      },
      [`inventories/${inventoryId}/invite_codes/${code}`]: {
        created_by: codeData.created_by,
        created_at: codeData.created_at,
        max_uses: typeof codeData.max_uses === "undefined" ? null : codeData.max_uses,
        uses: (codeData.uses || 0) + 1,
      },
      [`user_inventories/${userId}/${inventoryId}`]: {
        name: fallbackInventoryName,
        role: "member",
        joined_at: firebase.database.ServerValue.TIMESTAMP,
      },
    };

    await firebase.database().ref().update(updates);

    // Backfill user inventory name when readable after join commit.
    try {
      const nameSnapshot = await inventoryRef.child("name").once("value");
      const inventoryName = String(nameSnapshot.val() || "").trim();
      if (inventoryName) {
        await firebase.database().ref(`user_inventories/${userId}/${inventoryId}/name`).set(inventoryName);
      }
    } catch (_error) {
      // Keep fallback name when name fetch is denied or transiently unavailable.
    }

    return true;
  } catch (error) {
    console.error("Error joining inventory:", error);
    throw error;
  }
}

// Find inventory ID by invite code
export async function findInventoryIdByInviteCode(inviteCode) {
  if (typeof firebase === "undefined") return null;

  const code = String(inviteCode || "").trim().toUpperCase();
  if (!code) return null;

  try {
    const snapshot = await firebase.database().ref(`invite_code_index/${code}`).once("value");
    const record = snapshot.val();
    return record && record.inventory_id ? record.inventory_id : null;
  } catch (error) {
    console.error("Error finding inventory by invite code:", error);
    throw error;
  }
}

// Get collaborators for an inventory
export async function getCollaborators(inventoryId) {
  if (typeof firebase === "undefined") return {};

  try {
    const snapshot = await firebase
      .database()
      .ref(`inventories/${inventoryId}/collaborators`)
      .once("value");
    return snapshot.val() || {};
  } catch (error) {
    console.error("Error fetching collaborators:", error);
    return {};
  }
}

// Generate new invite code
export async function generateNewInviteCode(inventoryId, userId) {
  if (typeof firebase === "undefined") return null;

  try {
    const inventoryRef = firebase.database().ref(`inventories/${inventoryId}`);
    const snapshot = await inventoryRef.once("value");
    const inventory = snapshot.val();

    if (!inventory || inventory.owner_id !== userId) {
      throw new Error("Only inventory owner can generate invite codes");
    }

    const inviteCode = generateInviteCode();
    await inventoryRef.child(`invite_codes/${inviteCode}`).set({
      created_by: userId,
      created_at: firebase.database.ServerValue.TIMESTAMP,
      uses: 0,
      max_uses: null,
    });

    await firebase
      .database()
      .ref(`invite_code_index/${inviteCode}`)
      .set({
        inventory_id: inventoryId,
        created_by: userId,
        created_at: firebase.database.ServerValue.TIMESTAMP,
      });

    return inviteCode;
  } catch (error) {
    console.error("Error generating invite code:", error);
    throw error;
  }
}

// Remove collaborator
export async function removeCollaborator(inventoryId, userId, collaboratorId) {
  if (typeof firebase === "undefined") return false;

  try {
    const inventoryRef = firebase.database().ref(`inventories/${inventoryId}`);
    const snapshot = await inventoryRef.once("value");
    const inventory = snapshot.val();

    if (inventory.owner_id !== userId) {
      throw new Error("Only inventory owner can remove collaborators");
    }

    if (collaboratorId === inventory.owner_id) {
      throw new Error("Inventory creators cannot remove themselves as collaborators");
    }

    await inventoryRef.child(`collaborators/${collaboratorId}`).remove();

    try {
      await firebase
        .database()
        .ref(`user_inventories/${collaboratorId}/${inventoryId}`)
        .remove();
    } catch (error) {
      // Some rulesets only allow users to mutate their own user_inventories path.
      // The collaborator was already removed above, and stale pointers are cleaned on list load.
      if (!isPermissionDeniedError(error)) {
        throw error;
      }
    }

    return true;
  } catch (error) {
    console.error("Error removing collaborator:", error);
    throw error;
  }
}

// Listen to real-time inventory updates
export function listenToInventory(inventoryId, onUpdate) {
  if (typeof firebase === "undefined") return null;

  const ref = firebase.database().ref(`inventories/${inventoryId}/data`);
  ref.on("value", (snapshot) => {
    const data = snapshot.val();
    onUpdate(data);
  });

  // Return unsubscribe function
  return () => ref.off("value");
}

// Update inventory data
export async function updateInventoryData(inventoryId, data) {
  if (typeof firebase === "undefined") return false;

  try {
    const ref = firebase.database().ref(`inventories/${inventoryId}/data`);
    const result = await ref.transaction((current) => mergeInventoryData(current, data));
    return Boolean(result && result.committed);
  } catch (error) {
    console.error("Error updating inventory:", error);
    return false;
  }
}

// Get invite codes for inventory
export async function getInviteCodes(inventoryId) {
  if (typeof firebase === "undefined") return {};

  try {
    const snapshot = await firebase
      .database()
      .ref(`inventories/${inventoryId}/invite_codes`)
      .once("value");
    return snapshot.val() || {};
  } catch (error) {
    console.error("Error fetching invite codes:", error);
    return {};
  }
}

// Delete invite code
export async function deleteInviteCode(inventoryId, userId, inviteCode) {
  if (typeof firebase === "undefined") return false;

  try {
    const inventoryRef = firebase.database().ref(`inventories/${inventoryId}`);
    const snapshot = await inventoryRef.once("value");
    const inventory = snapshot.val();

    if (inventory.owner_id !== userId) {
      throw new Error("Only owner can delete codes");
    }

    await inventoryRef.child(`invite_codes/${inviteCode}`).remove();
    await firebase.database().ref(`invite_code_index/${inviteCode}`).remove();
    return true;
  } catch (error) {
    console.error("Error deleting invite code:", error);
    throw error;
  }
}

export async function deleteInventory(userId, inventoryId) {
  if (typeof firebase === "undefined") return { deleted: false, role: "unknown" };

  const uid = String(userId || "").trim();
  const invId = String(inventoryId || "").trim();
  if (!uid || !invId) {
    throw new Error("Missing user or inventory id");
  }

  try {
    const inventoryRef = firebase.database().ref(`inventories/${invId}`);
    const snapshot = await inventoryRef.once("value");
    const inventory = snapshot.val();

    // If inventory is already gone, still remove stale pointer from user's list.
    if (!inventory) {
      await firebase.database().ref(`user_inventories/${uid}/${invId}`).remove();
      return { deleted: true, role: "unknown" };
    }

    const ownerId = String(inventory.owner_id || "").trim();
    if (ownerId === uid) {
      const requiredUpdates = {
        [`inventories/${invId}`]: null,
        [`user_inventories/${uid}/${invId}`]: null,
      };

      const optionalUpdates = {};

      const collaborators = inventory && typeof inventory.collaborators === "object" ? inventory.collaborators : {};
      Object.keys(collaborators).forEach((collaboratorId) => {
        if (String(collaboratorId || "").trim() === uid) return;
        optionalUpdates[`user_inventories/${collaboratorId}/${invId}`] = null;
      });

      const inviteCodes = inventory && typeof inventory.invite_codes === "object" ? inventory.invite_codes : {};
      Object.keys(inviteCodes).forEach((code) => {
        requiredUpdates[`invite_code_index/${code}`] = null;
      });

      await firebase.database().ref().update(requiredUpdates);

      const optionalPaths = Object.keys(optionalUpdates);
      if (optionalPaths.length) {
        await Promise.all(
          optionalPaths.map(async (path) => {
            try {
              await firebase.database().ref(path).remove();
            } catch (error) {
              if (!isPermissionDeniedError(error)) {
                throw error;
              }
            }
          })
        );
      }

      return { deleted: true, role: "admin" };
    }

    let removedFromCollaborators = false;
    let removedFromUserList = false;

    try {
      await inventoryRef.child(`collaborators/${uid}`).remove();
      removedFromCollaborators = true;
    } catch (error) {
      if (!isPermissionDeniedError(error)) {
        throw error;
      }
    }

    try {
      await firebase.database().ref(`user_inventories/${uid}/${invId}`).remove();
      removedFromUserList = true;
    } catch (error) {
      if (!isPermissionDeniedError(error)) {
        throw error;
      }
    }

    if (!removedFromCollaborators && !removedFromUserList) {
      throw new Error("Permission denied while leaving this inventory.");
    }

    return { deleted: false, role: "member" };
  } catch (error) {
    console.error("Error deleting inventory:", error);
    throw error;
  }
}

// Append a single accountability event for inventory changes.
export async function logInventoryChange(inventoryId, eventData) {
  if (typeof firebase === "undefined" || !inventoryId || !eventData) return false;

  try {
    const payload = {
      action: eventData.action || "update",
      summary: eventData.summary || "Inventory updated",
      details: eventData.details || null,
      actor_uid: eventData.actor_uid || null,
      actor_name: eventData.actor_name || "Unknown",
      actor_email: eventData.actor_email || null,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
    };

    await firebase
      .database()
      .ref(`inventories/${inventoryId}/activity_logs`)
      .push(payload);

    return true;
  } catch (error) {
    console.error("Error logging inventory change:", error);
    return false;
  }
}

export async function getInventoryActivityLogs(inventoryId, limit = 100) {
  if (typeof firebase === "undefined" || !inventoryId) return [];

  try {
    const snapshot = await firebase
      .database()
      .ref(`inventories/${inventoryId}/activity_logs`)
      .orderByChild("timestamp")
      .limitToLast(limit)
      .once("value");

    const raw = snapshot.val() || {};
    return Object.entries(raw)
      .map(([id, value]) => ({ id, ...(value || {}) }))
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  } catch (error) {
    console.error("Error fetching inventory activity logs:", error);
    return [];
  }
}

function getUserInventoryPrefsRef(userId, inventoryId) {
  if (typeof firebase === "undefined") return null;
  if (!userId || !inventoryId) return null;
  return firebase.database().ref(`user_inventories/${userId}/${inventoryId}/user_prefs`);
}

export async function getUserInventoryPrefs(userId, inventoryId) {
  const ref = getUserInventoryPrefsRef(userId, inventoryId);
  if (!ref) return null;

  try {
    const snapshot = await ref.once("value");
    return snapshot.val() || null;
  } catch (error) {
    console.error("Error fetching user inventory prefs:", error);
    return null;
  }
}

export function listenToUserInventoryPrefs(userId, inventoryId, onUpdate) {
  const ref = getUserInventoryPrefsRef(userId, inventoryId);
  if (!ref) return null;

  ref.on("value", (snapshot) => {
    onUpdate(snapshot.val() || null);
  });

  return () => ref.off("value");
}

export async function updateUserInventoryPrefs(userId, inventoryId, prefs) {
  const ref = getUserInventoryPrefsRef(userId, inventoryId);
  if (!ref) return false;

  try {
    await ref.set(prefs || {});
    return true;
  } catch (error) {
    console.error("Error updating user inventory prefs:", error);
    return false;
  }
}

function getUserAccountPrefsRef(userId) {
  if (typeof firebase === "undefined") return null;
  if (!userId) return null;
  return firebase.database().ref(`user_profiles/${userId}/prefs`);
}

export async function getUserAccountPrefs(userId) {
  const ref = getUserAccountPrefsRef(userId);
  if (!ref) return null;

  try {
    const snapshot = await ref.once("value");
    return snapshot.val() || null;
  } catch (error) {
    console.error("Error fetching user account prefs:", error);
    return undefined;
  }
}

export function listenToUserAccountPrefs(userId, onUpdate) {
  const ref = getUserAccountPrefsRef(userId);
  if (!ref) return null;

  ref.on("value", (snapshot) => {
    onUpdate(snapshot.val() || null);
  });

  return () => ref.off("value");
}

export async function updateUserAccountPrefs(userId, prefs) {
  const ref = getUserAccountPrefsRef(userId);
  if (!ref) return false;

  try {
    const payload = prefs && typeof prefs === "object" ? prefs : {};
    await ref.update(payload);
    return true;
  } catch (error) {
    console.error("Error updating user account prefs:", error);
    return false;
  }
}
