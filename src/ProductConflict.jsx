import { t as translate, getFormatLocale, translateText } from './i18n/index.js';
import { useLocale } from './i18n/react.jsx';
import React from 'react';
import { ProductImage } from './ProductImage.jsx';

const fields = () => [
  ['name', translate("system.material.name")], ['barcode', translate("system.material.barcode.2")], ['category', translate("system.material.categories")],
  ['production_type', translate("system.production.type")],
  ['unit', translate("system.unit.of.measurement")], ['unit_round_up', translate("system.round.quantities.to.whole.units")], ['cost', translate("system.reference.purchase.price")], ['price', translate("system.reference.sales.price")],
  ['threshold', translate("system.safety.stock")], ['specification', translate("system.specifications.and.models")], ['note', translate("system.material.remarks")], ['image', translate("system.material.pictures")],
  ['inspection_date', translate("system.verification.date")], ['inspection_interval', translate("system.inspection.cycle")], ['inspection_unit', translate("system.period.unit")], ['last_inspected_on', translate("system.last.check")],
];

export function ProductConflict({ form, latest }) {
  useLocale();
  const displayValue = (key, value) => key === 'production_type' ? translateText(value) : key === 'unit_round_up' ? translate(value ? 'system.yes' : 'system.no') : value;
  return <div className="product-conflict">
    <p>{translate("system.your.input.has.been.retained.after.verifying.the.latest.information.you")}</p>
    {latest && <>
      <strong>{translate("system.latest.material.information")}</strong>
      <dl>{fields().map(([key, label]) => <div key={key}>
        <dt>{label}</dt>
        <dd><small>{translate("system.currently.filled.in")}</small>{key === 'image' && form[key] ? <ProductImage src={form[key]} alt={translate("system.picture.of.the.currently.filled.material")} /> : <span>{String(displayValue(key, form[key]) ?? '') || translate("system.not.filled.in")}</span>}</dd>
        <dd><small>{translate("system.latest.information")}</small>{key === 'image' && latest[key] ? <ProductImage src={latest[key]} alt={translate("system.latest.material.pictures")} /> : <span>{String(displayValue(key, latest[key]) ?? '') || translate("system.not.filled.in")}</span>}</dd>
      </div>)}</dl>
    </>}
  </div>;
}
