import { Input } from '../ui/controls.jsx';
import { Select } from '../Dropdown.jsx';
import { Button } from '../components/common.jsx';
import { t } from '../i18n/index.js';
import { resolveCustomerPartNumber } from '../../shared/production.js';

export function ProductionSupply({ supplies, choices, customerId, onChange, onCalculate, stale, disabled }) {
  return <section className="panel bom-section production-supply">
    <h2>{t('production.supplyTitle')}</h2>
    <p className="bom-hint">{t('production.supplyHint')}</p>
    {supplies.filter(row => row.recipe_options.length || row.mode !== 'stock').map(row => {
      const choice = choices.find(item => item.path === row.path) || row;
      const partNumber = resolveCustomerPartNumber(row.customer_part_numbers, customerId);
      const set = patch => {
        const resetChildren = patch.mode === 'stock' || patch.child_bom_id !== undefined && patch.child_bom_id !== choice.child_bom_id;
        onChange([...choices.filter(item => item.path !== row.path && (!resetChildren || !item.path.startsWith(`${row.path}.`))),
          { path: row.path, mode: choice.mode, child_bom_id: choice.child_bom_id, stock_quantity: choice.stock_quantity, ...patch }]);
      };
      return <div className="production-supply-row" key={row.path}>
        <strong>{row.name} <small>［{row.path}］</small></strong>
        {partNumber && <p className="production-customer-part-line"><span className="production-customer-part">{t('production.customerPartNumber')}：{partNumber}</span></p>}
        <p className="bom-hint">{t('production.supplyDemand', { required: row.required, stock: row.stock, unit: row.unit })}</p>
        {row.mode === 'partial' && <p className="bom-hint">{t('production.supplyAllocation', { stock: row.stock_quantity, produce: row.production_quantity, unit: row.unit })}</p>}
        <div className="bom-form-grid">
          <label>{t('production.supplySource')}<Select aria-label={t('production.supplySourceLabel', { name: row.name, path: row.path })} value={choice.mode} disabled={disabled} onChange={mode => set({ mode })}>
            <option value="produce">{t('production.supplyProduce')}</option><option value="stock">{t('production.supplyStock')}</option><option value="partial">{t('production.supplyPartial')}</option>
          </Select></label>
          {choice.mode !== 'stock' && <label>{t('production.supplyRecipe')}<Select aria-label={t('production.supplyRecipeLabel', { name: row.name, path: row.path })} value={choice.child_bom_id || ''} disabled={disabled} onChange={value => set({ child_bom_id: Number(value) })}>
            <option value="">{t('production.supplyChooseRecipe')}</option>
            {row.recipe_options.map(bom => <option key={bom.id} value={bom.id} disabled={!bom.enabled}>{bom.name} #{bom.id}</option>)}
          </Select></label>}
          {choice.mode === 'partial' && <label>{t('production.supplyStockQuantity')}<Input aria-label={t('production.supplyStockQuantityLabel', { name: row.name, path: row.path })} inputMode="decimal" value={choice.stock_quantity ?? ''} disabled={disabled} onChange={event => set({ stock_quantity: event.target.value })} /></label>}
        </div>
      </div>;
    })}
    {stale && <p className="bom-warning" role="status">{t('production.supplyRecalculateHint')}</p>}
    <Button type="button" disabled={disabled} onClick={onCalculate}>{t('production.supplyRecalculate')}</Button>
  </section>;
}
