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
  exactAdd,
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
    preview?.review_has_items ? 1
      : preview?.step1_has_items ? 2
        : preview?.step2_has_items ? 3 : 4
  ));
  const [statusMessage, setStatusMessage] = useState('');
  const [reviewOverrides, setReviewOverrides] = useState({});
  const [reviewReasons, setReviewReasons] = useState({});
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

  const duplicateStageNames = new Set(
    preview.review_stages
      .map(stage => stage.name)
      .filter((name, index, list) => list.indexOf(name) !== index),
  );
  const reviewEntries = order.stage_workflow
    ? preview.review_stages.flatMap(stage => {
        const stageLabel = duplicateStageNames.has(stage.name) && stage.path ? `${stage.name} [${stage.path}]` : stage.name;
        return stage.items.map(node => ({
          key: `${stage.path}:${node.path}`,
          stage_path: stage.path,
          input_path: node.path,
          product_id: node.product_id,
          name: node.name,
          barcode: node.barcode,
          specification: node.specification,
          unit: node.unit,
          kind: node.usage_mode === 'explode' ? 'semi' : 'raw',
          recorded: exactQuantity(node, 'recorded_quantity'),
          standard: node.standard_quantity,
          poolKey: node.pool_key,
          poolBaseAvailable: exactQuantity(node, 'pool_available_quantity'),
          cannotBeZero: node.cannot_be_zero,
          postQuantity: 0,
          labelName: `${stageLabel} · ${node.name}`,
        }));
      })
    : preview.review_materials.map(item => ({
        key: String(item.product_id),
        product_id: item.product_id,
        name: item.name,
        barcode: item.barcode,
        specification: item.specification,
        unit: item.unit,
        kind: 'raw',
        recorded: exactQuantity(item, 'recorded_quantity'),
        standard: item.standard_quantity,
        poolKey: `raw:${item.product_id}`,
        poolBaseAvailable: exactQuantity(item, 'review_available_quantity'),
        cannotBeZero: false,
        postQuantity: exactQuantity(item, 'post_processing_consumed_quantity'),
        labelName: item.name,
      }));

  const parsedReview = (() => {
    const errors = new Map();
    const parsedValues = new Map();
    const poolDeltas = new Map();
    const positiveDeltasByPool = new Map();
    let hasValueChanges = false;
    let hasReasonChanges = false;

    for (const entry of reviewEntries) {
      const raw = reviewOverrides[entry.key] ?? quantityInput(entry.recorded);
      const trimmed = String(raw ?? '').trim();
      const reason = String(reviewReasons[entry.key] ?? '').trim();
      if (reason) hasReasonChanges = true;
      try {
        const parsed = parseExactQuantity(trimmed, false);
        parsedValues.set(entry.key, parsed);
        if (entry.cannotBeZero && exactCompare(parsed, 0) <= 0) {
          errors.set(entry.key, `${entry.name} ${t('production.finishPipeline.reviewSemiRequired')}`);
          continue;
        }
        const delta = exactSubtract(parsed, entry.recorded);
        if (exactCompare(delta, 0) !== 0) hasValueChanges = true;
        poolDeltas.set(entry.poolKey, exactAdd(poolDeltas.get(entry.poolKey) ?? 0, delta));
        if (exactCompare(delta, 0) > 0) {
          const list = positiveDeltasByPool.get(entry.poolKey) || [];
          list.push(entry);
          positiveDeltasByPool.set(entry.poolKey, list);
        }
      } catch (error) {
        hasValueChanges = true;
        errors.set(entry.key, productionMessage(error.message));
      }
    }

    for (const [poolKey, delta] of poolDeltas.entries()) {
      const entriesInPool = positiveDeltasByPool.get(poolKey) || [];
      if (!entriesInPool.length) continue;
      const baseAvailable = entriesInPool[0].poolBaseAvailable;
      if (exactCompare(delta, baseAvailable) > 0) {
        for (const entry of entriesInPool) {
          if (errors.has(entry.key)) continue;
          const ownVal = parsedValues.get(entry.key);
          const ownDelta = exactSubtract(ownVal, entry.recorded);
          const othersDelta = exactSubtract(delta, ownDelta);
          const headroom = exactSubtract(baseAvailable, othersDelta);
          const maxForEntry = exactAdd(entry.recorded, headroom);
          errors.set(
            entry.key,
            t('production.finishPipeline.reviewExceededPool', { max: formatQty(maxForEntry), unit: entry.unit }),
          );
        }
      }
    }

    return {
      errors,
      parsedValues,
      poolDeltas,
      hasValueChanges,
      hasReasonChanges,
      hasChanges: hasValueChanges || hasReasonChanges,
      hasError: errors.size > 0,
    };
  })();

  const reviewLocked = parsedReview.hasChanges || parsedReview.hasError;
  const activeStep = reviewLocked
    ? 1
    : preview.step1_blocked && step > 2
      ? 2
      : preview.step2_blocked && step > 3
        ? 3
        : step;

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

  const resetReview = () => {
    action.setError('');
    setStatusMessage('');
    setReviewOverrides({});
    setReviewReasons({});
  };

  const saveReview = advance => action.run(async () => {
    if (parsedReview.hasError || !parsedReview.hasChanges) {
      if (advance && !parsedReview.hasChanges && !parsedReview.hasError) {
        action.setError('');
        setStep(2);
      }
      return;
    }
    const payload = order.stage_workflow
      ? {
          version: order.version,
          stage_inputs: reviewEntries.map(entry => {
            const qty = parsedReview.parsedValues.get(entry.key);
            const reason = String(reviewReasons[entry.key] ?? '').trim();
            return {
              stage_path: entry.stage_path,
              input_path: entry.input_path,
              quantity: qty,
              ...(reason ? { variance_reason: reason } : {}),
            };
          }),
        }
      : {
          version: order.version,
          items: reviewEntries.map(entry => {
            const qty = parsedReview.parsedValues.get(entry.key);
            const reason = String(reviewReasons[entry.key] ?? '').trim();
            return {
              product_id: entry.product_id,
              quantity: qty,
              ...(reason ? { variance_reason: reason } : {}),
            };
          }),
        };
    const fresh = await sendOrderAction('/consumption-review', payload);
    setReviewOverrides({});
    setReviewReasons({});
    setReturnOverrides({});
    setStageInputs({});
    await notifyUpdate(fresh, t('production.finishPipeline.reviewSaved'));
    if (advance) setStep(2);
  });

  const submitFinish = () => action.run(async () => {
    if (reviewLocked || preview.step1_blocked || preview.step2_blocked || parsedReturn.hasError) return;
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

  const renderReviewRow = entry => {
    const rawValue = reviewOverrides[entry.key] ?? quantityInput(entry.recorded);
    const reasonValue = reviewReasons[entry.key] ?? '';
    const rowError = parsedReview.errors.get(entry.key);
    const parsed = parsedReview.parsedValues.get(entry.key);
    const delta = parsed !== undefined && !rowError ? exactSubtract(parsed, entry.recorded) : 0;
    const poolHeadroom = exactSubtract(entry.poolBaseAvailable, parsedReview.poolDeltas.get(entry.poolKey) ?? 0);
    return (
      <article className="production-finish-review-row" key={entry.key}>
        <div className="production-finish-return-name">
          <div className="production-finish-review-title">
            <strong>{entry.name}</strong>
            <Badge tone={entry.kind === 'semi' ? 'blue' : 'gray'}>
              {t(entry.kind === 'semi' ? 'production.finishPipeline.reviewSemiBadge' : 'production.finishPipeline.reviewRawBadge')}
            </Badge>
          </div>
          <small>{entry.barcode}{entry.specification ? ` · ${entry.specification}` : ''}</small>
          {exactCompare(entry.postQuantity, 0) > 0 && (
            <small>{t('production.finishPipeline.reviewPostAdded', { quantity: formatQty(entry.postQuantity), unit: entry.unit })}</small>
          )}
        </div>
        <div>
          <small>{t('production.finishPipeline.reviewRecordedLabel')}</small>
          <span>{formatQty(entry.recorded)} {entry.unit}</span>
          {entry.standard != null && (
            <small>{t('production.finishPipeline.reviewStandardLabel')} {formatQty(entry.standard)} {entry.unit}</small>
          )}
        </div>
        <div>
          <small>{t('production.finishPipeline.reviewPoolHeadroom')}</small>
          <span>{formatQty(poolHeadroom)} {entry.unit}</span>
        </div>
        <label className="production-finish-return-input">
          <small>{t('production.finishPipeline.reviewInputLabel', { name: entry.name })}（{entry.unit}）</small>
          <Input
            aria-label={t('production.finishPipeline.reviewInputLabel', { name: entry.labelName })}
            inputMode="text"
            disabled={locked}
            value={rawValue}
            onChange={event => setReviewOverrides(prev => ({ ...prev, [entry.key]: event.target.value }))}
          />
          {!rowError && exactCompare(delta, 0) !== 0 && (
            <small className={exactCompare(delta, 0) > 0 ? 'production-finish-delta-up' : 'production-finish-delta-down'}>
              {t('production.finishPipeline.reviewDelta', {
                delta: `${exactCompare(delta, 0) > 0 ? '+' : ''}${formatQty(delta)}`,
                unit: entry.unit,
              })}
            </small>
          )}
          {rowError && <span className="form-error" role="alert">{rowError}</span>}
        </label>
        <label className="production-finish-review-reason">
          <small>{t('production.finishPipeline.reviewReasonLabel', { name: entry.name })}</small>
          <Input
            aria-label={t('production.finishPipeline.reviewReasonLabel', { name: entry.labelName })}
            maxLength={500}
            placeholder={t('production.finishPipeline.reviewReasonPlaceholder')}
            disabled={locked}
            value={reasonValue}
            onChange={event => setReviewReasons(prev => ({ ...prev, [entry.key]: event.target.value }))}
          />
        </label>
      </article>
    );
  };

  const stepStates = [
    { id: 1, label: t('production.finishPipeline.stepReview'), done: !reviewLocked && activeStep > 1, enabled: true },
    { id: 2, label: t('production.finishPipeline.stepDocuments'), done: !reviewLocked && !preview.step1_blocked && activeStep > 2, enabled: !reviewLocked },
    { id: 3, label: t('production.finishPipeline.stepBalances'), done: !reviewLocked && !preview.step1_blocked && !preview.step2_blocked && activeStep > 3, enabled: !reviewLocked && !preview.step1_blocked },
    { id: 4, label: t('production.finishPipeline.stepConfirm'), done: false, enabled: !reviewLocked && !preview.step1_blocked && !preview.step2_blocked && !parsedReturn.hasError },
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
            <div className="production-finish-block">
              <div className="production-finish-block-head">
                <h3>{t('production.finishPipeline.reviewTitle')}</h3>
                {preview.review_has_items && <Badge tone="blue">{reviewEntries.length}</Badge>}
              </div>
              <p className="bom-hint">{t('production.finishPipeline.reviewHint')}</p>

              {order.pending_registration_count > 0 && (
                <p className="bom-hint">
                  {t('production.finishPipeline.reviewPendingHint', { count: order.pending_registration_count })}
                </p>
              )}

              {reviewLocked && (
                <p className="bom-hint" role="status">{t('production.finishPipeline.reviewUnsavedHint')}</p>
              )}

              {!preview.review_has_items && (
                <div className="production-finish-ready" role="status">
                  <Check size={18} aria-hidden="true" />
                  <span>{t('production.finishPipeline.reviewEmpty')}</span>
                </div>
              )}

              {preview.review_has_items && !order.stage_workflow && (
                <div className="production-finish-card-list">
                  {preview.review_materials.map(item => {
                    const entry = reviewEntries.find(candidate => candidate.key === String(item.product_id));
                    return entry ? renderReviewRow(entry) : null;
                  })}
                </div>
              )}

              {preview.review_has_items && order.stage_workflow && (
                <div className="production-finish-card-list">
                  {preview.review_stages.map(stage => {
                    const stageLabel = duplicateStageNames.has(stage.name) && stage.path ? `${stage.name} [${stage.path}]` : stage.name;
                    return (
                      <div className="production-finish-card" key={stage.path || 'root'}>
                        <div className="production-finish-card-head">
                          <div>
                            <strong>{stageLabel}</strong>
                            <small>
                              {t(stage.path ? 'production.finishPipeline.reviewStageSub' : 'production.finishPipeline.reviewStageRoot')} ·{' '}
                              {t('production.finishPipeline.reviewStageOutput', {
                                quantity: formatQty(exactQuantity(stage, 'completed_quantity')),
                                unit: stage.unit,
                              })}
                            </small>
                          </div>
                        </div>
                        <div className="production-finish-card-list">
                          {stage.items.map(node => {
                            const entry = reviewEntries.find(candidate => candidate.key === `${stage.path}:${node.path}`);
                            return entry ? renderReviewRow(entry) : null;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {preview.review_post_processing_materials.length > 0 && (
                <div className="production-finish-block">
                  <h3>{t('production.finishPipeline.reviewPostProcessingList')}</h3>
                  <ul className="production-finish-plain-list">
                    {preview.review_post_processing_materials.map(item => (
                      <li key={item.product_id}>
                        <span>{item.name}</span>
                        <strong>{formatQty(exactQuantity(item, 'post_processing_consumed_quantity'))} {item.unit}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {activeStep === 2 && (
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

        {activeStep === 3 && (
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

        {activeStep === 4 && (
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
        {activeStep === 1 && !parsedReview.hasChanges && (
          <Button
            kind="primary"
            disabled={locked}
            onClick={() => { action.setError(''); setStep(2); }}
          >
            {t('production.finishPipeline.nextDocuments')}
          </Button>
        )}
        {activeStep === 1 && parsedReview.hasChanges && (
          <>
            <Button disabled={locked} onClick={resetReview}>
              {t('production.finishPipeline.resetReview')}
            </Button>
            <Button
              disabled={locked || parsedReview.hasError}
              onClick={() => saveReview(false)}
            >
              {t('production.finishPipeline.saveReview')}
            </Button>
            <Button
              kind="primary"
              busy={action.busy}
              disabled={locked || parsedReview.hasError}
              onClick={() => saveReview(true)}
            >
              {t('production.finishPipeline.saveReviewAndNext')}
            </Button>
          </>
        )}
        {activeStep === 2 && (
          <Button
            kind="primary"
            disabled={locked || preview.step1_blocked}
            onClick={() => { action.setError(''); setStep(3); }}
          >
            {t('production.finishPipeline.nextBalances')}
          </Button>
        )}
        {activeStep === 3 && (
          <Button
            kind="primary"
            disabled={locked || preview.step2_blocked || parsedReturn.hasError}
            onClick={() => { action.setError(''); setStep(4); }}
          >
            {t('production.finishPipeline.nextConfirm')}
          </Button>
        )}
        {activeStep === 4 && (
          <Button
            kind="primary"
            busy={action.busy}
            disabled={locked || reviewLocked || preview.step1_blocked || preview.step2_blocked || parsedReturn.hasError}
            onClick={submitFinish}
          >
            {t('production.finishPipeline.confirmFinish')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
