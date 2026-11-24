import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import './disclosure.css';

export function Disclosure({ label, children, className, buttonClassName = '', open, onOpenChange }) {
  const id = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const expanded = open ?? localOpen;
  return <div className={className}>
    <button type="button" className={`erp-disclosure-toggle ${buttonClassName}`.trim()}
      aria-expanded={expanded} aria-controls={id}
      onClick={() => (onOpenChange ?? setLocalOpen)(!expanded)}>
      <ChevronRight className="erp-disclosure-chevron" size={16} aria-hidden="true" />
      {label}
    </button>
    <div id={id} hidden={!expanded}>{children}</div>
  </div>;
}
