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

export const Dashboard = deferred(() => import('./pages/Dashboard.jsx'), 'Dashboard');
export const Announcements = deferred(() => import('./pages/Announcements.jsx'), 'Announcements');
export const Quality = deferred(() => import('./pages/Quality.jsx'), 'Quality');
export const Bom = deferred(() => import('./pages/Bom.jsx'), 'Bom');
export const Production = deferred(() => import('./pages/Production.jsx'), 'Production');
export const ProductQualityCharts = deferred(() => import('./pages/ProductQualityCharts.jsx'), 'ProductQualityCharts');
export const AnnouncementDetail = deferred(() => import('./pages/Announcements.jsx'), 'AnnouncementDetail');
export const AnnouncementEditor = deferred(() => import('./pages/Announcements.jsx'), 'AnnouncementEditor');
export const Products = deferred(() => import('./pages/Products.jsx'), 'Products');
export const Inventory = deferred(() => import('./pages/Inventory.jsx'), 'Inventory');
export const Orders = deferred(() => import('./pages/Orders.jsx'), 'Orders');
export const Scanner = deferred(() => import('./pages/Scanner.jsx'), 'Scanner');
export const ProductCodeModal = deferred(() => import('./features/ProductDialogs.jsx'), 'ProductCodeModal');
export const ProductDetail = deferred(() => import('./features/ProductDialogs.jsx'), 'ProductDetail');
export const ProductForm = deferred(() => import('./features/ProductDialogs.jsx'), 'ProductForm');
export const CategoryManager = deferred(() => import('./features/ProductDialogs.jsx'), 'CategoryManager');
export const ReduceStockModal = deferred(() => import('./features/ProductDialogs.jsx'), 'ReduceStockModal');
export const OrderForm = deferred(() => import('./features/OrderForm.jsx'), 'OrderForm');
export const OrderDetail = deferred(() => import('./features/OrderDetail.jsx'), 'OrderDetail');
export const SettingsForm = deferred(() => import('./features/Settings.jsx'), 'SettingsForm');
export const BusinessTools = deferred(() => import('./Commerce.jsx'), 'BusinessTools');
export const ChangePassword = deferred(() => import('./Users.jsx'), 'ChangePassword');
export const MobileShell = deferred(() => import('./mobile-web/MobileShell.jsx'), 'MobileShell');
export const WarehousePicker = deferred(() => import('./mobile-web/MobileShell.jsx'), 'WarehousePicker');
export const DraftList = deferred(() => import('./mobile-web/MobileShell.jsx'), 'DraftList');
export const MobileProductDetail = deferred(() => import('./mobile-web/MobileShell.jsx'), 'MobileProductDetail');
export const MobileOrderForm = deferred(() => import('./mobile-web/MobileOrderForm.jsx'), 'MobileOrderForm');
export const MobileOrderDetail = deferred(() => import('./mobile-web/MobileOrderDetail.jsx'), 'MobileOrderDetail');
export const Templates = deferred(() => import('./Commerce.jsx'), 'Templates');
export const Payments = deferred(() => import('./Commerce.jsx'), 'Payments');
export const Backup = deferred(() => import('./Operations.jsx'), 'Backup');
export const OrderActions = deferred(() => import('./Operations.jsx'), 'OrderActions');
export const UserManager = deferred(() => import('./Users.jsx'), 'UserManager');
export const ImagebedSettings = deferred(() => import('./ImagebedSettings.jsx'), 'ImagebedSettings');
export const NotificationSettings = deferred(() => import('./NotificationSettings.jsx'), 'NotificationSettings');
export const R2BackupSettings = deferred(() => import('./R2BackupSettings.jsx'), 'R2BackupSettings');

export const PositionManager = deferred(() => import('./Positions.jsx'), 'PositionManager');
