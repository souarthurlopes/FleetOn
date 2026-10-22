import {build} from 'esbuild';
import {cp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const url=process.env.FLEETON_SUPABASE_URL || '';
const key=process.env.FLEETON_SUPABASE_PUBLISHABLE_KEY || '';
if (Boolean(url) !== Boolean(key)) throw new Error('Configure as duas variáveis públicas do Supabase.');
if (key.startsWith('sb_secret_')) throw new Error('Use somente a chave publishable/anon.');
if (key && !key.startsWith('sb_publishable_')) {
  let claims;
  try { claims=JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); } catch {}
  if (claims?.role !== 'anon') throw new Error('Chave inválida: use publishable ou JWT anon.');
}
if (url && (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url))) throw new Error('Use a URL HTTPS do projeto Supabase.');
await build({entryPoints:['src/supabase-sdk.js'], outfile:'public/vendor/supabase.js', bundle:true, minify:true, format:'iife', globalName:'FleetOnSupabase', target:'es2022', legalComments:'eof'});
await rm('dist', {recursive:true,force:true}); await mkdir('dist', {recursive:true}); await cp('public', 'dist', {recursive:true});
if(url) await writeFile('dist/config.js', 'window.FLEETON_CONFIG = '+JSON.stringify({backend:'supabase',supabaseUrl:url,supabasePublishableKey:key})+';\n');
const config=await readFile('dist/config.js','utf8');
console.log(url || !config.includes("supabaseUrl: ''") ? 'Build pronto em dist/.' : 'Build pronto em dist/. Falta configurar URL e chave pública do Supabase antes da publicação.');
