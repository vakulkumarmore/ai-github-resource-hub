/* Safely add v25 AI routes to an existing Worker without rewriting its OAuth or publishing implementation. */
import {readFileSync, writeFileSync, copyFileSync} from 'node:fs';
const path = 'worker/index.js';
const original=readFileSync(path,'utf8');
if (original.includes("path==='/api/ai-chat'")) {
  console.log('AI routes already installed; no changes made.');
  process.exit(0);
}
const needle = "if(!env.CLIENT_ID||!env.CLIENT_SECRET||!env.SESSION_SECRET||!env.OWNER_LOGIN||!env.REPO_NAME)return json({error:'Server configuration incomplete'},503);";
if (!original.includes(needle)) {
  console.error('Your Worker is structured differently. Nothing was modified; follow the manual insertion instructions instead.');
  process.exit(2);
}
let modified=original;
if (!modified.includes("from './catalogAI.js'")) modified="import { handleCatalogAI, aiEnabled } from './catalogAI.js';\n"+modified;
modified=modified.replace(needle, needle+"\n if(path==='/api/ai-status'&&req.method==='GET')return json({enabled:aiEnabled(env)});\n if(path==='/api/ai-chat')return handleCatalogAI(req,env);");
copyFileSync(path,`${path}.v24-backup`);
writeFileSync(path,modified);
console.log('Updated worker/index.js. Backup: worker/index.js.v24-backup (do not commit the backup).');
