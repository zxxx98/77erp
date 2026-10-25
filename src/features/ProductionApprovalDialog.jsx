import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useEffect, useRef } from 'react';
import { Modal } from '../components/common.jsx';

let pendingHistoryCleanup = null;
let nextMarker = 0;

// Local approval dialogs are outside App's modal state. Own their history entry
// and consume its popstate before App's mobile overlay handler sees it.
function registerApprovalHistory(onClose, isBusy) {
  let active = true;
  let release = () => {};
  const attach = () => {
    if (!active) return;
    const marker = `production-approval-${Date.now()}-${++nextMarker}`;
    const href = window.location.href;
    let ownsEntry = true;
    window.history.pushState({ ...window.history.state, erpProductionApproval: marker }, '', href);
    const back = event => {
      // A separate overlay above this one is consuming its own history entry.
      if (window.history.state?.erpProductionApproval === marker) return;
      event.stopImmediatePropagation();
      if (isBusy()) {
        window.history.pushState({ ...window.history.state, erpProductionApproval: marker }, '', href);
      } else {
        ownsEntry = false;
        onClose();
      }
    };
    window.addEventListener('popstate', back, true);
    release = () => {
      window.removeEventListener('popstate', back, true);
      if (!ownsEntry || window.history.state?.erpProductionApproval !== marker || window.location.href !== href) return;
      ownsEntry = false;
      const cleanup = new Promise(resolve => {
        const consumed = event => {
          event.stopImmediatePropagation();
          window.removeEventListener('popstate', consumed, true);
          resolve();
        };
        window.addEventListener('popstate', consumed, true);
        window.history.back();
      });
      pendingHistoryCleanup = cleanup;
      cleanup.then(() => { if (pendingHistoryCleanup === cleanup) pendingHistoryCleanup = null; });
    };
  };
  // A successful request can unmount a dialog before its history.back resolves.
  // Wait for that traversal before opening another entry, without reopening UI.
  if (pendingHistoryCleanup) pendingHistoryCleanup.then(attach);
  else attach();
  return () => { active = false; release(); };
}

export function ProductionApprovalDialog({ busy, onClose, children, ...props }) {
  useLocale();
  const callbacks = useRef({ busy, onClose });
  callbacks.current = { busy, onClose };
  useEffect(() => registerApprovalHistory(() => callbacks.current.onClose(), () => callbacks.current.busy), []);
  return <Modal {...props} presentation="drawer" className="production-approval-detail" onClose={() => { if (!callbacks.current.busy) callbacks.current.onClose(); }}>{children}</Modal>;
}
