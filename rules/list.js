/**
 * List rules functionality
 */
const { callGraphAPI } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { fetchAllFoldersDeep } = require('../email/folder-utils');

/**
 * List rules handler
 * @param {object} args - Tool arguments
 * @returns {object} - MCP response
 */
async function handleListRules(args) {
  const includeDetails = args.includeDetails === true;
  
  try {
    // Get access token
    const accessToken = await ensureAuthenticated();
    
    // Get all inbox rules
    const rules = await getInboxRules(accessToken);

    // Build folder id → path map for readable action display
    let folderMap = new Map();
    if (includeDetails) {
      try {
        folderMap = await buildFolderIdToPathMap(accessToken);
      } catch (err) {
        console.error(`Failed to build folder map: ${err.message}`);
      }
    }

    // Format the rules based on detail level
    const formattedRules = formatRulesList(rules, includeDetails, folderMap);
    
    return {
      content: [{ 
        type: "text", 
        text: formattedRules
      }]
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ 
          type: "text", 
          text: "Authentication required. Please use the 'authenticate' tool first."
        }]
      };
    }
    
    return {
      content: [{ 
        type: "text", 
        text: `Error listing rules: ${error.message}`
      }]
    };
  }
}

/**
 * Get all inbox rules
 * @param {string} accessToken - Access token
 * @returns {Promise<Array>} - Array of rule objects
 */
async function getInboxRules(accessToken) {
  try {
    const response = await callGraphAPI(
      accessToken,
      'GET',
      'me/mailFolders/inbox/messageRules',
      null
    );
    
    return response.value || [];
  } catch (error) {
    console.error(`Error getting inbox rules: ${error.message}`);
    throw error;
  }
}

/**
 * Format rules list for display
 * @param {Array} rules - Array of rule objects
 * @param {boolean} includeDetails - Whether to include detailed conditions and actions
 * @returns {string} - Formatted rules list
 */
function formatRulesList(rules, includeDetails, folderMap) {
  if (!rules || rules.length === 0) {
    return "No inbox rules found.\n\nTip: You can create rules using the 'create-rule' tool. Rules are processed in order of their sequence number (lower numbers are processed first).";
  }
  
  // Sort rules by sequence to show execution order
  const sortedRules = [...rules].sort((a, b) => {
    return (a.sequence || 9999) - (b.sequence || 9999);
  });
  
  // Format rules based on detail level
  if (includeDetails) {
    // Detailed format
    const detailedRules = sortedRules.map((rule, index) => {
      // Format rule header with sequence
      let ruleText = `${index + 1}. ${rule.displayName}${rule.isEnabled ? '' : ' (Disabled)'} - Sequence: ${rule.sequence || 'N/A'}`;
      
      // Format conditions
      const conditions = formatRuleConditions(rule);
      if (conditions) {
        ruleText += `\n   Conditions: ${conditions}`;
      }
      
      // Format actions
      const actions = formatRuleActions(rule, folderMap);
      if (actions) {
        ruleText += `\n   Actions: ${actions}`;
      }
      
      return ruleText;
    });
    
    return `Found ${rules.length} inbox rules (sorted by execution order):\n\n${detailedRules.join('\n\n')}\n\nRules are processed in order of their sequence number. You can change rule order using the 'edit-rule-sequence' tool.`;
  } else {
    // Simple format
    const simpleRules = sortedRules.map((rule, index) => {
      return `${index + 1}. ${rule.displayName}${rule.isEnabled ? '' : ' (Disabled)'} - Sequence: ${rule.sequence || 'N/A'}`;
    });
    
    return `Found ${rules.length} inbox rules (sorted by execution order):\n\n${simpleRules.join('\n')}\n\nTip: Use 'list-rules with includeDetails=true' to see more information about each rule.`;
  }
}

/**
 * Format rule conditions for display
 * @param {object} rule - Rule object
 * @returns {string} - Formatted conditions
 */
