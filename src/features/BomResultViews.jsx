import { t as pt } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useState } from 'react';
import { Tabs } from 'antd';
import { BomStructure } from './BomStructure.jsx';

export function BomResultViews({ nodes, quantity, children }) {
  useLocale();
  const [view, setView] = useState('summary'), [sourceSelection, setSourceSelection] = useState(null);
  const showSources = row => {
    setSourceSelection({ productId: row.product_id, name: row.name });
    setView('structure');
  };
  return <Tabs className="bom-result-views" activeKey={view} onChange={setView} items={[
    { key: 'summary', label: pt("production.materialIssueSummary"), forceRender: true, children: children(showSources) },
    { key: 'structure', label: pt("production.recipeStructure"), forceRender: true, children: <BomStructure nodes={nodes} quantity={quantity} sourceSelection={sourceSelection} active={view === 'structure'} /> },
  ]} />;
}
