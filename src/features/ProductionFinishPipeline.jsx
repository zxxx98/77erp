import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Badge, Button, Modal } from '../components/common.jsx';
import { Checkbox, Input } from '../ui/controls.jsx';
import { MaterialDocumentList } from './ProductionMaterialDocuments.jsx';
import { ProductionAcceptanceRegistrations } from './ProductionAcceptanceRegistrations.jsx';
import { useBusiness } from '../business-api.js';
import { usePermissions } from '../permissions.jsx';
import { api } from '../api.js';
import { t, getFormatLocale } from '../i18n/index.js';
import { useLocale } from '../i18n/react.jsx';
import { productionMessage } from '../i18n/production-errors.js';
import { productionFinishPreview } from '../../shared/production.js';
import {
  exactCompare,
  exactQuantity,
  exactSubtract,
  formatExactQuantity,
  parseExactQuantity,
  quantityInput,
} from '../../shared/exact-quantity.js';

const formatQty = value => formatExactQuantity(value, getFormatLocale());
const formatTime = value => new Date(value).toLocaleString(getFormatLocale(), { hour12: false });

export function ProductionFinishPipeline({
  order,
  data,
  onClose,
  onUpdated,
  onFinished,
  onOpenRegistration,
  onOpenSupplement,
}) {
  useLocale();
  const { can } = usePermissions();
  const action = useBusiness();
  const preview = useMemo(() => productionFinishPreview(order), [order]);

  const [step, setStep] = useState(() => (
    preview?.step1_has_items ? 1 : preview?.step2_has_items ? 2 : 3
  ));
  const [statusMessage, setStatusMessage] = useState('');
  const [returnToggle, setReturnToggle] = useState(null);
  const [returnOverrides, setReturnOverrides] = useState({});
  const [returnNote, setReturnNote] = useState('');
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [stageInputs, setStageInputs] = useState({});
  const [cancellingReceipt, setCancellingReceipt] = useState(null);

  if (!order || !preview) return null;

  const submitReturn = returnToggle ?? preview.returnable_materials.length > 0;
  const canApprove = can('stock_approve');
  const canManage = can('production');
  const locked = action.busy;
  const activeStep = preview.step1_blocked ? 1 : (preview.step2_blocked && step > 2 ? 2 : step);

  const parsedReturn = (() => {
    const errors = new Map();
    const items = [];
    if (!submitReturn) return { errors, items, hasError: false };
    for (const item of preview.returnable_materials) {
      const maxQty = exactQuantity(item, 'returnable_quantity');
      const raw = returnOverrides[item.product_id] ?? quantityInput(maxQty);
      const trimmed = String(raw ?? '').trim();
      if (!trimmed || trimmed === '0') continue;
      try {
        const parsed = parseExactQuantity(trimmed, false);
        if (exactCompare(parsed, maxQty) > 0) {
          errors.set(
            item.product_id,
            t('production.finishPipeline.returnExceeded', { max: formatQty(maxQty), unit: item.unit }),
          );
        } else if (exactCompare(parsed, 0) > 0) {
          items.push({
            product_id: item.product_id,
            name: item.name,
            unit: item.unit,
            quantity: parsed,
          });
        }
      } catch (error) {
        errors.set(item.product_id, productionMessage(error.message));
      }
    }
    return { errors, items, hasError: errors.size > 0 };
  })();

  const sendOrderAction = (suffix, body) => action.send(
    `/production-orders/${order.id}${suffix}`,
    { schema_version: 2, stage_schema_version: 1, operation_schema_version: 1, ...body },
    { warehouseId: data.warehouse_id },
  );

  const notifyUpdate = async (updatedOrder, notice) => {
    setStatusMessage(notice || '');
    await onUpdated?.(updatedOrder, notice);
  };

  const confirmMaterialDoc = (doc, items) => action.run(async () => {
    const direction = doc.type === 'out' ? t('production.issue') : t('production.receipt2');
    const excess = (items || []).flatMap(row => {
      const item = doc.items.find(entry => entry.product_id === row.product_id);
      return exactCompare(row.quantity, exactQuantity(item, 'pending_quantity')) > 0
        ? [`${item.name} +${formatExactQuantity(exactSubtract(row.quantity, exactQuantity(item, 'pending_quantity')))} ${item.unit}`]
        : [];
    });
    const confirmation = doc.type === 'out'
      ? t('production.confirmCurrentIssue', { number: doc.number }) + (excess.length ? '\n' + t('production.confirmOverIssue', { items: excess.join('\n') }) : '')
      : t('production.approveAndTheEntireOrder', {
          v0: doc.number,
          v1: direction,
          v2: t('production.unusedMaterialsWillReturnToTheCurrentWarehouse'),
        });
    if (!window.confirm(confirmation)) return;
    await action.send(
      `/production-material-documents/${doc.id}/confirm`,
      { version: doc.version, ...(items ? { items } : {}) },
      { warehouseId: data.warehouse_id },
    );
    const fresh = await api(`/production-orders/${order.id}`, { warehouseId: data.warehouse_id });
    await notifyUpdate(fresh, t('production.confirmed2', { v0: doc.number, v1: direction }));
  });

  const cancelMaterialDoc = (doc, reason) => action.run(async () => {
    await action.send(
      `/production-material-documents/${doc.id}/cancel`,
      { version: doc.version, reason },
      { warehouseId: data.warehouse_id },
    );
    const fresh = await api(`/production-orders/${order.id}`, { warehouseId: data.warehouse_id });
    const notice = doc.issues?.length
      ? t('production.remainingRequestClosed', { number: doc.number })
      : t('production.materialRequestCancelledStockUnchanged');
    await notifyUpdate(fresh, notice);
  });

  const approveStageReceipt = doc => action.run(async () => {
    if (!window.confirm(t('production.approveAndReceiveTheFullBatchAndListed', {
      v0: doc.number,
      v1: formatQty(exactQuantity(doc)),
      v2: doc.unit,
      v3: doc.product_name,
    }))) return;
    await action.send(
      `/production-stage-receipts/${doc.stage_receipt_id}/confirm`,
      { version: doc.version },
      { warehouseId: data.warehouse_id },
    );
    const fresh = await api(`/production-orders/${order.id}`, { warehouseId: data.warehouse_id });
    await notifyUpdate(fresh, t('production.received3', { v0: doc.number }));
  });

  const submitCancelStageReceipt = event => {
    event.preventDefault();
    if (!cancellingReceipt) return;
    action.run(async () => {
      if (!window.confirm(t('production.stageReceiptCancelConfirm'))) return;
      const fresh = await sendOrderAction(`/stage-receipts/${cancellingReceipt.id}/void`, {
        version: order.version,
        reason: cancellingReceipt.reason,
      });
      setCancellingReceipt(null);
      await notifyUpdate(fresh, t('production.stageReceiptVoided'));
    });
  };

  const confirmOutputCompletion = () => action.run(async () => {
    if (!window.confirm(t('production.confirmOutputCompletionPrompt'))) return;
    const fresh = await sendOrderAction('/output-completion', {
      completed: true,
      version: order.version,
    });
    await notifyUpdate(fresh, t('production.outputCompletionConfirmed'));
  });

  const submitStageReceipt = (stage, confirm) => action.run(async () => {
    const raw = stageInputs[stage.path] ?? quantityInput(exactQuantity(stage, 'available_quantity'));
    const quantity = parseExactQuantity(raw, true);
    let targetOrder = order;
    if (order.pending_registration_count > 0) {
      const reconciled = await sendOrderAction('/operations/registrations/reconcile', { version: order.version });
      if (reconciled.settlement_errors?.length) {
        throw new Error(reconciled.settlement_errors.map(row => row.error).join('\n'));
      }
      targetOrder = reconciled;
    }
    const fresh = await sendOrderAction('/stage-receipts', {
      version: targetOrder.version,
      path: stage.path,
      quantity,
      ...(confirm ? { confirm: true } : {}),
    });
    setStageInputs(previous => {
      const next = { ...previous };
      delete next[stage.path];
      return next;
    });
    await notifyUpdate(
      fresh,
      t(confirm ? 'production.finishPipeline.stageReceiptConfirmSuccess' : 'production.stageReceiptSubmitted'),
    );
  });

  const submitFinish = () => action.run(async () => {
    if (preview.step1_blocked || preview.step2_blocked || parsedReturn.hasError) return;
    const returnItems = parsedReturn.items.map(({ product_id, quantity }) => ({ product_id, quantity }));
    const confirmImmediate = canApprove && confirmReturn && returnItems.length > 0;
    const finished = await sendOrderAction('/finish', {
      version: order.version,
      ...(returnItems.length
        ? {
            return_items: returnItems,
            return_note: returnNote,
            confirm_return: confirmImmediate,
          }
        : {}),
    });
    const notice = returnItems.length
      ? t(
          confirmImmediate
            ? 'production.finishPipeline.finishedWithReturnConfirmed'
            : 'production.finishPipeline.finishedWithReturnPending',
        )
      : t('production.productionEndedPendingReceiptsStillRequireWarehouseApproval');
    await onFinished?.(finished, notice);
  });

  const renderPendingStageReceipts = () => (
    <div className="production-finish-block">
      <div className="production-finish-block-head">
        <h3>{t('production.finishPipeline.pendingStageReceiptsTitle')}</h3>
        <Badge tone="orange">{preview.pending_stage_receipts.length}</Badge>
      </div>
      <p className="bom-hint">{t('production.finishPipeline.pendingStageReceiptsHint')}</p>
      <div className="production-finish-card-list">
        {preview.pending_stage_receipts.map(doc => (
          <article className="production-finish-card" key={doc.id}>
            <div className="production-finish-card-head">
              <div>
                <strong>{doc.number}</strong>
                <small>{doc.product_name} · {formatQty(exactQuantity(doc))} {doc.unit} · {doc.path} · {t('production.batch3')} {doc.batch_number} {t('production.batch2')}</small>
                <small>{doc.created_by_name} · {formatTime(doc.created_at)}</small>
              </div>
              <Badge tone="orange">{t('production.pendingReceipt')}</Badge>
            </div>
            <div className="bom-actions">
              {canApprove && (
                <Button kind="primary" disabled={locked} onClick={() => approveStageReceipt(doc)}>
                  {t('production.finishPipeline.approveReceipt')}
                </Button>
              )}
              {canManage && (
                <Button disabled={locked} onClick={() => setCancellingReceipt({ id: doc.stage_receipt_id, reason: '' })}>
                  {t('production.finishPipeline.cancelReceipt')}
                </Button>
              )}
            </div>
            {cancellingReceipt?.id === doc.stage_receipt_id && (
              <form className="production-finish-inline-form" onSubmit={submitCancelStageReceipt}>
                <label>
                  {t('production.voidReason')}
                  <Input.TextArea
                    aria-label={t('production.stageReceiptVoidReason')}
                    rows={2}
                    maxLength={500}
                    disabled={locked}
                    value={cancellingReceipt.reason}
                    onChange={event => setCancellingReceipt(prev => ({ ...prev, reason: event.target.value }))}
                  />
                </label>
                <div className="bom-actions">
                  <Button disabled={locked} onClick={() => setCancellingReceipt(null)}>{t('production.cancel')}</Button>
                  <Button kind="danger" type="submit" disabled={locked || !cancellingReceipt.reason.trim()}>
                    {t('production.finishPipeline.confirmCancelReceipt')}
                  </Button>
                </div>
              </form>
            )}
          </article>
        ))}
      </div>
    </div>
  );

  const stepStates = [
    { id: 1, label: t('production.finishPipeline.stepDocuments'), done: !preview.step1_blocked && activeStep > 1, enabled: true },
    { id: 2, label: t('production.finishPipeline.stepBalances'), done: !preview.step1_blocked && !preview.step2_blocked && activeStep > 2, enabled: !preview.step1_blocked },
    { id: 3, label: t('production.finishPipeline.stepConfirm'), done: false, enabled: !preview.step1_blocked && !preview.step2_blocked && !parsedReturn.hasError },
  ];

  const scrapAdjustments = preview.scraps.filter(
    scrap => exactCompare(exactQuantity(scrap, 'stock_rounding_quantity'), 0) > 0
      || exactCompare(exactQuantity(scrap, 'discard_rounding_quantity'), 0) > 0,
  );

  return (
    <Modal
      wide
      className="production-finish-modal"
      title={t('production.finishPipeline.title')}
      subtitle={`${order.number} · ${order.product_name}`}
      onClose={() => { if (!locked) onClose(); }}
    >
      <div className="form-body production-finish-body">
        <nav className="production-finish-stepper" aria-label={t('production.finishPipeline.title')}>
          {stepStates.map(item => (
            <button
              key={item.id}
              type="button"
              className={`production-finish-step${activeStep === item.id ? ' is-active' : ''}${item.done ? ' is-done' : ''}`}
              aria-current={activeStep === item.id ? 'step' : undefined}
              disabled={locked || !item.enabled}
              onClick={() => { action.setError(''); setStep(item.id); }}
            >
              {item.done && <Check size={14} aria-hidden="true" />}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {statusMessage && !action.error && (
          <p className="bom-success" role="status">{productionMessage(statusMessage)}</p>
        )}
        {action.error && (
          <p className="form-error" role="alert">{productionMessage(action.error)}</p>
        )}

        {activeStep === 1 && (
          <div className="production-finish-section">
            {!preview.step1_has_items && (
              <div className="production-finish-ready" role="status">
                <Check size={18} aria-hidden="true" />
                <span>{t('production.finishPipeline.step1Ready')}</span>
              </div>
            )}

            {!preview.has_output && (
              <div className="production-warning-box" role="alert">
                <p>{t('production.finishPipeline.noOutputBlocker')}</p>
                {onOpenRegistration && (
                  <Button disabled={locked} onClick={() => onOpenRegistration()}>
                    {t('production.finishPipeline.goToRegister')}
                  </Button>
                )}
              </div>
            )}

            {preview.pending_material_documents.length > 0 && (
              <div className="production-finish-block">
                <div className="production-finish-block-head">
                  <h3>{t('production.finishPipeline.pendingMaterialDocsTitle')}</h3>
                  <Badge tone="orange">{preview.pending_material_documents.length}</Badge>
                </div>
                <p className="bom-hint">{t('production.finishPipeline.pendingMaterialDocsHint')}</p>
                <MaterialDocumentList
                  documents={preview.pending_material_documents}
                  busy={locked}
                  defaultExpanded
                  onConfirm={canApprove ? confirmMaterialDoc : null}
                  onCancel={canApprove || canManage ? cancelMaterialDoc : null}
                />
              </div>
            )}

            {preview.pending_registrations.length > 0 && (
              <div className="production-finish-block">
                {!preview.step1_blocked && preview.unsettled_registrations.length > 0 && (
                  <p className="bom-hint">{t('production.finishPipeline.step1AutoSettleHint')}</p>
                )}
                <ProductionAcceptanceRegistrations
                  order={order}
                  data={data}
                  pendingOnly
                  onSaved={notifyUpdate}
                />
              </div>
            )}

            {preview.pending_stage_receipts.length > 0 && renderPendingStageReceipts()}

            {(preview.waiting_for_output || preview.post_processing_gaps.length > 0 || preview.operation_wip.length > 0) && (
              <div className="production-finish-block">
                <h3>{t('production.finishPipeline.operationWipTitle')}</h3>
                {preview.waiting_for_output && (
                  <div className="production-warning-box">
                    <p>{t('production.outputIncomplete')}</p>
                    {preview.can_confirm_output_completion && canManage && (
                      <Button disabled={locked} onClick={confirmOutputCompletion}>
                        {t('production.confirmOutputCompletion')}
                      </Button>
                    )}
                  </div>
                )}
                {preview.post_processing_gaps.length > 0 && (
                  <div className="production-finish-card-list">
                    {preview.post_processing_gaps.map(gap => (
                      <div className="production-finish-card" key={`${gap.path}:${gap.node_id}`}>
                        <div className="production-finish-card-head">
                          <span>{t('production.postProcessingGap', { name: gap.name, count: formatQty(gap.remaining) })}</span>
                          {onOpenRegistration && (
                            <Button disabled={locked} onClick={() => onOpenRegistration(JSON.stringify([gap.path, gap.node_id]))}>
                              {t('production.finishPipeline.goToRegister')}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {preview.operation_wip.length > 0 && (
                  <div className="production-finish-card-list">
                    <p className="bom-hint">{t('production.finishPipeline.operationWipHint')}</p>
                    {preview.operation_wip.map(wip => (
                      <div className="production-finish-card" key={`${wip.path}:${wip.node_id}`}>
                        <div className="production-finish-card-head">
                          <span>{t('production.finishPipeline.operationWipLine', {
                            layer: wip.layer_name,
                            name: wip.name,
                            wip: formatQty(exactQuantity(wip, 'wip_quantity')),
                            unit: wip.unit,
                            completed: formatQty(exactQuantity(wip, 'completed_quantity')),
                            output: formatQty(exactQuantity(wip, 'output_quantity')),
                          })}</span>
                          {onOpenRegistration && (
                            <Button disabled={locked} onClick={() => onOpenRegistration(JSON.stringify([wip.path, wip.node_id]))}>
                              {t('production.finishPipeline.goToRegister')}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeStep === 2 && (
          <div className="production-finish-section">
            {order.stage_workflow && (preview.semi_finished_balances.length > 0 || preview.pending_stage_receipts.length > 0) && (
              <div className="production-finish-block">
                <div className="production-finish-block-head">
                  <h3>{t('production.finishPipeline.semiFinishedSectionTitle')}</h3>
                  {preview.semi_finished_balances.length > 0 && (
                    <Badge tone="orange">{preview.semi_finished_balances.length}</Badge>
                  )}
                </div>
                <p className="bom-hint" role="alert">{t('production.finishPipeline.semiFinishedSectionHint')}</p>
                {preview.semi_finished_balances.length > 0 && (
                  <div className="production-finish-card-list">
                    {preview.semi_finished_balances.map(stage => {
                      const avail = exactQuantity(stage, 'available_quantity');
                      const value = stageInputs[stage.path] ?? quantityInput(avail);
                      return (
                        <article className="production-finish-card" key={stage.path}>
                          <div className="production-finish-card-head">
                            <div>
                              <strong>{stage.name}</strong>
                              <small>
                                {stage.pool_paths ? t('production.sharedSemiFinished') : stage.path} ·{' '}
                                {t('production.finishPipeline.semiFinishedLabel', {
                                  quantity: formatQty(avail),
                                  unit: stage.unit,
                                  completed: formatQty(exactQuantity(stage, 'completed_quantity')),
                                  consumed: formatQty(exactQuantity(stage, 'consumed_quantity')),
                                })}
                              </small>
                            </div>
                          </div>
                          <div className="production-finish-stage-actions">
                            <label>
                              {t('production.stageReceiptQuantity')}（{stage.unit}）
                              <Input
                                aria-label={`${stage.name} ${t('production.stageReceiptQuantity')}`}
                                inputMode="text"
                                disabled={locked}
                                value={value}
                                onChange={event => setStageInputs(prev => ({ ...prev, [stage.path]: event.target.value }))}
                              />
                            </label>
                            <div className="bom-actions">
                              <Button disabled={locked} onClick={() => setStageInputs(prev => ({ ...prev, [stage.path]: quantityInput(avail) }))}>
                                {t('production.stageReceiptAll')}
                              </Button>
                              <Button kind={canApprove ? 'secondary' : 'primary'} disabled={locked || !String(value).trim()} onClick={() => submitStageReceipt(stage, false)}>
                                {t('production.stageReceiptSubmit')}
                              </Button>
                              {canApprove && (
                                <Button kind="primary" disabled={locked || !String(value).trim()} onClick={() => submitStageReceipt(stage, true)}>
                                  {t('production.finishPipeline.semiFinishedRequestAndConfirm')}
                                </Button>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
                {preview.pending_stage_receipts.length > 0 && renderPendingStageReceipts()}
                {onOpenRegistration && (
                  <div className="production-finish-sub-hint">
                    <span className="bom-hint">{t('production.finishPipeline.semiFinishedConsumeHint')}</span>
                    <Button disabled={locked} onClick={() => onOpenRegistration()}>
                      {t('production.finishPipeline.goToRegister')}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {preview.rounding_shortages.length > 0 && (
              <div className="production-warning-box" role="alert">
                <strong>{t('production.finishPipeline.roundingShortageTitle')}</strong>
                {preview.rounding_shortages.map(item => (
                  <p key={item.product_id}>
                    {t('production.finishPipeline.roundingShortageItem', {
                      name: item.name,
                      rounding: formatQty(exactQuantity(item, 'rounding_quantity')),
                      available: formatQty(exactQuantity(item, 'projected_available_quantity')),
                      shortage: formatQty(exactQuantity(item, 'rounding_shortage_quantity')),
                      unit: item.unit,
                    })}
                  </p>
                ))}
                {onOpenSupplement && (
                  <Button disabled={locked} onClick={onOpenSupplement}>
                    {t('production.finishPipeline.goToSupplement')}
                  </Button>
                )}
              </div>
            )}

            {preview.returnable_materials.length > 0 && (
              <div className="production-finish-block">
                <div className="production-finish-block-head">
                  <h3>{t('production.finishPipeline.materialReturnSectionTitle')}</h3>
                  <Badge tone="blue">{preview.returnable_materials.length}</Badge>
                </div>
                <p className="bom-hint">{t('production.finishPipeline.materialReturnSectionHint')}</p>

                <div className="production-finish-toggles">
                  <Checkbox
                    checked={submitReturn}
                    disabled={locked}
                    onChange={event => setReturnToggle(event.target.checked)}
                  >
                    {t('production.finishPipeline.submitReturnToggle')}
                  </Checkbox>
                  {submitReturn && canApprove && (
                    <Checkbox
                      checked={confirmReturn}
                      disabled={locked || parsedReturn.items.length === 0}
                      onChange={event => setConfirmReturn(event.target.checked)}
                    >
                      {t('production.finishPipeline.confirmReturnToggle')}
                    </Checkbox>
                  )}
                </div>

                {submitReturn && (
                  <>
                    <div className="bom-actions">
                      <Button disabled={locked} onClick={() => setReturnOverrides({})}>
                        {t('production.finishPipeline.fillAllReturnable')}
                      </Button>
                      <Button
                        disabled={locked}
                        onClick={() => setReturnOverrides(Object.fromEntries(preview.returnable_materials.map(item => [item.product_id, '0'])))}
                      >
                        {t('production.finishPipeline.clearAllReturnable')}
                      </Button>
                    </div>

                    <div className="production-finish-return-list">
                      {preview.returnable_materials.map(item => {
                        const available = exactQuantity(item, 'projected_available_quantity');
                        const rounding = exactQuantity(item, 'rounding_quantity');
                        const returnable = exactQuantity(item, 'returnable_quantity');
                        const inputValue = returnOverrides[item.product_id] ?? quantityInput(returnable);
                        const rowError = parsedReturn.errors.get(item.product_id);
                        return (
                          <article className="production-finish-return-row" key={item.product_id}>
                            <div className="production-finish-return-name">
                              <strong>{item.name}</strong>
                              <small>{item.barcode}{item.specification ? ` · ${item.specification}` : ''}</small>
                            </div>
                            <div>
                              <small>{t('production.finishPipeline.currentBalanceCol')}</small>
                              <span>{formatQty(available)} {item.unit}</span>
                            </div>
                            <div>
                              <small>{t('production.finishPipeline.roundingDeductionCol')}</small>
                              <span>{exactCompare(rounding, 0) > 0 ? `-${formatQty(rounding)}` : '0'} {item.unit}</span>
                            </div>
                            <div>
                              <small>{t('production.finishPipeline.returnableCol')}</small>
                              <span><strong>{formatQty(returnable)} {item.unit}</strong></span>
                            </div>
                            <label className="production-finish-return-input">
                              <small>{t('production.finishPipeline.returnQuantityCol')}（{item.unit}）</small>
                              <Input
                                aria-label={t('production.finishPipeline.returnQuantityLabel', { name: item.name })}
                                inputMode="text"
                                disabled={locked}
                                value={inputValue}
                                onChange={event => setReturnOverrides(prev => ({ ...prev, [item.product_id]: event.target.value }))}
                              />
                              {rowError && <span className="form-error" role="alert">{rowError}</span>}
                            </label>
                          </article>
                        );
                      })}
                    </div>

                    <label className="bom-note">
                      {t('production.finishPipeline.returnNoteLabel')}
                      <Input.TextArea
                        aria-label={t('production.finishPipeline.returnNoteLabel')}
                        rows={2}
                        maxLength={500}
                        disabled={locked}
                        value={returnNote}
                        onChange={event => setReturnNote(event.target.value)}
                      />
                    </label>
                  </>
                )}
              </div>
            )}

            {!preview.semi_finished_balances.length
              && !preview.pending_stage_receipts.length
              && !preview.rounding_shortages.length
              && !preview.returnable_materials.length && (
                <div className="production-finish-ready" role="status">
                  <Check size={18} aria-hidden="true" />
                  <span>{t('production.finishPipeline.noBalances')}</span>
                </div>
            )}
          </div>
        )}

        {activeStep === 3 && (
          <div className="production-finish-section">
            <div className="production-finish-block">
              <h3>{t('production.finishPipeline.settlementSummaryTitle')}</h3>
              <dl className="production-finish-summary-grid">
                <div>
                  <dt>{t('production.finishPipeline.outputSummaryLabel')}</dt>
                  <dd>{formatQty(exactQuantity(preview.product, 'completed_quantity'))} {order.unit}</dd>
                </div>
                <div>
                  <dt>{t('production.finishPipeline.outputRoundingLabel')}</dt>
                  <dd>{formatQty(exactQuantity(preview.product, 'rounding_quantity'))} {order.unit}</dd>
                </div>
                <div>
                  <dt>{t('production.finishPipeline.settledOutputLabel')}</dt>
                  <dd><strong>{formatQty(exactQuantity(preview.product, 'settled_quantity'))} {order.unit}</strong></dd>
                </div>
              </dl>
            </div>

            {preview.rounding_materials.length > 0 && (
              <div className="production-finish-block">
                <h3>{t('production.finishPipeline.materialRoundingSummaryTitle')}</h3>
                <ul className="production-finish-plain-list">
                  {preview.rounding_materials.map(item => (
                    <li key={item.product_id}>
                      <span>{item.name}</span>
                      <span>+{formatQty(exactQuantity(item, 'rounding_quantity'))} {item.unit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {scrapAdjustments.length > 0 && (
              <div className="production-finish-block">
                <h3>{t('production.finishPipeline.scrapRoundingSummaryTitle')}</h3>
                <ul className="production-finish-plain-list">
                  {scrapAdjustments.map(scrap => (
                    <li key={scrap.product_id}>
                      <span>{scrap.name}</span>
                      <span>
                        {[
                          exactCompare(exactQuantity(scrap, 'stock_rounding_quantity'), 0) > 0
                            && `+${formatQty(exactQuantity(scrap, 'stock_rounding_quantity'))} ${scrap.unit}`,
                          exactCompare(exactQuantity(scrap, 'discard_rounding_quantity'), 0) > 0
                            && `+${formatQty(exactQuantity(scrap, 'discard_rounding_quantity'))} ${scrap.unit}`,
                        ].filter(Boolean).join(' / ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="production-finish-block">
              <h3>{t('production.finishPipeline.returnPreviewTitle')}</h3>
              {submitReturn && parsedReturn.items.length > 0 ? (
                <>
                  <p className="bom-hint">
                    {t(
                      canApprove && confirmReturn
                        ? 'production.finishPipeline.returnPreviewConfirmed'
                        : 'production.finishPipeline.returnPreviewPending',
                    )}
                  </p>
                  <ul className="production-finish-plain-list">
                    {parsedReturn.items.map(item => (
                      <li key={item.product_id}>
                        <span>{item.name}</span>
                        <strong>{formatQty(item.quantity)} {item.unit}</strong>
                      </li>
                    ))}
                  </ul>
                  {returnNote.trim() && <p className="production-note">{returnNote.trim()}</p>}
                </>
              ) : (
                <p className="bom-hint">
                  {t(
                    preview.returnable_materials.length > 0
                      ? 'production.finishPipeline.returnPreviewSkipped'
                      : 'production.finishPipeline.returnPreviewEmpty',
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="modal-footer production-finish-footer">
        {activeStep > 1 && (
          <Button disabled={locked} onClick={() => { action.setError(''); setStep(activeStep - 1); }}>
            {t('production.finishPipeline.prevStep')}
          </Button>
        )}
        <Button disabled={locked} onClick={onClose}>{t('production.cancel')}</Button>
        {activeStep === 1 && (
          <Button
            kind="primary"
            disabled={locked || preview.step1_blocked}
            onClick={() => { action.setError(''); setStep(2); }}
          >
            {t('production.finishPipeline.nextBalances')}
          </Button>
        )}
        {activeStep === 2 && (
          <Button
            kind="primary"
            disabled={locked || preview.step2_blocked || parsedReturn.hasError}
            onClick={() => { action.setError(''); setStep(3); }}
          >
            {t('production.finishPipeline.nextConfirm')}
          </Button>
        )}
        {activeStep === 3 && (
          <Button
            kind="primary"
            busy={action.busy}
            disabled={locked || preview.step1_blocked || preview.step2_blocked || parsedReturn.hasError}
            onClick={submitFinish}
          >
            {t('production.finishPipeline.confirmFinish')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
