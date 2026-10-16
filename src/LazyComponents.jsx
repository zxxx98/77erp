import React, { lazy, Suspense } from 'react';
import { LoadingStatus } from './Loading.jsx';

// Keep the boundary local so loading a dialog or scanner preserves the page and form state.
function deferred(load, name) {
  const Component = lazy(() => load().then(module => ({ default: module[name] })));
  return function DeferredComponent(props) {
    return <Suspense fallback={<LoadingStatus>正在加载…</LoadingStatus>}><Component {...props} /></Suspense>;
  };
}

export const AiAssistant = deferred(() => import('./AiAssistant.jsx'), 'AiAssistant');
export const AiSettings = deferred(() => import('./AiAssistant.jsx'), 'AiSettings');
export const CameraScanner = deferred(() => import('./CameraScanner.jsx'), 'CameraScanner');
export const Barcode = deferred(() => import('./Barcode.jsx'), 'Barcode');
export const StockQrManager = deferred(() => import('./StockQr.jsx'), 'StockQrManager');
export const StockQrExecution = deferred(() => import('./StockQr.jsx'), 'StockQrExecution');
