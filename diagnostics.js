// Reports stay on the device until the user chooses to share the downloaded file.
export async function collectDiagnostics(api) {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => api.Status()),
    Promise.resolve().then(() => api.Diagnostics()),
  ]);
  const report = {
    format: 'nxi-mobile-diagnostics', version: 1, capturedAt: new Date().toISOString(),
    browser: { userAgent: navigator.userAgent, secureContext: globalThis.isSecureContext,
      isolated: globalThis.crossOriginIsolated, webgpu: !!navigator.gpu,
      sharedMemory: typeof SharedArrayBuffer !== 'undefined',
      deviceStorage: !!navigator.storage?.getDirectory, webLocks: !!navigator.locks?.request,
      standalone: globalThis.matchMedia?.('(display-mode: standalone)').matches ?? false },
    session: null, core: null, errors: [],
    qualification: { retailGameVerified: false, physicalPhoneVerified: false },
  };
  if (results[0].status === 'fulfilled') {
    try { report.session = JSON.parse(results[0].value); }
    catch { report.errors.push('Session status was not readable.'); }
  } else report.errors.push('Session status was unavailable.');
  if (results[1].status === 'fulfilled') report.core = results[1].value;
  else report.errors.push('Core diagnostics were unavailable.');
  try {
    const response = await fetch(new URL('./build-info.json', import.meta.url), { cache: 'no-store' });
    if (response.ok && !response.redirected) report.build = await response.json();
  } catch { /* A locally staged developer build may not have publication metadata. */ }
  return report;
}

export async function exportDiagnostics(api) {
  const report = await collectDiagnostics(api);
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'nx-infinity-mobile-diagnostics-' + report.capturedAt.replace(/[:.]/g, '-') + '.json';
  document.body.appendChild(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
}
