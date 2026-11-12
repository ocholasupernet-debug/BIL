// Creates a standalone production package; never reads/copies environment secrets.
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const root=path.resolve(import.meta.dirname,'..');
const destination=path.resolve(root,'../../../generated-artifacts/isplatty-org-release');
await rm(destination,{recursive:true,force:true});
await mkdir(destination,{recursive:true});
for(const folder of ['server','deploy'])await cp(path.join(root,folder),path.join(destination,folder),{recursive:true});
await cp(path.join(root,'public'),path.join(destination,'dist/public'),{recursive:true});
await rm(path.join(destination,'server/tests'),{recursive:true,force:true});
await cp(path.join(root,'site.config.json'),path.join(destination,'site.config.json'));
const source=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const dependencies={};
for(const name of Object.keys(source.dependencies)){
  const declared=source.dependencies[name];
  if(/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(declared)){
    dependencies[name]=declared;
    continue;
  }
  // Resolve actual versions, eliminating pnpm workspace/catalog references.
  let moduleRoot;
  try{moduleRoot=path.dirname(require.resolve(name));}
  catch{throw new Error(`Cannot resolve runtime version for ${name} (${declared})`);}
  while(true){
    try{
      const json=JSON.parse(await readFile(path.join(moduleRoot,'package.json'),'utf8'));
      if(json.name===name){dependencies[name]=json.version;break;}
    }catch{}
    const parent=path.dirname(moduleRoot);
    if(parent===moduleRoot)throw new Error(`Cannot resolve runtime version for ${name}`);
    moduleRoot=parent;
  }
}
await writeFile(path.join(destination,'package.json'),JSON.stringify({
  name:'isplatty-org-corporate-production',private:true,type:'module',version:'1.0.0',
  engines:{node:'>=24 <25'},scripts:{start:'node server/index.mjs'},
  dependencies,
},null,2)+'\n');
process.stdout.write(`Standalone release prepared in ${destination}. No deployment performed.\n`);
