import { useState } from 'react';
import { Tabs } from 'antd';
import { BomStructure } from './BomStructure.jsx';

export function BomResultViews({ nodes, quantity, children }) {
  const [view, setView] = useState('summary'), [sourceSelection, setSourceSelection] = useState(null);
  const showSources = row => {
    setSourceSelection({ productId: row.product_id, name: row.name });
    setView('structure');
  };
  return <Tabs className="bom-result-views" activeKey={view} onChange={setView} items={[
    { key: 'summary', label: '领料汇总', forceRender: true, children: children(showSources) },
    { key: 'structure', label: '配方结构', forceRender: true, children: <BomStructure nodes={nodes} quantity={quantity} sourceSelection={sourceSelection} active={view === 'structure'} /> },
  ]} />;
}
