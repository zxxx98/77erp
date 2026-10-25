import { t as translate, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2 } from 'lucide-react';
import { Button, Modal } from './common.jsx';
import './fullscreen-chart.css';

export function FullscreenChart({ title, children }) {
  useLocale();
  const [fullscreen, setFullscreen] = useState(false);
  return <div className="fullscreen-chart">
    <div className="fullscreen-chart-toolbar"><Button type="button" icon={Maximize2} onClick={() => setFullscreen(true)}>{translate("extra.view.full.screen")}</Button></div>
    {children(false)}
    {fullscreen && createPortal(<div className="chart-fullscreen-layer">
      <Modal title={title} subtitle={translate("extra.view.full.screen")} className="chart-fullscreen-modal" closeLabel={translate("extra.exit.full.screen")} onClose={() => setFullscreen(false)}>
        <div className="chart-fullscreen-content">{children(true)}</div>
      </Modal>
    </div>, document.body)}
  </div>;
}