function formatRuleConditions(rule) {
  const conditions = [];
  const c = rule.conditions;
  if (!c) {
    return '';
  }

  if (c.fromAddresses?.length > 0) {
    const senders = c.fromAddresses.map(addr => addr.emailAddress.address).join(', ');
    conditions.push(`From: ${senders}`);
  }

  if (c.senderContains?.length > 0) {
    conditions.push(`Sender contains: "${c.senderContains.join(', ')}"`);
  }

  if (c.sentToAddresses?.length > 0) {
    const recipients = c.sentToAddresses.map(addr => addr.emailAddress.address).join(', ');
    conditions.push(`Sent to: ${recipients}`);
  }

  if (c.recipientContains?.length > 0) {
    conditions.push(`Recipient contains: "${c.recipientContains.join(', ')}"`);
  }

  if (c.subjectContains?.length > 0) {
    conditions.push(`Subject contains: "${c.subjectContains.join(', ')}"`);
  }

  if (c.bodyContains?.length > 0) {
    conditions.push(`Body contains: "${c.bodyContains.join(', ')}"`);
  }

  if (c.bodyOrSubjectContains?.length > 0) {
    conditions.push(`Body or subject contains: "${c.bodyOrSubjectContains.join(', ')}"`);
  }

  if (c.categories?.length > 0) {
    conditions.push(`Categories: ${c.categories.join(', ')}`);
  }

  if (c.sentToMe === true) {
    conditions.push('Sent to me');
  }

  if (c.sentCcMe === true) {
    conditions.push("CC'd to me");
  }

  if (c.sentOnlyToMe === true) {
    conditions.push('Sent only to me');
  }

  if (c.sentToOrCcMe === true) {
    conditions.push('Sent to or CC me');
  }

  if (c.isMeetingRequest === true) {
    conditions.push('Is meeting request');
  }

  if (c.hasAttachments === true) {
    conditions.push('Has attachments');
  }

  if (c.importance) {
    conditions.push(`Importance: ${c.importance}`);
  }

  if (c.sensitivity) {
    conditions.push(`Sensitivity: ${c.sensitivity}`);
  }

  return conditions.join('; ');
}

/**
 * Format rule actions for display
 * @param {object} rule - Rule object
 * @returns {string} - Formatted actions
 */
function formatRuleActions(rule, folderMap) {
  const actions = [];
  const resolveName = (id) => (folderMap && folderMap.get(id)) || id;

  // Move to folder
  if (rule.actions?.moveToFolder) {
    actions.push(`Move to folder: ${resolveName(rule.actions.moveToFolder)}`);
  }

  // Copy to folder
  if (rule.actions?.copyToFolder) {
    actions.push(`Copy to folder: ${resolveName(rule.actions.copyToFolder)}`);
  }
  
  // Mark as read
  if (rule.actions?.markAsRead === true) {
    actions.push('Mark as read');
  }
  
  // Mark importance
  if (rule.actions?.markImportance) {
    actions.push(`Mark importance: ${rule.actions.markImportance}`);
  }
  
  // Forward
  if (rule.actions?.forwardTo?.length > 0) {
    const recipients = rule.actions.forwardTo.map(r => r.emailAddress.address).join(', ');
    actions.push(`Forward to: ${recipients}`);
  }
  
  // Delete
  if (rule.actions?.delete === true) {
    actions.push('Delete');
  }
  
  return actions.join('; ');
}

/**
 * Build a map from folder id → full display path (e.g. "Inbox/Finance/BOC").
 * Uses fetchAllFoldersDeep to walk the whole tree, then reconstructs paths
 * by chasing parentFolderId upwards.
 */
async function buildFolderIdToPathMap(accessToken) {
  const folders = await fetchAllFoldersDeep(
    accessToken,
    'id,displayName,parentFolderId,childFolderCount'
  );

  const byId = new Map();
  folders.forEach(f => byId.set(f.id, f));

  const pathCache = new Map();

  function resolve(id) {
    if (pathCache.has(id)) return pathCache.get(id);
    const f = byId.get(id);
    if (!f) return null;
    if (f.isTopLevel || !f.parentFolderId) {
      pathCache.set(id, f.displayName);
      return f.displayName;
    }
    const parentPath = resolve(f.parentFolderId);
    const path = parentPath ? `${parentPath}/${f.displayName}` : f.displayName;
    pathCache.set(id, path);
    return path;
  }

  folders.forEach(f => resolve(f.id));
  return pathCache;
}

module.exports = {
  handleListRules,
  getInboxRules
};
