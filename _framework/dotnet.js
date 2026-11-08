//! Licensed to the .NET Foundation under one or more agreements.
//! The .NET Foundation licenses this file to you under the MIT license.

var e=!0;const t=async()=>WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,8,1,6,0,6,64,25,11,11])),o=async()=>WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,15,1,13,0,65,1,253,15,65,2,253,15,253,128,2,11])),n=async()=>WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])),r=Symbol.for("wasm promise_control");function i(e,t){let o=null;const n=new Promise((function(n,r){o={isDone:!1,promise:null,resolve:t=>{o.isDone||(o.isDone=!0,n(t),e&&e())},reject:e=>{o.isDone||(o.isDone=!0,r(e),t&&t())}}}));o.promise=n;const i=n;return i[r]=o,{promise:i,promise_control:o}}function s(e){return e[r]}function a(e){e&&function(e){return void 0!==e[r]}(e)||qe(!1,"Promise is not controllable")}const l="__mono_message__",c=["debug","log","trace","warn","info","error"],d="MONO_WASM: ";let u,f,m,g;function p(e){g=e}function h(e){if(Ne.diagnosticTracing){const t="function"==typeof e?e():e;console.debug(d+t)}}function b(e,...t){console.info(d+e,...t)}function w(e,...t){console.info(e,...t)}function y(e,...t){console.warn(d+e,...t)}function v(e,...t){if(t&&t.length>0&&t[0]&&"object"==typeof t[0]){if(t[0].silent)return;if(t[0].toString)return void console.error(d+e,t[0].toString())}console.error(d+e,...t)}let _,E,T="",x=(new Date).valueOf();function j(t,o,n){return function(...r){try{let i=r[0];if(void 0===i)i="undefined";else if(null===i)i="null";else if("function"==typeof i)i=i.toString();else if("string"!=typeof i)try{i=JSON.stringify(i)}catch(e){i=i.toString()}if("string"==typeof i&&e){if(Pe&&-1!==i.indexOf("keeping the worker alive for asynchronous operation"))return;if(0===i.indexOf("MONO_WASM: ")||0===i.indexOf("[MONO]")){const e=new Date;x!==e.valueOf()&&(T=e.toISOString().substring(11,23),x=e.valueOf()),i=`[${g} ${T}] ${i}`}}o(n?JSON.stringify({method:t,payload:i,arguments:r.slice(1)}):[t+i,...r.slice(1)])}catch(e){m.error(`proxyConsole failed: ${e}`)}}}function R(e,t,o){f=t,g=e,m={...t};const n=`${o}/console`.replace("https://","wss://").replace("http://","ws://");u=new WebSocket(n),u.addEventListener("error",O),u.addEventListener("close",D),function(){for(const e of c)f[e]=j(`console.${e}`,A,!0)}()}function S(e){let t=30;const o=()=>{u?0==u.bufferedAmount||0==t?(e&&w(e),function(){for(const e of c)f[e]=j(`console.${e}`,m.log,!1)}(),u.removeEventListener("error",O),u.removeEventListener("close",D),u.close(1e3,e),u=void 0):(t--,globalThis.setTimeout(o,100)):e&&m&&m.log(e)};o()}function A(e){u&&u.readyState===WebSocket.OPEN?u.send(e):m.log(e)}function O(e){m.error(`[${g}] proxy console websocket error: ${e}`,e)}function D(e){m.debug(`[${g}] proxy console websocket closed: ${e}`,e)}function k(){Ne.preferredIcuAsset=I(Ne.config);let e="invariant"==Ne.config.globalizationMode;if(!e)if(Ne.preferredIcuAsset)Ne.diagnosticTracing&&h("ICU data archive(s) available, disabling invariant mode");else{if("custom"===Ne.config.globalizationMode||"all"===Ne.config.globalizationMode||"sharded"===Ne.config.globalizationMode){const e="invariant globalization mode is inactive and no ICU data archives are available";throw v(`ERROR: ${e}`),new Error(e)}Ne.diagnosticTracing&&h("ICU data archive(s) not available, using invariant globalization mode"),e=!0,Ne.preferredIcuAsset=null}const t="DOTNET_SYSTEM_GLOBALIZATION_INVARIANT",o=Ne.config.environmentVariables;if(void 0===o[t]&&e&&(o[t]="1"),void 0===o.TZ)try{const e=Intl.DateTimeFormat().resolvedOptions().timeZone||null;e&&(o.TZ=e)}catch(e){b("failed to detect timezone, will fallback to UTC")}}function I(e){var t;if((null===(t=e.resources)||void 0===t?void 0:t.icu)&&"invariant"!=e.globalizationMode){const t=e.applicationCulture||(Ce?globalThis.navigator&&globalThis.navigator.languages&&globalThis.navigator.languages[0]:Intl.DateTimeFormat().resolvedOptions().locale),o=e.resources.icu;let n=null;if("custom"===e.globalizationMode){if(o.length>=1)return o[0].name}else t&&"all"!==e.globalizationMode?"sharded"===e.globalizationMode&&(n=function(e){const t=e.split("-")[0];return"en"===t||["fr","fr-FR","it","it-IT","de","de-DE","es","es-ES"].includes(e)?"icudt_EFIGS.dat":["zh","ko","ja"].includes(t)?"icudt_CJK.dat":"icudt_no_CJK.dat"}(t)):n="icudt.dat";if(n)for(let e=0;e<o.length;e++){const t=o[e];if(t.virtualPath===n)return t.name}}return e.globalizationMode="invariant",null}const P=class{constructor(e){this.url=e}toString(){return this.url}};async function C(e,t){try{const o="function"==typeof globalThis.fetch;if(De){const n=e.startsWith("file://");if(!n&&o)return globalThis.fetch(e,t||{credentials:"same-origin"});_||(E=ze.require("url"),_=ze.require("fs")),n&&(e=E.fileURLToPath(e));const r=await _.promises.readFile(e);return{ok:!0,headers:{length:0,get:()=>null},url:e,arrayBuffer:()=>r,json:()=>JSON.parse(r),text:()=>{throw new Error("NotImplementedException")}}}if(o)return globalThis.fetch(e,t||{credentials:"same-origin"});if("function"==typeof read)return{ok:!0,url:e,headers:{length:0,get:()=>null},arrayBuffer:()=>new Uint8Array(read(e,"binary")),json:()=>JSON.parse(read(e,"utf8")),text:()=>read(e,"utf8")}}catch(t){return{ok:!1,url:e,status:500,headers:{length:0,get:()=>null},statusText:"ERR28: "+t,arrayBuffer:()=>{throw t},json:()=>{throw t},text:()=>{throw t}}}throw new Error("No fetch implementation available")}function M(e){return"string"!=typeof e&&qe(!1,"url must be a string"),!L(e)&&0!==e.indexOf("./")&&0!==e.indexOf("../")&&globalThis.URL&&globalThis.document&&globalThis.document.baseURI&&(e=new URL(e,globalThis.document.baseURI).toString()),e}const U=/^[a-zA-Z][a-zA-Z\d+\-.]*?:\/\//,N=/[a-zA-Z]:[\\/]/;function L(e){return De||Me?e.startsWith("/")||e.startsWith("\\")||-1!==e.indexOf("///")||N.test(e):U.test(e)}let $,z=0;const W=[],F=[],B=new Map,V={"js-module-threads":!0,"js-module-runtime":!0,"js-module-dotnet":!0,"js-module-native":!0,"js-module-diagnostics":!0},q={...V,"js-module-library-initializer":!0},J={...V,dotnetwasm:!0,heap:!0,manifest:!0},H={...q,manifest:!0},Z={...q,dotnetwasm:!0},Q={dotnetwasm:!0,symbols:!0},G={...q,dotnetwasm:!0,symbols:!0},K={symbols:!0};function X(e){return!("icu"==e.behavior&&e.name!=Ne.preferredIcuAsset)}function Y(e,t,o){null!=t||(t=[]),qe(1==t.length,`Expect to have one ${o} asset in resources`);const n=t[0];return n.behavior=o,ee(n),e.push(n),n}function ee(e){J[e.behavior]&&B.set(e.behavior,e)}function te(e){qe(J[e],`Unknown single asset behavior ${e}`);const t=B.get(e);if(t&&!t.resolvedUrl)if(t.resolvedUrl=Ne.locateFile(t.name),V[t.behavior]){const e=he(t);e?("string"!=typeof e&&qe(!1,"loadBootResource response for 'dotnetjs' type should be a URL string"),t.resolvedUrl=e):t.resolvedUrl=ue(t.resolvedUrl,t.behavior)}else if("dotnetwasm"!==t.behavior)throw new Error(`Unknown single asset behavior ${e}`);return t}function oe(e){const t=te(e);return qe(t,`Single asset for ${e} not found`),t}let ne=!1;async function re(){if(!ne){ne=!0,Ne.diagnosticTracing&&h("mono_download_assets");try{const e=[],t=[],o=(e,t)=>{!G[e.behavior]&&X(e)&&Ne.expected_instantiated_assets_count++,!Z[e.behavior]&&X(e)&&(Ne.expected_downloaded_assets_count++,t.push(le(e)))};for(const t of W)o(t,e);for(const e of F)o(e,t);Ne.allDownloadsQueued.promise_control.resolve(),Promise.all([...e,...t]).then((()=>{Ne.allDownloadsFinished.promise_control.resolve()})).catch((e=>{throw Ne.err("Error in mono_download_assets: "+e),et(1,e),e})),await Ne.runtimeModuleLoaded.promise;const n=async e=>{const t=await e;if(t.buffer){if(!G[t.behavior]){t.buffer&&"object"==typeof t.buffer||qe(!1,"asset buffer must be array-like or buffer-like or promise of these"),"string"!=typeof t.resolvedUrl&&qe(!1,"resolvedUrl must be string");const e=t.resolvedUrl,o=await t.buffer,n=new Uint8Array(o);be(t),await Ue.beforeOnRuntimeInitialized.promise,Ue.instantiate_asset(t,e,n)}}else Q[t.behavior]?("symbols"===t.behavior&&(await Ue.instantiate_symbols_asset(t),be(t)),Q[t.behavior]&&++Ne.actual_downloaded_assets_count):(t.isOptional||qe(!1,"Expected asset to have the downloaded buffer"),!Z[t.behavior]&&X(t)&&Ne.expected_downloaded_assets_count--,!G[t.behavior]&&X(t)&&Ne.expected_instantiated_assets_count--)},r=[],i=[];for(const t of e)r.push(n(t));for(const e of t)i.push(n(e));Promise.all(r).then((()=>{Pe||Ue.coreAssetsInMemory.promise_control.resolve()})).catch((e=>{throw Ne.err("Error in mono_download_assets: "+e),et(1,e),e})),Promise.all(i).then((async()=>{Pe||(await Ue.coreAssetsInMemory.promise,Ue.allAssetsInMemory.promise_control.resolve())})).catch((e=>{throw Ne.err("Error in mono_download_assets: "+e),et(1,e),e}))}catch(e){throw Ne.err("Error in mono_download_assets: "+e),e}}}let ie=!1;function se(){if(ie)return;ie=!0;const e=Ne.config,t=[];if(e.assets)for(const t of e.assets)"object"!=typeof t&&qe(!1,`asset must be object, it was ${typeof t} : ${t}`),"string"!=typeof t.behavior&&qe(!1,"asset behavior must be known string"),"string"!=typeof t.name&&qe(!1,"asset name must be string"),t.resolvedUrl&&"string"!=typeof t.resolvedUrl&&qe(!1,"asset resolvedUrl could be string"),t.hash&&"string"!=typeof t.hash&&qe(!1,"asset resolvedUrl could be string"),t.pendingDownload&&"object"!=typeof t.pendingDownload&&qe(!1,"asset pendingDownload could be object"),t.isCore?W.push(t):F.push(t),ee(t);else if(e.resources){const o=e.resources;o.wasmNative||qe(!1,"resources.wasmNative must be defined"),o.jsModuleNative||qe(!1,"resources.jsModuleNative must be defined"),o.jsModuleRuntime||qe(!1,"resources.jsModuleRuntime must be defined"),o.jsModuleWorker||qe(!1,"resources.jsModuleWorker must be defined"),Y(F,o.wasmNative,"dotnetwasm"),Y(t,o.jsModuleNative,"js-module-native"),Y(t,o.jsModuleRuntime,"js-module-runtime"),o.jsModuleDiagnostics&&Y(t,o.jsModuleDiagnostics,"js-module-diagnostics"),Y(t,o.jsModuleWorker,"js-module-threads");const n=(e,t,o)=>{const n=e;n.behavior=t,o?(n.isCore=!0,W.push(n)):F.push(n)};if(o.coreAssembly)for(let e=0;e<o.coreAssembly.length;e++)n(o.coreAssembly[e],"assembly",!0);if(o.assembly)for(let e=0;e<o.assembly.length;e++)n(o.assembly[e],"assembly",!o.coreAssembly);if(0!=e.debugLevel&&Ne.isDebuggingSupported()){if(o.corePdb)for(let e=0;e<o.corePdb.length;e++)n(o.corePdb[e],"pdb",!0);if(o.pdb)for(let e=0;e<o.pdb.length;e++)n(o.pdb[e],"pdb",!o.corePdb)}if(e.loadAllSatelliteResources&&o.satelliteResources)for(const e in o.satelliteResources)for(let t=0;t<o.satelliteResources[e].length;t++){const r=o.satelliteResources[e][t];r.culture=e,n(r,"resource",!o.coreAssembly)}if(o.coreVfs)for(let e=0;e<o.coreVfs.length;e++)n(o.coreVfs[e],"vfs",!0);if(o.vfs)for(let e=0;e<o.vfs.length;e++)n(o.vfs[e],"vfs",!o.coreVfs);const r=I(e);if(r&&o.icu)for(let e=0;e<o.icu.length;e++){const t=o.icu[e];t.name===r&&n(t,"icu",!1)}if(o.wasmSymbols)for(let e=0;e<o.wasmSymbols.length;e++)n(o.wasmSymbols[e],"symbols",!1)}if(e.appsettings)for(let t=0;t<e.appsettings.length;t++){const o=e.appsettings[t],n=we(o);"appsettings.json"!==n&&n!==`appsettings.${e.applicationEnvironment}.json`||F.push({name:o,behavior:"vfs",cache:"no-cache",useCredentials:!0})}e.assets=[...W,...F,...t]}async function ae(e){const t=await le(e);return await t.pendingDownloadInternal.response,t.buffer}async function le(e){try{return await ce(e)}catch(t){if(!Ne.enableDownloadRetry)throw t;if(Me||De)throw t;if(e.pendingDownload&&e.pendingDownloadInternal==e.pendingDownload)throw t;if(e.resolvedUrl&&-1!=e.resolvedUrl.indexOf("file://"))throw t;if(t&&404==t.status)throw t;e.pendingDownloadInternal=void 0,await Ne.allDownloadsQueued.promise;try{return Ne.diagnosticTracing&&h(`Retrying download '${e.name}'`),await ce(e)}catch(t){return e.pendingDownloadInternal=void 0,await new Promise((e=>globalThis.setTimeout(e,100))),Ne.diagnosticTracing&&h(`Retrying download (2) '${e.name}' after delay`),await ce(e)}}}async function ce(e){for(;$;)await $.promise;try{++z,z==Ne.maxParallelDownloads&&(Ne.diagnosticTracing&&h("Throttling further parallel downloads"),$=i());const t=await async function(e){if(e.pendingDownload&&(e.pendingDownloadInternal=e.pendingDownload),e.pendingDownloadInternal&&e.pendingDownloadInternal.response)return e.pendingDownloadInternal.response;if(e.buffer){const t=await e.buffer;return e.resolvedUrl||(e.resolvedUrl="undefined://"+e.name),e.pendingDownloadInternal={url:e.resolvedUrl,name:e.name,response:Promise.resolve({ok:!0,arrayBuffer:()=>t,json:()=>JSON.parse(new TextDecoder("utf-8").decode(t)),text:()=>{throw new Error("NotImplementedException")},headers:{get:()=>{}}})},e.pendingDownloadInternal.response}const t=e.loadRemote&&Ne.config.remoteSources?Ne.config.remoteSources:[""];let o;for(let n of t){n=n.trim(),"./"===n&&(n="");const t=de(e,n);e.name===t?Ne.diagnosticTracing&&h(`Attempting to download '${t}'`):Ne.diagnosticTracing&&h(`Attempting to download '${t}' for ${e.name}`);try{e.resolvedUrl=t;const n=ge(e);if(e.pendingDownloadInternal=n,o=await n.response,!o||!o.ok)continue;return o}catch(e){o||(o={ok:!1,url:t,status:0,statusText:""+e});continue}}const n=e.isOptional||e.name.match(/\.pdb$/)&&Ne.config.ignorePdbLoadErrors;if(o||qe(!1,`Response undefined ${e.name}`),!n){const t=new Error(`download '${o.url}' for ${e.name} failed ${o.status} ${o.statusText}`);throw t.status=o.status,t}b(`optional download '${o.url}' for ${e.name} failed ${o.status} ${o.statusText}`)}(e);return t?(Q[e.behavior]||(e.buffer=await t.arrayBuffer(),++Ne.actual_downloaded_assets_count),e):e}finally{if(--z,$&&z==Ne.maxParallelDownloads-1){Ne.diagnosticTracing&&h("Resuming more parallel downloads");const e=$;$=void 0,e.promise_control.resolve()}}}function de(e,t){let o;return null==t&&qe(!1,`sourcePrefix must be provided for ${e.name}`),e.resolvedUrl?o=e.resolvedUrl:(o=""===t?"assembly"===e.behavior||"pdb"===e.behavior?e.name:"resource"===e.behavior&&e.culture&&""!==e.culture?`${e.culture}/${e.name}`:e.name:t+e.name,o=ue(Ne.locateFile(o),e.behavior)),o&&"string"==typeof o||qe(!1,"attemptUrl need to be path or url string"),o}function ue(e,t){return Ne.modulesUniqueQuery&&H[t]&&(e+=Ne.modulesUniqueQuery),e}let fe=0;const me=new Set;function ge(e){try{e.resolvedUrl||qe(!1,"Request's resolvedUrl must be set");const t=function(e){let t=e.resolvedUrl;if(Ne.loadBootResource){const o=he(e);if(o instanceof Promise)return o;"string"==typeof o&&(t=o)}const o={};return e.cache?o.cache=e.cache:Ne.config.disableNoCacheFetch||(o.cache="no-cache"),e.useCredentials?o.credentials="include":!Ne.config.disableIntegrityCheck&&e.hash&&(o.integrity=e.hash),Ne.fetch_like(t,o)}(e),o={name:e.name,url:e.resolvedUrl,response:t};return me.add(e.name),o.response.then((()=>{"assembly"==e.behavior&&Ne.loadedAssemblies.push(e.name),fe++,Ne.onDownloadResourceProgress&&Ne.onDownloadResourceProgress(fe,me.size)})),o}catch(t){const o={ok:!1,url:e.resolvedUrl,status:500,statusText:"ERR29: "+t,arrayBuffer:()=>{throw t},json:()=>{throw t}};return{name:e.name,url:e.resolvedUrl,response:Promise.resolve(o)}}}const pe={resource:"assembly",assembly:"assembly",pdb:"pdb",icu:"globalization",vfs:"configuration",manifest:"manifest",dotnetwasm:"dotnetwasm","js-module-dotnet":"dotnetjs","js-module-native":"dotnetjs","js-module-runtime":"dotnetjs","js-module-threads":"dotnetjs"};function he(e){var t;if(Ne.loadBootResource){const o=null!==(t=e.hash)&&void 0!==t?t:"",n=e.resolvedUrl,r=pe[e.behavior];if(r){const t=Ne.loadBootResource(r,e.name,n,o,e.behavior);return"string"==typeof t?M(t):t}}}function be(e){e.pendingDownloadInternal=null,e.pendingDownload=null,e.buffer=null,e.moduleExports=null}function we(e){let t=e.lastIndexOf("/");return t>=0&&t++,e.substring(t)}async function ye(e){e&&await Promise.all((null!=e?e:[]).map((e=>async function(e){try{const t=e.name;if(!e.moduleExports){const o=ue(Ne.locateFile(t),"js-module-library-initializer");Ne.diagnosticTracing&&h(`Attempting to import '${o}' for ${e}`),e.moduleExports=await import(/*! webpackIgnore: true */o)}Ne.libraryInitializers.push({scriptName:t,exports:e.moduleExports})}catch(t){y(`Failed to import library initializer '${e}': ${t}`)}}(e))))}async function ve(e,t){if(!Ne.libraryInitializers)return;const o=[];for(let n=0;n<Ne.libraryInitializers.length;n++){const r=Ne.libraryInitializers[n];r.exports[e]&&o.push(_e(r.scriptName,e,(()=>r.exports[e](...t))))}await Promise.all(o)}async function _e(e,t,o){try{await o()}catch(o){throw y(`Failed to invoke '${t}' on library initializer '${e}': ${o}`),et(1,o),o}}function Ee(e,t){if(e===t)return e;const o={...t};return void 0!==o.assets&&o.assets!==e.assets&&(o.assets=[...e.assets||[],...o.assets||[]]),void 0!==o.resources&&(o.resources=xe(e.resources||{assembly:[],jsModuleNative:[],jsModuleRuntime:[],wasmNative:[]},o.resources)),void 0!==o.environmentVariables&&(o.environmentVariables={...e.environmentVariables||{},...o.environmentVariables||{}}),void 0!==o.runtimeOptions&&o.runtimeOptions!==e.runtimeOptions&&(o.runtimeOptions=[...e.runtimeOptions||[],...o.runtimeOptions||[]]),Object.assign(e,o)}function Te(e,t){if(e===t)return e;const o={...t};return o.config&&(e.config||(e.config={}),o.config=Ee(e.config,o.config)),Object.assign(e,o)}function xe(e,t){if(e===t)return e;const o={...t};return void 0!==o.coreAssembly&&(o.coreAssembly=[...e.coreAssembly||[],...o.coreAssembly||[]]),void 0!==o.assembly&&(o.assembly=[...e.assembly||[],...o.assembly||[]]),void 0!==o.lazyAssembly&&(o.lazyAssembly=[...e.lazyAssembly||[],...o.lazyAssembly||[]]),void 0!==o.corePdb&&(o.corePdb=[...e.corePdb||[],...o.corePdb||[]]),void 0!==o.pdb&&(o.pdb=[...e.pdb||[],...o.pdb||[]]),void 0!==o.jsModuleWorker&&(o.jsModuleWorker=[...e.jsModuleWorker||[],...o.jsModuleWorker||[]]),void 0!==o.jsModuleNative&&(o.jsModuleNative=[...e.jsModuleNative||[],...o.jsModuleNative||[]]),void 0!==o.jsModuleDiagnostics&&(o.jsModuleDiagnostics=[...e.jsModuleDiagnostics||[],...o.jsModuleDiagnostics||[]]),void 0!==o.jsModuleRuntime&&(o.jsModuleRuntime=[...e.jsModuleRuntime||[],...o.jsModuleRuntime||[]]),void 0!==o.wasmSymbols&&(o.wasmSymbols=[...e.wasmSymbols||[],...o.wasmSymbols||[]]),void 0!==o.wasmNative&&(o.wasmNative=[...e.wasmNative||[],...o.wasmNative||[]]),void 0!==o.icu&&(o.icu=[...e.icu||[],...o.icu||[]]),void 0!==o.satelliteResources&&(o.satelliteResources=function(e,t){if(e===t)return e;for(const o in t)e[o]=[...e[o]||[],...t[o]||[]];return e}(e.satelliteResources||{},o.satelliteResources||{})),void 0!==o.modulesAfterConfigLoaded&&(o.modulesAfterConfigLoaded=[...e.modulesAfterConfigLoaded||[],...o.modulesAfterConfigLoaded||[]]),void 0!==o.modulesAfterRuntimeReady&&(o.modulesAfterRuntimeReady=[...e.modulesAfterRuntimeReady||[],...o.modulesAfterRuntimeReady||[]]),void 0!==o.extensions&&(o.extensions={...e.extensions||{},...o.extensions||{}}),void 0!==o.vfs&&(o.vfs=[...e.vfs||[],...o.vfs||[]]),Object.assign(e,o)}function je(){const e=Ne.config;if(e.environmentVariables=e.environmentVariables||{},e.runtimeOptions=e.runtimeOptions||[],e.resources=e.resources||{assembly:[],jsModuleNative:[],jsModuleWorker:[],jsModuleRuntime:[],wasmNative:[],vfs:[],satelliteResources:{}},e.assets){Ne.diagnosticTracing&&h("config.assets is deprecated, use config.resources instead");for(const t of e.assets){const o={};switch(t.behavior){case"assembly":o.assembly=[t];break;case"pdb":o.pdb=[t];break;case"resource":o.satelliteResources={},o.satelliteResources[t.culture]=[t];break;case"icu":o.icu=[t];break;case"symbols":o.wasmSymbols=[t];break;case"vfs":o.vfs=[t];break;case"dotnetwasm":o.wasmNative=[t];break;case"js-module-threads":o.jsModuleWorker=[t];break;case"js-module-runtime":o.jsModuleRuntime=[t];break;case"js-module-native":o.jsModuleNative=[t];break;case"js-module-diagnostics":o.jsModuleDiagnostics=[t];break;case"js-module-dotnet":break;default:throw new Error(`Unexpected behavior ${t.behavior} of asset ${t.name}`)}xe(e.resources,o)}}e.debugLevel,e.applicationEnvironment||(e.applicationEnvironment="Production"),Number.isInteger(e.pthreadPoolInitialSize)||(e.pthreadPoolInitialSize=5),Number.isInteger(e.pthreadPoolUnusedSize)||(e.pthreadPoolUnusedSize=1),null==e.jsThreadBlockingMode&&(e.jsThreadBlockingMode="PreventSynchronousJSExport"),void 0===e.environmentVariables.MONO_SLEEP_ABORT_LIMIT&&(e.environmentVariables.MONO_SLEEP_ABORT_LIMIT="5000"),e.applicationCulture&&(e.environmentVariables.LANG=`${e.applicationCulture}.UTF-8`),Ue.diagnosticTracing=Ne.diagnosticTracing=!!e.diagnosticTracing,Ue.waitForDebugger=e.waitForDebugger,Ne.maxParallelDownloads=e.maxParallelDownloads||Ne.maxParallelDownloads,Ne.enableDownloadRetry=void 0!==e.enableDownloadRetry?e.enableDownloadRetry:Ne.enableDownloadRetry}let Re=!1;async function Se(e){var t;if(Re)return void await Ne.afterConfigLoaded.promise;let o;try{if(e.configSrc||Ne.config&&0!==Object.keys(Ne.config).length&&(Ne.config.assets||Ne.config.resources)||(e.configSrc="dotnet.boot.js"),o=e.configSrc,Re=!0,o&&(Ne.diagnosticTracing&&h("mono_wasm_load_config"),await async function(e){const t=e.configSrc,o=Ne.locateFile(t);let n=null;void 0!==Ne.loadBootResource&&(n=Ne.loadBootResource("manifest",t,o,"","manifest"));let r,i=null;if(n)if("string"==typeof n)n.includes(".json")?(i=await s(M(n)),r=await Oe(i)):r=(await import(M(n))).config;else{const e=await n;"function"==typeof e.json?(i=e,r=await Oe(i)):r=e.config}else o.includes(".json")?(i=await s(ue(o,"manifest")),r=await Oe(i)):r=(await import(ue(o,"manifest"))).config;function s(e){return Ne.fetch_like(e,{method:"GET",credentials:"include",cache:"no-cache"})}Ne.config.applicationEnvironment&&(r.applicationEnvironment=Ne.config.applicationEnvironment),Ee(Ne.config,r)}(e)),je(),await ye(null===(t=Ne.config.resources)||void 0===t?void 0:t.modulesAfterConfigLoaded),await ve("onRuntimeConfigLoaded",[Ne.config]),e.onConfigLoaded)try{await e.onConfigLoaded(Ne.config,$e),je()}catch(e){throw v("onConfigLoaded() failed",e),e}je(),Ne.afterConfigLoaded.promise_control.resolve(Ne.config)}catch(t){const n=`Failed to load config file ${o} ${t} ${null==t?void 0:t.stack}`;throw Ne.config=e.config=Object.assign(Ne.config,{message:n,error:t,isError:!0}),et(1,new Error(n)),t}}function Ae(){return!!globalThis.navigator&&(Ne.isChromium||Ne.isFirefox)}async function Oe(e){const t=Ne.config,o=await e.json();t.applicationEnvironment||o.applicationEnvironment||(o.applicationEnvironment=e.headers.get("Blazor-Environment")||e.headers.get("DotNet-Environment")||void 0),o.environmentVariables||(o.environmentVariables={});const n=e.headers.get("DOTNET-MODIFIABLE-ASSEMBLIES");n&&(o.environmentVariables.DOTNET_MODIFIABLE_ASSEMBLIES=n);const r=e.headers.get("ASPNETCORE-BROWSER-TOOLS");return r&&(o.environmentVariables.__ASPNETCORE_BROWSER_TOOLS=r),o}"function"!=typeof importScripts||globalThis.onmessage||(globalThis.dotnetSidecar=!0);const De="object"==typeof process&&"object"==typeof process.versions&&"string"==typeof process.versions.node,ke="function"==typeof importScripts,Ie=ke&&"undefined"!=typeof dotnetSidecar,Pe=ke&&!Ie,Ce="object"==typeof window||ke&&!De,Me=!Ce&&!De;let Ue={},Ne={},Le={},$e={},ze={},We=!1;const Fe={},Be={config:Fe},Ve={mono:{},binding:{},internal:ze,module:Be,loaderHelpers:Ne,runtimeHelpers:Ue,diagnosticHelpers:Le,api:$e};function qe(e,t){if(e)return;const o="Assert failed: "+("function"==typeof t?t():t),n=new Error(o);v(o,n),Ue.nativeAbort(n)}function Je(){return void 0!==Ne.exitCode}function He(){return Ue.runtimeReady&&!Je()}function Ze(){Je()&&qe(!1,`.NET runtime already exited with ${Ne.exitCode} ${Ne.exitReason}. You can use runtime.runMain() which doesn't exit the runtime.`),Pe?Ue.runtimeReady||qe(!1,"The WebWorker is not attached to the runtime. See https://github.com/dotnet/runtime/blob/main/src/mono/wasm/threads.md#JS-interop-on-dedicated-threads"):Ue.runtimeReady||qe(!1,".NET runtime didn't start yet. Please call dotnet.create() first.")}function Qe(){Ce&&(globalThis.addEventListener("unhandledrejection",ot),globalThis.addEventListener("error",nt))}let Ge,Ke;function Xe(e){Ke&&Ke(e),et(e,Ne.exitReason)}function Ye(e){var t;if(Ge&&Ge(e||Ne.exitReason),(null===(t=Ne.config)||void 0===t?void 0:t.dumpThreadsOnNonZeroExit)&&Ue.mono_wasm_print_thread_dump&&void 0===Ne.exitCode)try{Ue.mono_wasm_print_thread_dump()}catch(e){}et(1,e||Ne.exitReason)}function et(t,o){var n,r;const i=o&&"object"==typeof o;t=i&&"number"==typeof o.status?o.status:void 0===t?-1:t;const s=i&&"string"==typeof o.message?o.message:""+o;(o=i?o:Ue.ExitStatus?function(e,t){const o=new Ue.ExitStatus(e);return o.message=t,o.toString=()=>t,o}(t,s):new Error("Exit with code "+t+" "+s)).status=t,o.message||(o.message=s);const a=""+(o.stack||(new Error).stack);try{Object.defineProperty(o,"stack",{get:()=>a})}catch(e){}const l=!!o.silent;if(o.silent=!0,Je())Ne.diagnosticTracing&&h("mono_exit called after exit");else{try{Be.onAbort==Ye&&(Be.onAbort=Ge),Be.onExit==Xe&&(Be.onExit=Ke),Ce&&(globalThis.removeEventListener("unhandledrejection",ot),globalThis.removeEventListener("error",nt)),Ue.runtimeReady?(Ue.jiterpreter_dump_stats&&Ue.jiterpreter_dump_stats(!1),0===t&&(null===(n=Ne.config)||void 0===n?void 0:n.interopCleanupOnExit)&&Ue.forceDisposeProxies(!0,!0),e&&0!==t&&(null===(r=Ne.config)||void 0===r?void 0:r.dumpThreadsOnNonZeroExit)&&Ue.dumpThreads()):(Ne.diagnosticTracing&&h(`abort_startup, reason: ${o}`),function(e){Ne.allDownloadsQueued.promise_control.reject(e),Ne.allDownloadsFinished.promise_control.reject(e),Ne.afterConfigLoaded.promise_control.reject(e),Ne.wasmCompilePromise.promise_control.reject(e),Ne.runtimeModuleLoaded.promise_control.reject(e),Ue.dotnetReady&&(Ue.dotnetReady.promise_control.reject(e),Ue.afterInstantiateWasm.promise_control.reject(e),Ue.beforePreInit.promise_control.reject(e),Ue.afterPreInit.promise_control.reject(e),Ue.afterPreRun.promise_control.reject(e),Ue.beforeOnRuntimeInitialized.promise_control.reject(e),Ue.afterOnRuntimeInitialized.promise_control.reject(e),Ue.afterPostRun.promise_control.reject(e))}(o))}catch(e){y("mono_exit A failed",e)}try{l||(function(e,t){if(0!==e&&t){const e=Ue.ExitStatus&&t instanceof Ue.ExitStatus?h:v;"string"==typeof t?e(t):(void 0===t.stack&&(t.stack=(new Error).stack+""),t.message?e(Ue.stringify_as_error_with_stack?Ue.stringify_as_error_with_stack(t.message+"\n"+t.stack):t.message+"\n"+t.stack):e(JSON.stringify(t)))}!Pe&&Ne.config&&(Ne.config.logExitCode?Ne.config.forwardConsoleLogsToWS?S("WASM EXIT "+e):w("WASM EXIT "+e):Ne.config.forwardConsoleLogsToWS&&S())}(t,o),function(e){if(Ce&&!Pe&&Ne.config&&Ne.config.appendElementOnExit&&document){const t=document.createElement("label");t.id="tests_done",0!==e&&(t.style.background="red"),t.innerHTML=""+e,document.body.appendChild(t)}}(t))}catch(e){y("mono_exit B failed",e)}Ne.exitCode=t,Ne.exitReason||(Ne.exitReason=o),!Pe&&Ue.runtimeReady&&Be.runtimeKeepalivePop()}if(Ne.config&&Ne.config.asyncFlushOnExit&&0===t)throw(async()=>{try{await async function(){try{const e=await import(/*! webpackIgnore: true */"process"),t=e=>new Promise(((t,o)=>{e.on("error",o),e.end("","utf8",t)})),o=t(e.stderr),n=t(e.stdout);let r;const i=new Promise((e=>{r=setTimeout((()=>e("timeout")),1e3)}));await Promise.race([Promise.all([n,o]),i]),clearTimeout(r)}catch(e){v(`flushing std* streams failed: ${e}`)}}()}finally{tt(t,o)}})(),o;tt(t,o)}function tt(e,t){if(Pe&&Ue.runtimeReady&&Ue.nativeAbort)throw Ue.nativeAbort(t),t;if(Ue.runtimeReady&&Ue.nativeExit)try{Ue.nativeExit(e)}catch(e){!Ue.ExitStatus||e instanceof Ue.ExitStatus||y("set_exit_code_and_quit_now failed: "+e.toString())}if(0!==e||!Ce)throw De&&ze.process?ze.process.exit(e):Ue.quit&&Ue.quit(e,t),t}function ot(e){rt(e,e.reason,"rejection")}function nt(e){rt(e,e.error,"error")}function rt(e,t,o){e.preventDefault();try{t||(t=new Error("Unhandled "+o)),void 0===t.stack&&(t.stack=(new Error).stack),t.stack=t.stack+"",t.silent||(v("Unhandled error:",t),et(1,t))}catch(e){}}!function(e){if(We)throw new Error("Loader module already loaded");We=!0,Ue=e.runtimeHelpers,Ne=e.loaderHelpers,Le=e.diagnosticHelpers,$e=e.api,ze=e.internal,Object.assign($e,{INTERNAL:ze,invokeLibraryInitializers:ve}),Object.assign(e.module,{config:Ee(Fe,{environmentVariables:{}})});const r={mono_wasm_bindings_is_ready:!1,config:e.module.config,diagnosticTracing:!1,nativeAbort:e=>{throw e||new Error("abort")},nativeExit:e=>{throw new Error("exit:"+e)}},l={gitHash:"0427b9abbead3fa64c6655eb4290c537397131fa",config:e.module.config,diagnosticTracing:!1,maxParallelDownloads:16,enableDownloadRetry:!0,_loaded_files:[],loadedFiles:[],loadedAssemblies:[],libraryInitializers:[],workerNextNumber:1,actual_downloaded_assets_count:0,actual_instantiated_assets_count:0,expected_downloaded_assets_count:0,expected_instantiated_assets_count:0,afterConfigLoaded:i(),allDownloadsQueued:i(),allDownloadsFinished:i(),wasmCompilePromise:i(),runtimeModuleLoaded:i(),loadingWorkers:i(),is_exited:Je,is_runtime_running:He,assert_runtime_running:Ze,mono_exit:et,createPromiseController:i,getPromiseController:s,assertIsControllablePromise:a,mono_download_assets:re,resolve_single_asset_path:oe,setup_proxy_console:R,set_thread_prefix:p,installUnhandledErrorHandler:Qe,retrieve_asset_download:ae,invokeLibraryInitializers:ve,isDebuggingSupported:Ae,exceptions:t,simd:n,relaxedSimd:o};Object.assign(Ue,r),Object.assign(Ne,l)}(Ve);let it,st,at,lt=!1,ct=!1;async function dt(e){if(!ct){if(ct=!0,Ce&&Ne.config.forwardConsoleLogsToWS&&void 0!==globalThis.WebSocket&&R("main",globalThis.console,globalThis.location.origin),Be||qe(!1,"Null moduleConfig"),Ne.config||qe(!1,"Null moduleConfig.config"),"function"==typeof e){const t=e(Ve.api);if(t.ready)throw new Error("Module.ready couldn't be redefined.");Object.assign(Be,t),Te(Be,t)}else{if("object"!=typeof e)throw new Error("Can't use moduleFactory callback of createDotnetRuntime function.");Te(Be,e)}await async function(e){if(De){const e=await import(/*! webpackIgnore: true */"process"),t=14;if(e.versions.node.split(".")[0]<t)throw new Error(`NodeJS at '${e.execPath}' has too low version '${e.versions.node}', please use at least ${t}. See also https://aka.ms/dotnet-wasm-features`)}const t=/*! webpackIgnore: true */import.meta.url,o=t.indexOf("?");var n;if(o>0&&(Ne.modulesUniqueQuery=t.substring(o)),Ne.scriptUrl=t.replace(/\\/g,"/").replace(/[?#].*/,""),Ne.scriptDirectory=(n=Ne.scriptUrl).slice(0,n.lastIndexOf("/"))+"/",Ne.locateFile=e=>"URL"in globalThis&&globalThis.URL!==P?new URL(e,Ne.scriptDirectory).toString():L(e)?e:Ne.scriptDirectory+e,Ne.fetch_like=C,Ne.out=console.log,Ne.err=console.error,Ne.onDownloadResourceProgress=e.onDownloadResourceProgress,Ce&&globalThis.navigator){const e=globalThis.navigator,t=e.userAgentData&&e.userAgentData.brands;t&&t.length>0?Ne.isChromium=t.some((e=>"Google Chrome"===e.brand||"Microsoft Edge"===e.brand||"Chromium"===e.brand)):e.userAgent&&(Ne.isChromium=e.userAgent.includes("Chrome"),Ne.isFirefox=e.userAgent.includes("Firefox"))}ze.require=De?await import(/*! webpackIgnore: true */"module").then((e=>e.createRequire(/*! webpackIgnore: true */import.meta.url))):Promise.resolve((()=>{throw new Error("require not supported")})),void 0===globalThis.URL&&(globalThis.URL=P)}(Be)}}async function ut(e){return await dt(e),Ge=Be.onAbort,Ke=Be.onExit,Be.onAbort=Ye,Be.onExit=Xe,Be.ENVIRONMENT_IS_PTHREAD?async function(){(function(){const e=new MessageChannel,t=e.port1,o=e.port2;t.addEventListener("message",(e=>{var n,r;n=JSON.parse(e.data.config),r=JSON.parse(e.data.monoThreadInfo),lt?Ne.diagnosticTracing&&h("mono config already received"):(Ee(Ne.config,n),Ue.monoThreadInfo=r,je(),Ne.diagnosticTracing&&h("mono config received"),lt=!0,Ne.afterConfigLoaded.promise_control.resolve(Ne.config),Ce&&n.forwardConsoleLogsToWS&&void 0!==globalThis.WebSocket&&Ne.setup_proxy_console("worker-idle",console,globalThis.location.origin)),t.close(),o.close()}),{once:!0}),t.start(),self.postMessage({[l]:{monoCmd:"preload",port:o}},[o])})(),await Ne.afterConfigLoaded.promise,function(){const e=Ne.config;e.assets||qe(!1,"config.assets must be defined");for(const t of e.assets)ee(t),K[t.behavior]&&F.push(t)}(),setTimeout((async()=>{try{await re()}catch(e){et(1,e)}}),0);const e=ft(),t=await Promise.all(e);return await mt(t),Be}():async function(){var e;await Se(Be),se();const t=ft();(async function(){try{const e=oe("dotnetwasm");await le(e),e&&e.pendingDownloadInternal&&e.pendingDownloadInternal.response||qe(!1,"Can't load dotnet.native.wasm");const t=await e.pendingDownloadInternal.response,o=t.headers&&t.headers.get?t.headers.get("Content-Type"):void 0;let n;if("function"==typeof WebAssembly.compileStreaming&&"application/wasm"===o)n=await WebAssembly.compileStreaming(t);else{Ce&&"application/wasm"!==o&&y('WebAssembly resource does not have the expected content type "application/wasm", so falling back to slower ArrayBuffer instantiation.');const e=await t.arrayBuffer();Ne.diagnosticTracing&&h("instantiate_wasm_module buffered"),n=Me?await Promise.resolve(new WebAssembly.Module(e)):await WebAssembly.compile(e)}e.pendingDownloadInternal=null,e.pendingDownload=null,e.buffer=null,e.moduleExports=null,Ne.wasmCompilePromise.promise_control.resolve(n)}catch(e){Ne.wasmCompilePromise.promise_control.reject(e)}})(),setTimeout((async()=>{try{k(),function(){const e=oe("js-module-threads"),t=[];for(let o=0;o<Ne.config.pthreadPoolInitialSize;o++){const o=Ne.workerNextNumber++,n=new Worker(e.resolvedUrl,{name:"dotnet-worker-"+o.toString().padStart(3,"0"),type:"module"});n.info={workerNumber:o,pthreadId:0,reuseCount:0,updateCount:0,threadPrefix:"          -    ",threadName:"emscripten-pool"},t.push(n)}Ne.loadingWorkers.promise_control.resolve(t)}(),await re()}catch(e){et(1,e)}}),0);const o=await Promise.all(t);return await mt(o),await Ue.dotnetReady.promise,await ye(null===(e=Ne.config.resources)||void 0===e?void 0:e.modulesAfterRuntimeReady),await ve("onRuntimeReady",[Ve.api]),$e}()}function ft(){const e=oe("js-module-runtime"),t=oe("js-module-native");if(it&&st)return[it,st,at];"object"==typeof e.moduleExports?it=e.moduleExports:(Ne.diagnosticTracing&&h(`Attempting to import '${e.resolvedUrl}' for ${e.name}`),it=import(/*! webpackIgnore: true */e.resolvedUrl)),"object"==typeof t.moduleExports?st=t.moduleExports:(Ne.diagnosticTracing&&h(`Attempting to import '${t.resolvedUrl}' for ${t.name}`),st=import(/*! webpackIgnore: true */t.resolvedUrl));const o=te("js-module-diagnostics");return o&&("object"==typeof o.moduleExports?at=o.moduleExports:(Ne.diagnosticTracing&&h(`Attempting to import '${o.resolvedUrl}' for ${o.name}`),at=import(/*! webpackIgnore: true */o.resolvedUrl))),[it,st,at]}async function mt(e){const{initializeExports:t,initializeReplacements:o,configureRuntimeStartup:n,configureEmscriptenStartup:r,configureWorkerStartup:i,setRuntimeGlobals:s,passEmscriptenInternals:a}=e[0],{default:l}=e[1],c=e[2];s(Ve),t(Ve),c&&c.setRuntimeGlobals(Ve),await n(Be),Ne.runtimeModuleLoaded.promise_control.resolve(),l((e=>(Object.assign(Be,{ready:e.ready,__dotnet_runtime:{initializeReplacements:o,configureEmscriptenStartup:r,configureWorkerStartup:i,passEmscriptenInternals:a}}),Be))).catch((e=>{if(e.message&&e.message.toLowerCase().includes("out of memory"))throw new Error(".NET runtime has failed to start, because too much memory was requested. Please decrease the memory by adjusting EmccMaximumHeapSize. See also https://aka.ms/dotnet-wasm-features");throw e}))}const gt=new class{withModuleConfig(e){try{return Te(Be,e),this}catch(e){throw et(1,e),e}}withOnConfigLoaded(e){try{return Te(Be,{onConfigLoaded:e}),this}catch(e){throw et(1,e),e}}withConsoleForwarding(){try{return Ee(Fe,{forwardConsoleLogsToWS:!0}),this}catch(e){throw et(1,e),e}}withExitOnUnhandledError(){try{return Ee(Fe,{exitOnUnhandledError:!0}),Qe(),this}catch(e){throw et(1,e),e}}withAsyncFlushOnExit(){try{return Ee(Fe,{asyncFlushOnExit:!0}),this}catch(e){throw et(1,e),e}}withExitCodeLogging(){try{return Ee(Fe,{logExitCode:!0}),this}catch(e){throw et(1,e),e}}withElementOnExit(){try{return Ee(Fe,{appendElementOnExit:!0}),this}catch(e){throw et(1,e),e}}withInteropCleanupOnExit(){try{return Ee(Fe,{interopCleanupOnExit:!0}),this}catch(e){throw et(1,e),e}}withDumpThreadsOnNonZeroExit(){try{return Ee(Fe,{dumpThreadsOnNonZeroExit:!0}),this}catch(e){throw et(1,e),e}}withWaitingForDebugger(e){try{return Ee(Fe,{waitForDebugger:e}),this}catch(e){throw et(1,e),e}}withInterpreterPgo(e,t){try{return Ee(Fe,{interpreterPgo:e,interpreterPgoSaveDelay:t}),Fe.runtimeOptions?Fe.runtimeOptions.push("--interp-pgo-recording"):Fe.runtimeOptions=["--interp-pgo-recording"],this}catch(e){throw et(1,e),e}}withConfig(e){try{return Ee(Fe,e),this}catch(e){throw et(1,e),e}}withConfigSrc(e){try{return e&&"string"==typeof e||qe(!1,"must be file path or URL"),Te(Be,{configSrc:e}),this}catch(e){throw et(1,e),e}}withVirtualWorkingDirectory(e){try{return e&&"string"==typeof e||qe(!1,"must be directory path"),Ee(Fe,{virtualWorkingDirectory:e}),this}catch(e){throw et(1,e),e}}withEnvironmentVariable(e,t){try{const o={};return o[e]=t,Ee(Fe,{environmentVariables:o}),this}catch(e){throw et(1,e),e}}withEnvironmentVariables(e){try{return e&&"object"==typeof e||qe(!1,"must be dictionary object"),Ee(Fe,{environmentVariables:e}),this}catch(e){throw et(1,e),e}}withDiagnosticTracing(e){try{return"boolean"!=typeof e&&qe(!1,"must be boolean"),Ee(Fe,{diagnosticTracing:e}),this}catch(e){throw et(1,e),e}}withDebugging(e){try{return null!=e&&"number"==typeof e||qe(!1,"must be number"),Ee(Fe,{debugLevel:e}),this}catch(e){throw et(1,e),e}}withApplicationArguments(...e){try{return e&&Array.isArray(e)||qe(!1,"must be array of strings"),Ee(Fe,{applicationArguments:e}),this}catch(e){throw et(1,e),e}}withRuntimeOptions(e){try{return e&&Array.isArray(e)||qe(!1,"must be array of strings"),Fe.runtimeOptions?Fe.runtimeOptions.push(...e):Fe.runtimeOptions=e,this}catch(e){throw et(1,e),e}}withMainAssembly(e){try{return Ee(Fe,{mainAssemblyName:e}),this}catch(e){throw et(1,e),e}}withApplicationArgumentsFromQuery(){try{if(!globalThis.window)throw new Error("Missing window to the query parameters from");if(void 0===globalThis.URLSearchParams)throw new Error("URLSearchParams is supported");const e=new URLSearchParams(globalThis.window.location.search).getAll("arg");return this.withApplicationArguments(...e)}catch(e){throw et(1,e),e}}withApplicationEnvironment(e){try{return Ee(Fe,{applicationEnvironment:e}),this}catch(e){throw et(1,e),e}}withApplicationCulture(e){try{return Ee(Fe,{applicationCulture:e}),this}catch(e){throw et(1,e),e}}withResourceLoader(e){try{return Ne.loadBootResource=e,this}catch(e){throw et(1,e),e}}async download(){try{await async function(){dt(Be),await Se(Be),se(),k(),re(),await Ne.allDownloadsFinished.promise}()}catch(e){throw et(1,e),e}}async create(){try{return this.instance||(this.instance=await async function(){return await ut(Be),Ve.api}()),this.instance}catch(e){throw et(1,e),e}}async run(){try{return Be.config||qe(!1,"Null moduleConfig.config"),this.instance||await this.create(),this.instance.runMainAndExit()}catch(e){throw et(1,e),e}}},pt=et,ht=ut;Me||"function"==typeof globalThis.URL||qe(!1,"This browser/engine doesn't support URL API. Please use a modern version. See also https://aka.ms/dotnet-wasm-features"),"function"!=typeof globalThis.BigInt64Array&&qe(!1,"This browser/engine doesn't support BigInt64Array API. Please use a modern version. See also https://aka.ms/dotnet-wasm-features"),(Me||De)&&qe(!1,"This build of dotnet is multi-threaded, it doesn't support shell environments like V8 or NodeJS. See also https://aka.ms/dotnet-wasm-features"),void 0===globalThis.SharedArrayBuffer&&qe(!1,"SharedArrayBuffer is not enabled on this page. Please use a modern browser and set Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy http headers. See also https://aka.ms/dotnet-wasm-features"),"function"!=typeof globalThis.EventTarget&&qe(!1,"This browser/engine doesn't support EventTarget API. Please use a modern version. See also https://aka.ms/dotnet-wasm-features"),gt.withConfig(/*json-start*/{
  "mainAssemblyName": "NxInfinity",
  "resources": {
    "hash": "sha256-Qjh9iWN4LAh7QZHUDI3B2QZurbqUxLNI9no+ROzqChw=",
    "jsModuleWorker": [
      {
        "name": "dotnet.native.worker.8duaz980cg.mjs"
      }
    ],
    "jsModuleNative": [
      {
        "name": "dotnet.native.tr2058r0ov.js"
      }
    ],
    "jsModuleRuntime": [
      {
        "name": "dotnet.runtime.ncwn8rd524.js"
      }
    ],
    "wasmNative": [
      {
        "name": "dotnet.native.i7mgrkq60z.wasm",
        "hash": "sha256-br+Npk2AyGMBbN6YnBk4kB1wBKHWAbj1/Q9I8tqvlU0=",
        "cache": "force-cache"
      }
    ],
    "icu": [
      {
        "virtualPath": "icudt_CJK.dat",
        "name": "icudt_CJK.tjcz0u77k5.dat",
        "hash": "sha256-SZLtQnRc0JkwqHab0VUVP7T3uBPSeYzxzDnpxPpUnHk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "icudt_EFIGS.dat",
        "name": "icudt_EFIGS.tptq2av103.dat",
        "hash": "sha256-8fItetYY8kQ0ww6oxwTLiT3oXlBwHKumbeP2pRF4yTc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "icudt_no_CJK.dat",
        "name": "icudt_no_CJK.lfu7j35m59.dat",
        "hash": "sha256-L7sV7NEYP37/Qr2FPCePo5cJqRgTXRwGHuwF5Q+0Nfs=",
        "cache": "force-cache"
      }
    ],
    "coreAssembly": [
      {
        "virtualPath": "ARMeilleure.wasm",
        "name": "ARMeilleure.fezy6cd64x.wasm",
        "hash": "sha256-SVJcEPVqe+CZDPYmp/O7vh3CubmegWNnBAdc0RME110=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Base.wasm",
        "name": "Avalonia.Base.cs3xsehzux.wasm",
        "hash": "sha256-bPWOy7uqzVJNechHTnH12C088hClXntw3JD3Upp0dBk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Browser.wasm",
        "name": "Avalonia.Browser.vwpwwjwsck.wasm",
        "hash": "sha256-0WhNd5fI78+VZU9y7/qTq9l4FkB/tRyYVlDaF8o3L50=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Controls.wasm",
        "name": "Avalonia.Controls.jq1nqh6pac.wasm",
        "hash": "sha256-dblHmLu0om2Ca9TzePd0797Qh/vzTjOqX4/WVcEk2OU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.DesignerSupport.wasm",
        "name": "Avalonia.DesignerSupport.p1tw3n3nmr.wasm",
        "hash": "sha256-8xVAaM5d1OGGKQvM6VYLzkDg/n24mRPlmsDX7m9tEuc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Dialogs.wasm",
        "name": "Avalonia.Dialogs.zwrt1cmpyt.wasm",
        "hash": "sha256-bdybbHydgIGZZF43VIpkkPd6eSpDh6kD0+QXUe2LFrQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Fonts.Inter.wasm",
        "name": "Avalonia.Fonts.Inter.vbbi0svo3z.wasm",
        "hash": "sha256-JRYhHnQHhAjaTW0eQgP+8UvsOXfa1bHz4vLHTaBAaJs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.HarfBuzz.wasm",
        "name": "Avalonia.HarfBuzz.q66dztodxj.wasm",
        "hash": "sha256-bkiBZpKvVESRiDLa4l6V+OJ2u9AUdhnvBwQ0LbyCztE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Markup.Xaml.wasm",
        "name": "Avalonia.Markup.Xaml.6w7ax4v5wd.wasm",
        "hash": "sha256-ijjC0gN/4y2xsqlR0Tk1GD3TViGwnEhvwHjjRdAz++I=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Markup.wasm",
        "name": "Avalonia.Markup.jn00i1cph2.wasm",
        "hash": "sha256-T/mJKM1K44YRWRYCdTs/jf3QghOQW60E6Vca+TLtcC4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Metal.wasm",
        "name": "Avalonia.Metal.genui578yu.wasm",
        "hash": "sha256-CDgy6ZI4mA68HzJ7zcVH+jC7mRKphgEssy8t9WE86tk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.OpenGL.wasm",
        "name": "Avalonia.OpenGL.vx8ag1q80q.wasm",
        "hash": "sha256-PWAyaz0/e/7rtZTjoBPgGKC0mPL617bFA3eCZ6h6cRI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Remote.Protocol.wasm",
        "name": "Avalonia.Remote.Protocol.1bbvgur8qv.wasm",
        "hash": "sha256-A71Rk+IOOyWQzXlCc1euTX84gt7FK2BRAdpaxu9dLOg=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Skia.wasm",
        "name": "Avalonia.Skia.4bmr30qh4i.wasm",
        "hash": "sha256-UJOpFq/h8NqqRX91nnHvQp9yvjfPBKor5n9tu0zXjdE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Themes.Fluent.wasm",
        "name": "Avalonia.Themes.Fluent.6e3osc0lh3.wasm",
        "hash": "sha256-0kz50LQvBr2BkH+NABAHGjtTnhxFa28m/d0T7TbU+1w=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.Vulkan.wasm",
        "name": "Avalonia.Vulkan.iiqn3r23t2.wasm",
        "hash": "sha256-BgsFdKpDSnWVZd1mEqinNhoa3up9y8zWkoujp3FwltQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Avalonia.wasm",
        "name": "Avalonia.g4xgprh55m.wasm",
        "hash": "sha256-sGDQtRk3Y4wC2UlnXfaxSWzl/gD03jV9EDH283vB6CY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Concentus.wasm",
        "name": "Concentus.bpcksb9r5u.wasm",
        "hash": "sha256-T3WmI8J1bxRshucXVVtlk/Lw1O7jKfiuwYu6RdlIy20=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Gommon.wasm",
        "name": "Gommon.b955lu4iew.wasm",
        "hash": "sha256-39aHQkxLhnB0fd06RUNFtHqmnR1XCiJZcotyQ8i+kXY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "HarfBuzzSharp.wasm",
        "name": "HarfBuzzSharp.l8os7h8dfb.wasm",
        "hash": "sha256-S4tWaXMHU6a/1INQkEjHGMqQNXX6P+IEHaViiewf7Ok=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Humanizer.wasm",
        "name": "Humanizer.99gzq3p7w0.wasm",
        "hash": "sha256-8ywQ6TpvymPVJ4qbZLbt+aLMylldEhxBJgrVFmi1rEw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "JetBrains.Annotations.wasm",
        "name": "JetBrains.Annotations.spkbd72w7n.wasm",
        "hash": "sha256-YPnGRie2Ja62rec0Sdkjgz8bnbQTH0sXjjFvbUuVRIQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "LibHac.wasm",
        "name": "LibHac.3vrebd9zp1.wasm",
        "hash": "sha256-jxO2Bm72q0tHUT/zYc6VQEctfRZugrdQE2nBTiCD2yc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.CSharp.wasm",
        "name": "Microsoft.CSharp.1amb3vydlv.wasm",
        "hash": "sha256-iWR5Ubw4POV2tFBO03ZIca4xqRVAENVbcWGFvvOQEyY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.IO.RecyclableMemoryStream.wasm",
        "name": "Microsoft.IO.RecyclableMemoryStream.cp3ntll1nq.wasm",
        "hash": "sha256-gEyPGNC/5+TmnQlSb89ZwIiOtjCEz+sidhSuZyYkx7o=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.IdentityModel.Abstractions.wasm",
        "name": "Microsoft.IdentityModel.Abstractions.8ri5mhvm24.wasm",
        "hash": "sha256-zOeU1u9HrkmRLhg/HrVJHSQyR9k3l3VgFlJaWXJhWb8=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.IdentityModel.JsonWebTokens.wasm",
        "name": "Microsoft.IdentityModel.JsonWebTokens.cev311igbh.wasm",
        "hash": "sha256-tCapPcZOpEAyHuGx1wfAjxL1x4wkiXuX4Mhgk1sI8Ds=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.IdentityModel.Logging.wasm",
        "name": "Microsoft.IdentityModel.Logging.wolom7re16.wasm",
        "hash": "sha256-0AW3jwDmidQGfhf5n3bJymEVHbbowVYsvvHVI5pDsd4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.IdentityModel.Tokens.wasm",
        "name": "Microsoft.IdentityModel.Tokens.k0zrc5s8ah.wasm",
        "hash": "sha256-BGoif8cFlJw/Mb+AmTD+IJJRjCXhtcP9vTYDk1csni8=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Microsoft.Win32.Primitives.wasm",
        "name": "Microsoft.Win32.Primitives.jrqxmzyurq.wasm",
        "hash": "sha256-v+e+q/q6hnZ4oolBmJ7PIvfHle7/7MvVSKYpquBbyLQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "MsgPack.wasm",
        "name": "MsgPack.6zhzo2531f.wasm",
        "hash": "sha256-wrWoOcPphwBSZAfffa7ZH7hrIqAFdTI155ZlfCg3Q70=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "NetCoreServer.wasm",
        "name": "NetCoreServer.h83h5csmz4.wasm",
        "hash": "sha256-oT9+L8BYm4Aypuq8WbzN5WnjDrWbV6PN+9FjLXE5JYc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "NxInfinity.PokeTool.wasm",
        "name": "NxInfinity.PokeTool.knxp608i6f.wasm",
        "hash": "sha256-YMM4MpBqLj7S1poqfYkWWXQp2wNhmg3iFDl0ovKfidY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "NxInfinity.Runtime.Enhancements.wasm",
        "name": "NxInfinity.Runtime.Enhancements.g8m1hjes81.wasm",
        "hash": "sha256-MByzUQ5WuCff1QjBEsSnISPoxHLGEAsyBwf2UCcolho=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "NxInfinity.Runtime.Services.wasm",
        "name": "NxInfinity.Runtime.Services.99z541pwjo.wasm",
        "hash": "sha256-QwZHzxYxxziVkovMlkTEuvKa+wAZ8bTam4BlkGGK4hI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "NxInfinity.Runtime.wasm",
        "name": "NxInfinity.Runtime.sm8zeztvph.wasm",
        "hash": "sha256-dOAvNv1jNigXR/ityexp34N/lfpzwS74fv1n+IlFLjQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "NxInfinity.wasm",
        "name": "NxInfinity.kp3fastd59.wasm",
        "hash": "sha256-ePUDix+WkyaGfFM0RRQkvyq+aXHCEUFQTygmg6s9KFs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Open.Nat.wasm",
        "name": "Open.Nat.e87q7frk4v.wasm",
        "hash": "sha256-HlpJDNhOKYVJ8DsiwNR+Dlep4RHeKgu1R8TneSLQnrk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Audio.wasm",
        "name": "Ryujinx.Audio.8w80al7xh4.wasm",
        "hash": "sha256-+GSPmesyV+mFdMn3h8U5qgXPMImbup52pahSNLW6CK0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Common.wasm",
        "name": "Ryujinx.Common.sy82a43tp0.wasm",
        "hash": "sha256-HBzAsKNvXmGh1IBwWk3x7cfA/pq22GOvv2DvC2HIQQQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Cpu.wasm",
        "name": "Ryujinx.Cpu.4vitdlypb1.wasm",
        "hash": "sha256-QPqKVcyYkNafe7PhSQVkJvkj7p48K7NeFpqeT2L62J4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Device.wasm",
        "name": "Ryujinx.Graphics.Device.0d5wltqq7z.wasm",
        "hash": "sha256-3DMtIsYlcLSHJdZw8s00VwjKG78UL3y2ZP9XrF/cQ94=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.GAL.wasm",
        "name": "Ryujinx.Graphics.GAL.rxxzgo9njt.wasm",
        "hash": "sha256-cak2i3MInx6EOKc+333NopR5TC0bd6N9zwhWbWXWYKk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Gpu.wasm",
        "name": "Ryujinx.Graphics.Gpu.1ipr6sbzck.wasm",
        "hash": "sha256-JyAUoDBe/hKpJK7TFh70b+taXlCwc460OmJ8HW2ZrIk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Host1x.wasm",
        "name": "Ryujinx.Graphics.Host1x.sgsvkc4o7b.wasm",
        "hash": "sha256-3CXcpz/MeDxEPMOOJyHsSukLBJshY8CU90mZ4jwb/Jk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Nvdec.FFmpeg.wasm",
        "name": "Ryujinx.Graphics.Nvdec.FFmpeg.btkts5pyvz.wasm",
        "hash": "sha256-n+7v2T3/Sc4GFzx5MMPZxyD9eD38FXodVKtjp/BZMV8=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Nvdec.Vp9.wasm",
        "name": "Ryujinx.Graphics.Nvdec.Vp9.xpeyp47jgm.wasm",
        "hash": "sha256-+wfcIw65j2HbpfcnHgOyed+Vepe9af2DK8WgkgBo9s4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Nvdec.wasm",
        "name": "Ryujinx.Graphics.Nvdec.6l64c256hn.wasm",
        "hash": "sha256-pmHWjrdwt7yKshUyxOu3egPOqu001/dy3/ybKVx2yC8=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Shader.wasm",
        "name": "Ryujinx.Graphics.Shader.3axc00y586.wasm",
        "hash": "sha256-e5Nw7vip1JVLQYyQqDYFvLj7ewxeUWtQOnOVIfg2el4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Texture.wasm",
        "name": "Ryujinx.Graphics.Texture.u38p73pz0h.wasm",
        "hash": "sha256-tmf7psnezou7xgghA8pOZKC2Xe4aEEKxyFnmlYJQce8=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Vic.wasm",
        "name": "Ryujinx.Graphics.Vic.424vbjbi0y.wasm",
        "hash": "sha256-TG14a+3CpYJawPcGqNdlzPj5b9GvS082FbXLFXPV9zs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Graphics.Video.wasm",
        "name": "Ryujinx.Graphics.Video.wequtcltz6.wasm",
        "hash": "sha256-OF6BaHlTJF4U9pnEbZQE9fdondz0dZtM4Cu/FpcXyWk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.HLE.wasm",
        "name": "Ryujinx.HLE.bk8rb8zkxv.wasm",
        "hash": "sha256-G59L88oIistySvtN8cT+YGYKbqa+7p8iE6JG7rlZojs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Horizon.Common.wasm",
        "name": "Ryujinx.Horizon.Common.hkjln3m8g7.wasm",
        "hash": "sha256-r+YpjyfWBF7rC9WS6fvxh+MHvUx8mYOW1wSrHVz3rF4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Horizon.wasm",
        "name": "Ryujinx.Horizon.kr7hvqx0rw.wasm",
        "hash": "sha256-cIeoZ+Q84l6FzVSlNVlO0T46nan2LzJTR1q/IVm0HMc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Ryujinx.Memory.wasm",
        "name": "Ryujinx.Memory.49dzflmnnn.wasm",
        "hash": "sha256-KM9Qt0wiZZHrrTpSMJfj9iejlxspPI+yZcm4kDWI1xA=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "SkiaSharp.wasm",
        "name": "SkiaSharp.u3vl9ojo06.wasm",
        "hash": "sha256-uslB0U+acZ4gCDO+dv2bEZ6T2c4fwqcsj3iMKkwz8c0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "Spv.Generator.wasm",
        "name": "Spv.Generator.ke2h2xuhnb.wasm",
        "hash": "sha256-lFM4Kr1dsrzMLF/RmktguAJuj709nBau6qcd0shGt5Y=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.CodeDom.wasm",
        "name": "System.CodeDom.wqa1rfluhz.wasm",
        "hash": "sha256-WKz2KkaHjZSatj1F7zy0YwlguYS/qSnnlWfqZOGNZ5I=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.Concurrent.wasm",
        "name": "System.Collections.Concurrent.v9pa8v3zkb.wasm",
        "hash": "sha256-c3Lem0oiV5Rmqc9LuEU9xOLybuDthkg+y3zejNtU/ng=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.Immutable.wasm",
        "name": "System.Collections.Immutable.pajiw9iiax.wasm",
        "hash": "sha256-Mbau2zFTuBYsRQpTiP0UpEImvRY6lU2EG+jQxvt4pHU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.NonGeneric.wasm",
        "name": "System.Collections.NonGeneric.1k9xaovw18.wasm",
        "hash": "sha256-X7fMQEEB75SBre1J4cs/gYI7Wt1VeoPqhYy7tA/oOg4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.Specialized.wasm",
        "name": "System.Collections.Specialized.idmdp1uenu.wasm",
        "hash": "sha256-epAQ0XyuWCDorm/LHu/yYhY5EhnI0blEMfo/jQvS6I4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Collections.wasm",
        "name": "System.Collections.1gl0wftkk7.wasm",
        "hash": "sha256-kfiFo+ogU2J3rSwQP+jl/CDy/cY+lVVI8q8wL5RTEKQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.ComponentModel.wasm",
        "name": "System.ComponentModel.hjn3yqpghy.wasm",
        "hash": "sha256-E8z7tkV9zKaEaOnrJ4XN3fplL0qa24C0xmvdrHweDiQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.ComponentModel.Primitives.wasm",
        "name": "System.ComponentModel.Primitives.jrm3jgm7xl.wasm",
        "hash": "sha256-/+hXR0tS+tJ6QUvG4n9jFAMyGY1pmYsOy9AzTjOrNBk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.ComponentModel.TypeConverter.wasm",
        "name": "System.ComponentModel.TypeConverter.zbq4erdetk.wasm",
        "hash": "sha256-sTf+0lWdIRyzHpQZU0BKTgRuXTflkrXY3/XKP7YQflQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Console.wasm",
        "name": "System.Console.5pcu94y6s0.wasm",
        "hash": "sha256-yXR4kqdAu5xapMmeYpzXLWTZjD2UAWv4hDO7e5CHKzg=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Diagnostics.DiagnosticSource.wasm",
        "name": "System.Diagnostics.DiagnosticSource.x1rllrm0oz.wasm",
        "hash": "sha256-NV2oKDyAqe0SQs25TG9sHKn4nQwjYKr6cAPj+Fm3EMg=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Diagnostics.Process.wasm",
        "name": "System.Diagnostics.Process.uvn5vdufpu.wasm",
        "hash": "sha256-KntzEvNQ5DlF8msxWTDkg5M19rJAQEpKWpwXOd4avbU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Diagnostics.StackTrace.wasm",
        "name": "System.Diagnostics.StackTrace.so1zvlxthf.wasm",
        "hash": "sha256-tMnxlbCdPUDlc6Z3hzpXToItdnXX8o+zPBqaIaAxz1Y=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Diagnostics.TraceSource.wasm",
        "name": "System.Diagnostics.TraceSource.keh5n4u95r.wasm",
        "hash": "sha256-pPF+voe1zrbvJA1AaeiQ3oksJmy16jPvIOPbhbQzEa4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Diagnostics.Tracing.wasm",
        "name": "System.Diagnostics.Tracing.ysk17741jl.wasm",
        "hash": "sha256-bn3/nVtFZSSpNv8yGFvBexBbRuvo5klZ1u73qcREqNk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Formats.Asn1.wasm",
        "name": "System.Formats.Asn1.xo1al9d2lv.wasm",
        "hash": "sha256-EXCCKkmeYVkdPh9HQo8/Drqx1bzKrb1LQPkTFNDthrw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.Compression.Brotli.wasm",
        "name": "System.IO.Compression.Brotli.3u9pm18pqq.wasm",
        "hash": "sha256-9cfAZ+YZ2cPv9JAv7n1NfBWzmwDyY3FZ4fYN5Aym4gE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.Compression.ZipFile.wasm",
        "name": "System.IO.Compression.ZipFile.xhuotowtub.wasm",
        "hash": "sha256-m3IOL0W5EQr+VupSvQUwf4IaEzuT07nY629yf2Plb68=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.Compression.wasm",
        "name": "System.IO.Compression.dyp1spdu4l.wasm",
        "hash": "sha256-pSkAyZXSErA3Y5cPYWPRAxKlPgK1KfOn4gKtcmVwhFE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.FileSystem.AccessControl.wasm",
        "name": "System.IO.FileSystem.AccessControl.r9xtakcgfs.wasm",
        "hash": "sha256-Udgdofs7RhaxK7jEIo83QmHSU+1bHnID+8at+KA2CoU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.FileSystem.DriveInfo.wasm",
        "name": "System.IO.FileSystem.DriveInfo.9s5zhwta91.wasm",
        "hash": "sha256-CYnxmyTT3NYT640M8f8gDUOY5wYbubSW0eqeiiHFc0Q=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.FileSystem.Watcher.wasm",
        "name": "System.IO.FileSystem.Watcher.edvck32q0x.wasm",
        "hash": "sha256-0kl+2f5WRAdrNPMcUZ/MPBuNfd6h6gO+23+BznsXDPY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.MemoryMappedFiles.wasm",
        "name": "System.IO.MemoryMappedFiles.n85jfe5mq0.wasm",
        "hash": "sha256-R9gh3/HOVh93Ml/EeW98iGSfDf4O5h77Cy9xb9SdMCU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.Pipelines.wasm",
        "name": "System.IO.Pipelines.62yor6f016.wasm",
        "hash": "sha256-knp/5jRSZp/QhgU+j4KqR2UwIY/ruqUZYVU6ayZSq8s=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.IO.Pipes.wasm",
        "name": "System.IO.Pipes.6nv0hjyqmp.wasm",
        "hash": "sha256-zuK0ZQlo+LCGjwaVBamcMVO072zSMUCA9FMzOLWdPP0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Linq.Expressions.wasm",
        "name": "System.Linq.Expressions.t8nhfoatr6.wasm",
        "hash": "sha256-E8FMHu3exS2WfjRC8QhHVeaUWSKw06lEVUciInCKWEw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Linq.Parallel.wasm",
        "name": "System.Linq.Parallel.9pckgwuk9j.wasm",
        "hash": "sha256-sxINGRpxmHzmGg7AixsBmv5iOWBfvqsjMcU6kc1kpu0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Linq.wasm",
        "name": "System.Linq.k3eisv7wfz.wasm",
        "hash": "sha256-IACPgmuBW4HJx54HsIVro0mh5U769czMpGaAwrBwIbI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Memory.wasm",
        "name": "System.Memory.r4wrgbnyty.wasm",
        "hash": "sha256-lRh5tgQGCef6yPgmnylTP5nlluYggbx/Hz1YqiA7C3s=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.Http.wasm",
        "name": "System.Net.Http.2xbsn9txjp.wasm",
        "hash": "sha256-VnbDxT/kTFcs1EIeNXCHtlWAOODPpk7VtiQBc2CWoz0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.NameResolution.wasm",
        "name": "System.Net.NameResolution.8sh40gdpy6.wasm",
        "hash": "sha256-CIM/EWuEWpwelsWpfKgZlPv5Ij6J1bDnx8pCfUxWjXc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.NetworkInformation.wasm",
        "name": "System.Net.NetworkInformation.8rg8796w2v.wasm",
        "hash": "sha256-1JFpkMfKFk0/DP+guSclPcrX0cEUp1CMsYpB68cGxpU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.Primitives.wasm",
        "name": "System.Net.Primitives.r22ikcxaqt.wasm",
        "hash": "sha256-A6/60F9oLF8x/xT3gDDCS571kKNXs+QCHehLfmPQY+E=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.Requests.wasm",
        "name": "System.Net.Requests.ljs0q445w6.wasm",
        "hash": "sha256-fwXvJ8I+VYj4kUMgLGOs+1mPqRju5DA4CsMGgZb6yZg=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.Security.wasm",
        "name": "System.Net.Security.jqc5nczgiu.wasm",
        "hash": "sha256-RdnxyM2eckH5u22DBBfbDDe9vAgoPbD9dEDrE7yVmB8=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.Sockets.wasm",
        "name": "System.Net.Sockets.9e7dy5m0mc.wasm",
        "hash": "sha256-sVw3sFic73w25cly9Huex/y01+pE6ofbS4h30Cin0RY=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Net.WebHeaderCollection.wasm",
        "name": "System.Net.WebHeaderCollection.3edxsvlu1z.wasm",
        "hash": "sha256-CwrEPN6MrTsmNPj6CrEstgWgtr7eiW7gW2CH8BHtJnk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Numerics.Vectors.wasm",
        "name": "System.Numerics.Vectors.83kb26bc7t.wasm",
        "hash": "sha256-jPuICntUdkHX5e60oeoYO+ODaZvT39Ox+66vRlAFIYw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.ObjectModel.wasm",
        "name": "System.ObjectModel.ieb4i5szda.wasm",
        "hash": "sha256-RucslExL2IGtvJS8fSy2z+DV6Bb+bMBfdFnLhfVHv0E=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Private.CoreLib.wasm",
        "name": "System.Private.CoreLib.icp8ryqstp.wasm",
        "hash": "sha256-UpVLqfbpek1r9FEChSJflHPzuikefiRN6Q6tDO6lbog=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Private.Uri.wasm",
        "name": "System.Private.Uri.qebfhpvshr.wasm",
        "hash": "sha256-fnNYW57u7LHbA5SFl3A6wkRir5z0ICm4z92AslhIPBE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Private.Xml.wasm",
        "name": "System.Private.Xml.hgwzqf41fv.wasm",
        "hash": "sha256-EQUpcFZ9Gu4n0DSA9OdomacJxazQQBYOU8RUp6Fi2x4=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Reflection.Emit.wasm",
        "name": "System.Reflection.Emit.m92jfafz2c.wasm",
        "hash": "sha256-xuYQEJ8u1u/9o3N3lIE1KGUAQdiqEn7x1BAf9MjVuGA=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Reflection.Emit.ILGeneration.wasm",
        "name": "System.Reflection.Emit.ILGeneration.zkhb9uentm.wasm",
        "hash": "sha256-PVFiz4Wrur6isLg3oJKt00x+QoNaBb/ReEXHgVvvJUk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Reflection.Emit.Lightweight.wasm",
        "name": "System.Reflection.Emit.Lightweight.e9cwsz5xzk.wasm",
        "hash": "sha256-Ep7tqHVt7dAuDSkfAvRWmBY5EeRmSc0Tjg6wH0w+k7A=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Reflection.Metadata.wasm",
        "name": "System.Reflection.Metadata.oftmbqhq1d.wasm",
        "hash": "sha256-hGHGbxpPhtJL7w/p9Lgwa3Jv5O87BXSs/JYS/JzeHGI=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Reflection.Primitives.wasm",
        "name": "System.Reflection.Primitives.yhbetvkqd3.wasm",
        "hash": "sha256-SvX772WaNXCdxPwPm8ySvDprLB12DZA0jd/KiTt3N/U=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Resources.Writer.wasm",
        "name": "System.Resources.Writer.1clgs6kwlx.wasm",
        "hash": "sha256-/3uobqT64XnzDyzAPLhdSsluPdTw7X+lHR5iCPrtjpQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.InteropServices.JavaScript.wasm",
        "name": "System.Runtime.InteropServices.JavaScript.9vef92wwlh.wasm",
        "hash": "sha256-+xV2ZQn4J2DY1BlwdAV/N0hlrIsWDl/Iomg16Qa2EGA=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.InteropServices.wasm",
        "name": "System.Runtime.InteropServices.z5d8cea7f4.wasm",
        "hash": "sha256-p9iXu5os9GdT9QAFnvsISmoLIOxoXttfs3dArqr+3cs=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.Intrinsics.wasm",
        "name": "System.Runtime.Intrinsics.q5a6invebx.wasm",
        "hash": "sha256-EgnABk0AKqPLJMgS4Io++khN70t8nj5MY0aHrOPEmhU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.Loader.wasm",
        "name": "System.Runtime.Loader.n7rmmxdaxu.wasm",
        "hash": "sha256-Q33eBZoWZoV4h0q2nbvBK3CB5U5oTE6VdU466AE6nWw=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.Numerics.wasm",
        "name": "System.Runtime.Numerics.yv33bts89o.wasm",
        "hash": "sha256-bnXxqK5Wq8MvID1LBjN72y7Ce1D6SNShn2dcaq7LQpo=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.Serialization.Formatters.wasm",
        "name": "System.Runtime.Serialization.Formatters.jaij8hkhln.wasm",
        "hash": "sha256-W09wleBIqmQeDU6F69oRfH/YFfEXgkYmbz3OgBR3z5Y=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Runtime.wasm",
        "name": "System.Runtime.ksgngjz0dv.wasm",
        "hash": "sha256-xCB9R6EwtVdGCA+xTLXFVZIh5Tjeicbq3U3tJyrOfuU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Security.AccessControl.wasm",
        "name": "System.Security.AccessControl.vwadgmg2fj.wasm",
        "hash": "sha256-fyCWQXgOjE5/SSKJTsm9kjsEXbWEI7AGhLAoTbaZ0jk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Security.Claims.wasm",
        "name": "System.Security.Claims.g4kx76m9cl.wasm",
        "hash": "sha256-4Dyphxwtdtm3XMyJGYD3+7uejLrUbxb+u4T9B7wvNhU=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Security.Cryptography.wasm",
        "name": "System.Security.Cryptography.acw2lmanh3.wasm",
        "hash": "sha256-Or3BzBQbvZM8c7QfNNMrc5zc0HZcvvCYT2NCA5XzAuE=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Text.Encoding.Extensions.wasm",
        "name": "System.Text.Encoding.Extensions.kth3t3gal9.wasm",
        "hash": "sha256-+CWSaee29GkknXq8JnYxryG57plh1P1dF44lz/Dtt9s=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Text.Encodings.Web.wasm",
        "name": "System.Text.Encodings.Web.uuo3sx1tvp.wasm",
        "hash": "sha256-lrAuQQK+TyEnfkkGdc4/D/R7Jvfv03c+mBTtYnpo+K0=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Text.Json.wasm",
        "name": "System.Text.Json.qkgcvktqph.wasm",
        "hash": "sha256-FoLDlL8sGj/UTKhQ1cnqopvu0KaZy5I+MjoG0RU02Co=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Text.RegularExpressions.wasm",
        "name": "System.Text.RegularExpressions.nzqokpuum6.wasm",
        "hash": "sha256-XWnGrDS/O8mMX/L10aUNsJLQdRaDMqxLEC0+JQWGeZQ=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Threading.wasm",
        "name": "System.Threading.9z8gipv9h9.wasm",
        "hash": "sha256-dRerr8iEmiQhgrCAWusiJDfuDPwxa912YXWYbxjicEc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Threading.Channels.wasm",
        "name": "System.Threading.Channels.h7tm1qojte.wasm",
        "hash": "sha256-oznE3NWokjv3/HagdpFcJ/xg32ulxeV9Xzr/Jv2vbdc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Threading.Tasks.Parallel.wasm",
        "name": "System.Threading.Tasks.Parallel.iw92dkl658.wasm",
        "hash": "sha256-omvqtSbAwi97DGT4H9MvvIJIFwLM9DZjslG9zpzC58g=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Threading.Thread.wasm",
        "name": "System.Threading.Thread.6t3g9pqoc3.wasm",
        "hash": "sha256-tjs++lPqGJ7pw/FHCe+3etmmN9NdsOj2j+NkKPNIMMk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.Web.HttpUtility.wasm",
        "name": "System.Web.HttpUtility.aj9f0x9cbd.wasm",
        "hash": "sha256-+m0EQKVTUc6LQm58REG29POduQXqTf4mrgIOa/vytAk=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "System.wasm",
        "name": "System.m827iuoj36.wasm",
        "hash": "sha256-FtFkorLCUh56TNyfauqW3WgM0bNy+Z0VIHqtpJCsjYc=",
        "cache": "force-cache"
      },
      {
        "virtualPath": "netstandard.wasm",
        "name": "netstandard.1z6b88wic8.wasm",
        "hash": "sha256-DaAYyn9m9pJzctr898iLx4pFVJ5hxSz+3RuUATsNEVA=",
        "cache": "force-cache"
      }
    ],
    "assembly": [],
    "satelliteResources": {
      "af": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.ywrwvesg23.wasm",
          "hash": "sha256-UozObN/nJbtHBJtAq/hmLsMYu3TgQT/EtRkjm3pnXk0=",
          "cache": "force-cache"
        }
      ],
      "ar": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.08lwhm08x4.wasm",
          "hash": "sha256-cPz3C4+g2MIAQsM6g0bJZbFXmyBvQbUKHR1aYj2qgPY=",
          "cache": "force-cache"
        }
      ],
      "az": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.5zb07tir5k.wasm",
          "hash": "sha256-X+gSZsKwqWPDYlMh9HLYz3XWj/7mNUvfkMPzP2sjzHs=",
          "cache": "force-cache"
        }
      ],
      "bg": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.keu2vgecoa.wasm",
          "hash": "sha256-bKXkMdf5H0Q1iWXwwysS4+K1bHW7Ylmgp79RzavSekY=",
          "cache": "force-cache"
        }
      ],
      "bn-BD": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.yd1vj196sf.wasm",
          "hash": "sha256-OkDz+ggtD1zsA+dTwOXlLFZSZ2tZNEkZPZFol7uqL2Q=",
          "cache": "force-cache"
        }
      ],
      "cs": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.q8y6o11u5x.wasm",
          "hash": "sha256-2j5qMd6I9xtUS56KMyVt8L4ACT3DDA793yDsw30eyvU=",
          "cache": "force-cache"
        }
      ],
      "da": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.5dv2k4sndm.wasm",
          "hash": "sha256-t1Dgu6lg4D34lt1M+ia8HgcknKi0hhm+Ngpe59TmHUs=",
          "cache": "force-cache"
        }
      ],
      "de": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.t03mf22q2d.wasm",
          "hash": "sha256-zQ+8ml5PSWZJ1RvDWwJ7O3F3IN5yaBst5FXEzVNCi5A=",
          "cache": "force-cache"
        }
      ],
      "el": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.nih12fs4d0.wasm",
          "hash": "sha256-76zvto6/sqg5KHOLMs/iqLiFs00dUcbxI83PebcFYyc=",
          "cache": "force-cache"
        }
      ],
      "es": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.jrq89ok150.wasm",
          "hash": "sha256-gT0zPjc1y7LDuYPgk2A8/Ekof4ONr+29X3oZtc56oGk=",
          "cache": "force-cache"
        }
      ],
      "fa": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.fxz7ce5yoa.wasm",
          "hash": "sha256-XfrxsHd1I7zwCMVM0STl8pS48PZ9+b1zKmHUpvzn77k=",
          "cache": "force-cache"
        }
      ],
      "fi-FI": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.6pkyhabkma.wasm",
          "hash": "sha256-tpn4OXPdO7i6qTfnBvbLzgvrpABUKvz60gY19yH+kh0=",
          "cache": "force-cache"
        }
      ],
      "fr-BE": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.f8dcc3l1ov.wasm",
          "hash": "sha256-ASp1TcDgNDn6OMz8uNSkB6JVwMm5rFjbNNT6Z5/5vZY=",
          "cache": "force-cache"
        }
      ],
      "fr": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.jld8u0ff47.wasm",
          "hash": "sha256-KXuhfaGwrbfw/UBqrDIZtwJbyqmPHApO2gTmPTXqGfs=",
          "cache": "force-cache"
        }
      ],
      "he": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.ukpui6v0i8.wasm",
          "hash": "sha256-AgmIPoEjsy+/L65Lv4yixlVNUO+mIF++2Y32TuzE8Vk=",
          "cache": "force-cache"
        }
      ],
      "hr": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.3g8wygbks1.wasm",
          "hash": "sha256-w0RLaGQfx8kdEcOqGu7sft5+gtJjXRNcghKgRepEpds=",
          "cache": "force-cache"
        }
      ],
      "hu": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.vwflxailoo.wasm",
          "hash": "sha256-z8yp3y66FEsFRrpAZigkc+7v0HzNrPHXy3wq8DP8puI=",
          "cache": "force-cache"
        }
      ],
      "hy": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.3qkyq6ys76.wasm",
          "hash": "sha256-a++gj4S26zxWAtjz5lChhrebzBeC4nlgB3I4iwsYPGo=",
          "cache": "force-cache"
        }
      ],
      "id": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.r6xg1jjvkb.wasm",
          "hash": "sha256-/Tb4pfzLla+kwJHZrDW42keI3m4CmbLyl9Gtd74gBWQ=",
          "cache": "force-cache"
        }
      ],
      "is": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.oord4j94xg.wasm",
          "hash": "sha256-aA08IGvcbcl1pHPs7v5oXu4rfD0I/BfooSbzn2NXpsE=",
          "cache": "force-cache"
        }
      ],
      "it": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.oymmm1g2un.wasm",
          "hash": "sha256-wBf2up+MSjxgBgNG09dUzHqgTssCGQO76VOgAvIpG+U=",
          "cache": "force-cache"
        }
      ],
      "ja": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.6kpv4etoxu.wasm",
          "hash": "sha256-Jt+1OoIGjy5v+Ab+cwlh2lPtM6ZaBLzyW+/5L2lsVug=",
          "cache": "force-cache"
        }
      ],
      "ko-KR": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.ex9kuvzipn.wasm",
          "hash": "sha256-QtndGz3Vx/FWp9KQw917csUEYfk7azflnkQXBdDhvZA=",
          "cache": "force-cache"
        }
      ],
      "ku": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.nexaas4i8h.wasm",
          "hash": "sha256-n8HaK3GxOMtG5jmwRoJJRwzfqxcYxqfLWMr1r/3ivf4=",
          "cache": "force-cache"
        }
      ],
      "lv": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.xdej2op4al.wasm",
          "hash": "sha256-lQFQDjbbDr44faO7BHM7lYhQZm1d9nn1FlTuW1VMpZU=",
          "cache": "force-cache"
        }
      ],
      "ms-MY": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.ufc4xb6t09.wasm",
          "hash": "sha256-BnseVavWPi6n6D1AABnyd5GEOZJ6vkJ04f9wbO7RIQo=",
          "cache": "force-cache"
        }
      ],
      "mt": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.ma6alnalht.wasm",
          "hash": "sha256-Xg+d2/mQyQsJy/IwgR0fMm1mS6UjKn4ToA2fSJX5g24=",
          "cache": "force-cache"
        }
      ],
      "nb-NO": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.rogm8n12qs.wasm",
          "hash": "sha256-+1HXsYGRSfxjLXsXQyrTwR4Agix/wkupLRN45AReLeQ=",
          "cache": "force-cache"
        }
      ],
      "nb": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.98o8mk9dvy.wasm",
          "hash": "sha256-V12pAdCWNaWzFBdxIfn02tFWeUWk49sYk4KlCVcrZOM=",
          "cache": "force-cache"
        }
      ],
      "nl": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.ws050cy5d6.wasm",
          "hash": "sha256-UKNfhSyDO+oUNpLcNduXGzSnjC7DpEjsjB0H26CgDQQ=",
          "cache": "force-cache"
        }
      ],
      "pl": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.oqjjs4mojs.wasm",
          "hash": "sha256-sHb69mSVx/Micfvhj0jTbVwZ+xy3gIH2EvqXsROd6ZQ=",
          "cache": "force-cache"
        }
      ],
      "pt": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.d8x2eywis5.wasm",
          "hash": "sha256-vSpVrCLvpBRYUYufqzpQsERiNhS7u7va6ACxC+mt/Yc=",
          "cache": "force-cache"
        }
      ],
      "ro": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.glyxyqc2ju.wasm",
          "hash": "sha256-ZHdwhCpZw9cgeRMQ8jPItEd9zl9KfWZNdGOpgG+JJRM=",
          "cache": "force-cache"
        }
      ],
      "ru": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.d1lu9fxbcr.wasm",
          "hash": "sha256-AdvBXIOYDqEEVZ9oG+8byqzIRx0jWeKMq+WX8mrKr80=",
          "cache": "force-cache"
        }
      ],
      "sk": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.w0gjf8tocm.wasm",
          "hash": "sha256-IMm94ewOt2W6N13QDu7qY5xHX59RN4pTY7aS+4MGMXc=",
          "cache": "force-cache"
        }
      ],
      "sl": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.r2dfz2kgxi.wasm",
          "hash": "sha256-DYWUlrjIA6ShaKLOWVI/DSjsKP1hrAQyj+PDjYoOCAk=",
          "cache": "force-cache"
        }
      ],
      "sr-Latn": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.nn1os9gypk.wasm",
          "hash": "sha256-nQFzXO2588P32NuMYf8oiUzL9leBncKlTiNYnQMoTaQ=",
          "cache": "force-cache"
        }
      ],
      "sr": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.0h2azbzz6z.wasm",
          "hash": "sha256-BCpRmua2NzkdLnAsfHz/40Fz0VTEcB8XYBvCfHUNBKc=",
          "cache": "force-cache"
        }
      ],
      "sv": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.iij93kdpgf.wasm",
          "hash": "sha256-Co58RPWrW5pvV7W3rzMohq4LqPZihpkGyY8BMheZVK4=",
          "cache": "force-cache"
        }
      ],
      "th-TH": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.9uodhglzl9.wasm",
          "hash": "sha256-/z/AEMPdo/Lof27+xwJFcVOsJaz4fI4gqWpJhjvyADA=",
          "cache": "force-cache"
        }
      ],
      "tr": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.ne5gk0am3j.wasm",
          "hash": "sha256-XzPbQCxog3IjkVWkQB1J+vv2dF/ZTfCbVGdZAzOVu/w=",
          "cache": "force-cache"
        }
      ],
      "uk": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.4151316kki.wasm",
          "hash": "sha256-uLb77VEPwwswHCjRDIhleORPsYG0Y932hwkQ+waIZLc=",
          "cache": "force-cache"
        }
      ],
      "uz-Cyrl-UZ": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.td864ka74i.wasm",
          "hash": "sha256-8SMmyA3xR+NVD6ex9FdIIMZClXJdeGp+jkygmly90HU=",
          "cache": "force-cache"
        }
      ],
      "uz-Latn-UZ": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.cp8ql3zh50.wasm",
          "hash": "sha256-cMDMwRTBdo/gKMJhFroozr9K3dHyfXGtW+CqU5oFW40=",
          "cache": "force-cache"
        }
      ],
      "vi": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.ir4sqco03g.wasm",
          "hash": "sha256-4m6VXMY4wDb3zHuBEfQu9snJsx6k1uDwkoqmtlRTHLE=",
          "cache": "force-cache"
        }
      ],
      "zh-CN": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.uy7ybe2iww.wasm",
          "hash": "sha256-1t91tAlrH/xAebujX3ICxUle4jFNxWVeC8sXELOc1A4=",
          "cache": "force-cache"
        }
      ],
      "zh-Hans": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.70a9vrmqxy.wasm",
          "hash": "sha256-GbqYdsJ017u4dzOpc108MB+ZUDJu3Tl6CCr7lkL4HrA=",
          "cache": "force-cache"
        }
      ],
      "zh-Hant": [
        {
          "virtualPath": "Humanizer.resources.wasm",
          "name": "Humanizer.resources.q9i86svuax.wasm",
          "hash": "sha256-gsspeIJXoA6eVisryHyO6hXGq0jNTgw6XpCzvT4rLFA=",
          "cache": "force-cache"
        }
      ]
    }
  },
  "debugLevel": 0,
  "linkerEnabled": true,
  "globalizationMode": "sharded",
  "runtimeConfig": {
    "runtimeOptions": {
      "configProperties": {
        "Microsoft.Extensions.DependencyInjection.VerifyOpenGenericServiceTrimmability": true,
        "System.ComponentModel.DefaultValueAttribute.IsSupported": false,
        "System.ComponentModel.Design.IDesignerHost.IsSupported": false,
        "System.ComponentModel.TypeConverter.EnableUnsafeBinaryFormatterInDesigntimeLicenseContextSerialization": false,
        "System.ComponentModel.TypeDescriptor.IsComObjectDescriptorSupported": false,
        "System.Data.DataSet.XmlSerializationIsSupported": false,
        "System.Diagnostics.Debugger.IsSupported": false,
        "System.Diagnostics.Metrics.Meter.IsSupported": false,
        "System.Diagnostics.Tracing.EventSource.IsSupported": false,
        "System.Globalization.Invariant": false,
        "System.TimeZoneInfo.Invariant": false,
        "System.Linq.Enumerable.IsSizeOptimized": true,
        "System.Net.Http.EnableActivityPropagation": false,
        "System.Net.Http.WasmEnableStreamingResponse": true,
        "System.Net.SocketsHttpHandler.Http3Support": false,
        "System.Reflection.Metadata.MetadataUpdater.IsSupported": false,
        "System.Resources.ResourceManager.AllowCustomResourceTypes": false,
        "System.Resources.UseSystemResourceKeys": true,
        "System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeSupported": true,
        "System.Runtime.InteropServices.BuiltInComInterop.IsSupported": false,
        "System.Runtime.InteropServices.EnableConsumingManagedCodeFromNativeHosting": false,
        "System.Runtime.InteropServices.EnableCppCLIHostActivation": false,
        "System.Runtime.InteropServices.Marshalling.EnableGeneratedComInterfaceComImportInterop": false,
        "System.Runtime.Serialization.EnableUnsafeBinaryFormatterSerialization": false,
        "System.StartupHookProvider.IsSupported": false,
        "System.Text.Encoding.EnableUnsafeUTF7Encoding": false,
        "System.Text.Json.JsonSerializer.IsReflectionEnabledByDefault": true,
        "System.Threading.Thread.EnableAutoreleasePool": false
      }
    }
  }
}/*json-end*/);export{ht as default,gt as dotnet,pt as exit};
