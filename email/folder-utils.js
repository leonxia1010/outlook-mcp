/**
 * Email folder utilities
 *
 * Folder name resolution supports nested paths via 'Parent/Child/Grandchild'
 * syntax. Path segments are resolved one at a time against
 * me/mailFolders/{parentId}/childFolders. The first segment may be a
 * well-known name (case-insensitive).
 */
const { callGraphAPI } = require('../utils/graph-api');

/**
 * Well-known folder names → /messages endpoint (single-segment shortcut).
 */
const WELL_KNOWN_FOLDERS = {
  'inbox': 'me/mailFolders/inbox/messages',
  'drafts': 'me/mailFolders/drafts/messages',
  'sent': 'me/mailFolders/sentItems/messages',
  'deleted': 'me/mailFolders/deletedItems/messages',
  'junk': 'me/mailFolders/junkemail/messages',
  'archive': 'me/mailFolders/archive/messages'
};

/**
 * Well-known folder names → reserved Graph folder id (for path-prefix
 * resolution: first segment of a 'Inbox/Sub' path needs the id, not the
 * /messages endpoint).
 */
const WELL_KNOWN_FOLDER_IDS = {
  'inbox': 'inbox',
  'drafts': 'drafts',
  'sent': 'sentItems',
  'deleted': 'deletedItems',
  'junk': 'junkemail',
  'archive': 'archive'
};

/**
 * Escape a literal for embedding inside an OData $filter single-quoted string.
 * OData rule: ' → '' (independent of KQL/$search escaping).
 */
