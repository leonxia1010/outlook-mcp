# Personal Scripts

These scripts are author-specific examples that contain hardcoded paths
(`/Users/ryaker/...`) and Outlook folder IDs from the original author's
mailbox. They are kept here as references but **will not work for other
users without modification**.

## Files

- `create-notifications-rule.js` — Creates a GitHub notifications inbox rule
- `move-github-emails.js` — Bulk-moves GitHub notification emails to a folder
- `find-folder-ids.js` — Lists Outlook folder IDs (used to find target folders for the above scripts)
- `backup-logs.sh` — Author's local log backup helper

## To adapt for your own use

1. Replace any `/Users/ryaker/...` paths with your own.
2. Run `find-folder-ids.js` (after adapting) to discover folder IDs in *your* mailbox.
3. Replace hardcoded folder IDs in `create-notifications-rule.js` and
   `move-github-emails.js` with the IDs you discovered.
4. Confirm the call signatures match the current `callGraphAPI` API in
   `utils/graph-api.js` — these scripts may use older signatures.
