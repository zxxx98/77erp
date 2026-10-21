import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2 } from 'lucide-react';
import { Button, Modal } from './common.jsx';
import './fullscreen-chart.css';

export function FullscreenChart({ title, children }) {
  const [fullscreen, setFullscreen] = useState(false);
  return <div className="fullscreen-chart">
    <div className="fullscreen-chart-toolbar"><Button type="button" icon={Maximize2} onClick={() => setFullscreen(true)}>全屏查看</Button></div>
    {children(false)}
    {fullscreen && createPortal(<div className="chart-fullscreen-layer">
      <Modal title={title} subtitle="全屏查看" className="chart-fullscreen-modal" closeLabel="退出全屏" onClose={() => setFullscreen(false)}>
        <div className="chart-fullscreen-content">{children(true)}</div>
      </Modal>
    </div>, document.body)}
  </div>;
}