function escapeODataLiteral(s) {
  return String(s).replace(/'/g, "''");
}

/**
 * Normalize folder input into trimmed non-empty segments.
 *   'A/B/C'      → ['A','B','C']
 *   '/Inbox/'    → ['Inbox']
 *   'Inbox//Sub' → ['Inbox','Sub']
 *   ' Inbox '    → ['Inbox']
 *   ''           → []
 */
function normalizeFolderSegments(input) {
  if (!input) return [];
  return String(input).split('/').map(s => s.trim()).filter(Boolean);
}

/**
 * Find a child folder id by displayName under a given parent.
 *   parentId === null → scope is mailbox root (GET me/mailFolders)
 *   otherwise         → scope is parent (GET me/mailFolders/{parentId}/childFolders)
 * Two-step lookup: exact $filter (with OData-escaped literal), then a
 * case-insensitive scan of the first 100 siblings as fallback.
 * Returns the folder id or null.
 */
async function findChildFolderIdByName(accessToken, parentId, name) {
  const scope = parentId === null
    ? 'me/mailFolders'
    : `me/mailFolders/${parentId}/childFolders`;
  const escaped = escapeODataLiteral(name);

  try {
    const response = await callGraphAPI(
      accessToken,
      'GET',
      scope,
      null,
      { $filter: `displayName eq '${escaped}'` }
    );

    if (response.value && response.value.length > 0) {
      return response.value[0].id;
    }

    const allResponse = await callGraphAPI(
      accessToken,
      'GET',
      scope,
      null,
      { $top: 100 }
    );

    if (allResponse.value) {
      const lowerName = name.toLowerCase();
      const match = allResponse.value.find(
        f => f.displayName && f.displayName.toLowerCase() === lowerName
      );
      if (match) return match.id;
    }

    return null;
  } catch (error) {
    console.error(`Error looking up folder "${name}" under ${parentId || 'root'}: ${error.message}`);
    return null;
  }
}

/**
 * Resolve a multi-segment path to its leaf folder id.
 * First segment may match WELL_KNOWN_FOLDER_IDS case-insensitively.
 * Any miss along the path → returns null (no silent fallback).
 */
async function resolveFolderPathById(accessToken, segments) {
  if (!segments || segments.length === 0) return null;

  let currentId;
  const firstLower = segments[0].toLowerCase();

  if (WELL_KNOWN_FOLDER_IDS[firstLower]) {
    currentId = WELL_KNOWN_FOLDER_IDS[firstLower];
  } else {
    currentId = await findChildFolderIdByName(accessToken, null, segments[0]);
    if (!currentId) return null;
  }

  for (let i = 1; i < segments.length; i++) {
    currentId = await findChildFolderIdByName(accessToken, currentId, segments[i]);
    if (!currentId) return null;
  }

  return currentId;
}

/**
 * Resolve a folder input (plain name or slash-path) to a Graph folder id.
 * Returns null on miss.
 */
async function getFolderIdByName(accessToken, folderInput) {
  const segments = normalizeFolderSegments(folderInput);
  if (segments.length === 0) return null;

  if (segments.length > 1) {
    return resolveFolderPathById(accessToken, segments);
  }

  console.error(`Looking for folder with name "${segments[0]}"`);
  return findChildFolderIdByName(accessToken, null, segments[0]);
}

/**
 * Resolve a folder input to its /messages endpoint.
 *   ''/whitespace → defaults to inbox endpoint (unchanged behaviour)
 *   single well-known segment → shortcut without API calls
 *   otherwise → resolve via id lookup, then build endpoint
 * Returns null on miss. NOTE: this is a behaviour change from the previous
 * silent fall-back to inbox; callers must handle null and surface a
 * user-visible error with the path-syntax hint.
 */
async function resolveFolderPath(accessToken, folderInput) {
  const segments = normalizeFolderSegments(folderInput);

  if (segments.length === 0) {
    return WELL_KNOWN_FOLDERS['inbox'];
  }

  if (segments.length === 1) {
    const lowerName = segments[0].toLowerCase();
    if (WELL_KNOWN_FOLDERS[lowerName]) {
      console.error(`Using well-known folder path for "${segments[0]}"`);
      return WELL_KNOWN_FOLDERS[lowerName];
    }
  }

  const leafId = segments.length === 1
    ? await findChildFolderIdByName(accessToken, null, segments[0])
    : await resolveFolderPathById(accessToken, segments);

  if (!leafId) {
    console.error(`Folder "${folderInput}" not found`);
    return null;
  }

  return `me/mailFolders/${leafId}/messages`;
}

/**
 * BFS-walk the mailbox folder tree to arbitrary depth (capped at maxDepth
 * as a safety belt). Returns a flat array; each folder carries
 * parentFolderId (from Graph $select); top-level folders are tagged
 * isTopLevel: true; children additionally carry parentFolder (display name
 * of immediate parent) for the flat-list renderer in folder/list.js.
 */
async function fetchAllFoldersDeep(accessToken, selectFields, maxDepth = 10) {
  const fields = selectFields || 'id,displayName,parentFolderId,childFolderCount';

  let rootResponse;
  try {
    rootResponse = await callGraphAPI(
      accessToken,
      'GET',
      'me/mailFolders',
      null,
      { $top: 100, $select: fields }
    );
  } catch (error) {
    console.error(`Error fetching root mail folders: ${error.message}`);
    return [];
  }

  if (!rootResponse.value) return [];

  const all = rootResponse.value.map(f => ({ ...f, isTopLevel: true }));
  let frontier = rootResponse.value.filter(f => (f.childFolderCount || 0) > 0);
  let depth = 1;

  while (frontier.length > 0 && depth < maxDepth) {
    const childGroups = await Promise.all(
      frontier.map(async parent => {
        try {
          const resp = await callGraphAPI(
            accessToken,
            'GET',
            `me/mailFolders/${parent.id}/childFolders`,
            null,
            { $top: 100, $select: fields }
          );
          const children = resp.value || [];
          children.forEach(c => { c.parentFolder = parent.displayName; });
          return children;
        } catch (error) {
          console.error(`Error fetching children of "${parent.displayName}": ${error.message}`);
          return [];
        }
      })
    );

    const nextFrontier = [];
    for (const children of childGroups) {
      all.push(...children);
      for (const c of children) {
        if ((c.childFolderCount || 0) > 0) nextFrontier.push(c);
      }
    }

    frontier = nextFrontier;
    depth++;
  }

  return all;
}

/**
 * Get all mail folders (deep walk, public export).
 * Backwards-compatible signature; now traverses arbitrary depth via
 * fetchAllFoldersDeep instead of the previous 2-level walk.
 */
async function getAllFolders(accessToken) {
  return fetchAllFoldersDeep(
    accessToken,
    'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount'
  );
}

module.exports = {
  WELL_KNOWN_FOLDERS,
  WELL_KNOWN_FOLDER_IDS,
  escapeODataLiteral,
  normalizeFolderSegments,
  findChildFolderIdByName,
  resolveFolderPathById,
  resolveFolderPath,
  getFolderIdByName,
  fetchAllFoldersDeep,
  getAllFolders
};
