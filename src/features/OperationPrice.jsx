import { usePermissions } from '../permissions.jsx';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import './operation-price.css';

export function OperationPrice({ node, unit }) {
  useLocale();
  const { can } = usePermissions();
  if (!node || !can('finance')) return null;
  const price = node.unit_price == null ? t('payroll.unpriced')
    : `${node.currency} ${Number(node.unit_price).toLocaleString(getFormatLocale(), { maximumFractionDigits: 4 })}${unit ? ` / ${unit}` : ''}`;
  const text = `${t('payroll.unitPrice')} · ${price}`;
  return <span className="operation-price" title={text}>{text}</span>;
}
