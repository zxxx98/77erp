import { contactMatchesDirection } from '../../shared/contacts.js';
import { usePermissions } from '../permissions.jsx';
import { useState, useRef } from 'react';
import { useBusiness } from '../business-api.js';
import { Templates, CameraScanner } from '../LazyComponents.jsx';
import { ContactPicker } from '../Dropdown.jsx';
import { useProductSelection, lookupProductCode } from '../product-query.js';
import { useQuery } from '../queries.js';
import { addQuantity } from '../../shared/quantity.js';
import { Modal, QueryStatus, Button, ProductArt } from '../components/common.jsx';
import { FilePenLine, Camera, ScanLine, Plus, Search, X, CircleCheck, Trash2, TriangleAlert, Check } from 'lucide-react';
import { money, count } from '../app/format.js';

function OrderForm({ type, initialProduct, initialTemplate, data, onClose, onSaved }) {
  const { templates } = usePermissions();
  const [template, setTemplate] = useState(initialTemplate || null);
  const [templateName, setTemplateName] = useState(initialTemplate?.name || "");
  const [templateMessage, setTemplateMessage] = useState("");
  const [templateRevision, setTemplateRevision] = useState(0);
  const [partnerId, setPartnerId] = useState(initialTemplate?.partner_id ?? null);
  const templateAction = useBusiness();
  const submitLock = useRef(false);
  const [items, setItems] = useState(
    initialTemplate ? initialTemplate.items : initialProduct
      ? [
          {
            product_id: initialProduct.id,
            quantity: 1,
            price: type === "in" ? initialProduct.cost : initialProduct.price,
          },
        ]
      : [],
  );
  const [partner, setPartner] = useState(initialTemplate?.partner ?? (type === "out" ? "零售客户" : "")),
    [note, setNote] = useState(initialTemplate?.note || ""),
    [barcode, setBarcode] = useState(""),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [camera, setCamera] = useState(false),
    [scanMessage, setScanMessage] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const selection = useProductSelection(data, items, query, includeInactive, initialProduct);
  const contacts = useQuery('/contacts', data);
  data = { ...data, products: selection.products, contacts: contacts.result || [] };
  const add = (p) => {
    selection.remember(p);
    setItems((prev) => {
      const found = prev.find((i) => i.product_id === p.id);
      return found
        ? prev.map((i) =>
            i.product_id === p.id
              ? { ...i, quantity: addQuantity(Number(i.quantity), 1) }
              : i,
          )
        : [
            ...prev,
            {
              product_id: p.id,
              quantity: 1,
              price: type === "in" ? p.cost : p.price,
            },
          ];
    });
    setQuery("");
    setScanMessage(`已添加 ${p.name}${p.active === 0 ? "（已停用）" : ""}`);
    setError("");
  };
  const scan = async (code) => {
    setCamera(false);
    try {
      const p = await lookupProductCode(code, data);
      if (!p) {
        setError(`未找到条码「${code.trim()}」，请先在物料管理中建档。`);
        return;
      }
      add(p);
      setBarcode("");
    } catch (e) {
      setError(e.message);
    }
  };
  const update = (id, key, value) =>
    setItems((prev) =>
      prev.map((i) => (i.product_id === id ? { ...i, [key]: value } : i)),
    );
  const total =
    items.reduce(
      (s, i) => s + Math.round(Number(i.quantity) * Number(i.price) * 100),
      0,
    ) / 100;
  const totalQuantity = items.reduce(
    (sum, item) => sum + (Number(item.quantity) || 0),
    0,
  );
  const submit = async (e) => {
    e.preventDefault();
    if (!items.length) {
      setError("请至少添加一件物料。");
      return;
    }
    if (submitLock.current || templateAction.busy) return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await templateAction.send('/orders', {
        type,
        ...(partnerId ? { partner_id: partnerId } : {}),
        partner, note,
        items: items.map(i => ({ ...i, quantity: Number(i.quantity), price: Number(i.price) })),
      });
      await onSaved(`${type === "in" ? "入库" : "出库"}成功 · ${r.number}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  };
  const saveTemplate = (overwrite) => templateAction.run(async () => {
    setTemplateMessage("");
    const result = await templateAction.send("/templates", {
      ...(overwrite && template ? { id: template.id, version: template.version } : {}),
      name: templateName, type, partner, partner_id: partnerId, note, items,
    });
    setTemplate(result);
    setTemplateName(result.name);
    setTemplateRevision(value => value + 1);
    setTemplateMessage(`模板「${result.name}」已保存，可反复套用`);
  });
  const partners = (data.contacts || []).filter(c => c.active && contactMatchesDirection(c, type));
  const internal = partners.find(c => c.id === partnerId)?.role === 'internal';
  const matches = selection.matches.slice(0, 6);
  return (
    <Modal
      title={internal ? (type === "in" ? "新建内部入库" : "新建内部出库") : type === "in" ? "新建采购入库" : "新建销售出库"}
      subtitle={`确认后将${type === "in" ? "增加" : "扣减"}库存，并生成可追溯的${type === "in" ? "入库" : "出库"}单据`}
      onClose={busy || templateAction.busy ? () => {} : onClose}
      wide
    >
      <form onSubmit={submit}>
        {selection.error && <div role="alert">{selection.error}</div>}<QueryStatus query={contacts} />
        <div className="form-body order-form-body">
          <label className="inactive-product-option"><input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />包含停用物料（用于清库存等操作）</label>

          <Templates collapsible type={type} activeId={template?.id} refreshKey={templateRevision} disabled={busy || templateAction.busy} onUse={d => {
            if ((items.length || note) && !window.confirm("套用模板将替换当前编辑内容，是否继续？")) return false;
            setTemplate(d); setTemplateName(d.name); setTemplateMessage(""); setPartner(d.partner); setPartnerId(d.partner_id); setNote(d.note); setItems(d.items);
          }} />
          {template && <span className="order-template-status"><FilePenLine size={15} aria-hidden="true" />已套用「{template.name}」<small>本次修改不会自动更新模板</small></span>}
          {templates && <div className="template-save-panel">
            <label>模板名称<input value={templateName} maxLength={100} placeholder="例如：每周日用品补货" disabled={busy || templateAction.busy} onChange={e => setTemplateName(e.target.value)} /></label>
            <div className="order-template-actions">
              <Button type="button" icon={FilePenLine} busy={templateAction.busy} disabled={busy || !items.length} onClick={() => saveTemplate(false)}>{template ? "另存为模板" : "保存为模板"}</Button>
              {template && <Button type="button" busy={templateAction.busy} disabled={busy || !items.length} onClick={() => saveTemplate(true)}>更新模板</Button>}
            </div>
            {templateMessage && <p className="template-success" role="status">{templateMessage}</p>}
          </div>
          }
          {templateAction.error && <p role="alert" className="form-error">{templateAction.error}</p>}
          <div className="form-grid">
            <ContactPicker contacts={partners} value={partner} selectedId={partnerId} searchable
              label={type === "in" ? "供应商" : "客户 / 往来单位"}
              placeholder={type === "in" ? "选择供应商或内部单位" : "选择客户或内部单位"}
              required disabled={busy || templateAction.busy}
              onSelect={contact => { setPartner(contact.name); setPartnerId(contact.id); }} />
            <label>
              入出库仓库
              <input value={data.settings.warehouse_name} disabled />
            </label>
          </div>
          {internal && <p className="info-box">内部流转仅调整库存，不计入采购额、销售额、利润及应收应付。入库单价用于库存计价。</p>}
          <div className="order-scan-row">
            <Button
              type="button"
              kind="primary"
              icon={Camera}
              onClick={() => setCamera(!camera)}
            >
              {camera ? "关闭摄像头" : "手机扫码"}
            </Button>
            <div className="input-with-icon">
              <ScanLine size={18} />
              <input
                aria-label="扫描物料条码"
                placeholder="手动输入物料条码"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (barcode) scan(barcode);
                  }
                }}
              />
            </div>
            <Button
              type="button"
              icon={Plus}
              disabled={!barcode.trim()}
              onClick={() => scan(barcode)}
            >
              添加
            </Button>
          </div>
          {camera && <CameraScanner onResult={scan} onClose={() => setCamera(false)} />}
          <div className="product-picker">
            <div className="table-search">
              <Search size={16} />
              <input
                aria-label="查找并添加物料"
                placeholder="或搜索物料名称，点击添加"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="清除"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {query && (
              <div className="picker-results">
                {matches.length ? (
                  matches.map((p) => (
                    <button key={p.id} type="button" onClick={() => add(p)}>
                      <ProductArt product={p} size="small" preview={false} />
                      <span>
                        <strong>{p.name}{p.active === 0 ? "（已停用）" : ""}</strong>
                        <small>
                          {p.barcode} · 库存 {p.stock} {p.unit}
                        </small>
                      </span>
                      <Plus size={16} />
                    </button>
                  ))
                ) : (
                  <p>未找到物料，请先建立物料档案。</p>
                )}
              </div>
            )}
          </div>
          {scanMessage && (
            <div className="scan-feedback">
              <CircleCheck size={14} />
              {scanMessage}
            </div>
          )}
          <div className="order-items-title">
            <strong>
              物料明细 <span>{items.length}</span>
            </strong>
            <small>再次扫描同一物料，数量自动加 1</small>
          </div>
          <div className="table-scroll form-table-wrap">
            <table className="data-table form-table">
              <thead>
                <tr>
                  <th>物料</th>
                  <th style={{ width: 100 }}>数量</th>
                  <th style={{ width: 110 }}>单价（元）</th>
                  <th className="number-cell">小计</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const p = data.products.find((p) => p.id === i.product_id);
                  if (!p) return <tr key={i.product_id}><td colSpan={4}>正在核对物料 #{i.product_id}；若物料已删除，请移除后重新选择。</td><td><button type="button" aria-label={`移除物料 #${i.product_id}`} onClick={() => setItems(current => current.filter(line => line.product_id !== i.product_id))}><Trash2 size={16} /></button></td></tr>;
                  return (
                    <tr key={i.product_id}>
                      <td>
                        <div className="product-info">
                          <ProductArt product={p} size="small" />
                          <div>
                            <strong>{p.name}{p.active === 0 ? "（已停用）" : ""}</strong>
                            <small>
                              库存 {p.stock} {p.unit}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <input
                          aria-label={`${p.name} 数量`}
                          type="number"
                          min="0.000001"
                          max="99999999"
                          step="0.000001"
                          required
                          value={i.quantity}
                          onChange={(e) =>
                            update(i.product_id, "quantity", e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${p.name} 单价`}
                          type="number"
                          min="0"
                          max="99999999"
                          step="0.01"
                          required
                          value={i.price}
                          onChange={(e) =>
                            update(i.product_id, "price", e.target.value)
                          }
                        />
                      </td>
                      <td className="number-cell">
                        ¥ {money(Number(i.quantity) * Number(i.price))}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`移除 ${p.name}`}
                          onClick={() =>
                            setItems(
                              items.filter(
                                (x) => x.product_id !== i.product_id,
                              ),
                            )
                          }
                        >
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {!!items.length && (
                <tfoot>
                  <tr className="table-total-row">
                    <td>总计 · {items.length} 种物料</td>
                    <td className="number-cell">{count(totalQuantity)}</td>
                    <td />
                    <td className="number-cell">¥ {money(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
            {!items.length && (
              <div className="order-form-empty">
                <ScanLine size={25} />
                <span>扫码或搜索，添加第一件物料</span>
              </div>
            )}
          </div>
          <label className="note-label">
            备注
            <textarea
              maxLength={500}
              rows={2}
              placeholder="选填，记录本次入出库的补充信息"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              <TriangleAlert size={16} />
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer order-form-footer">
          <div>
            <small>物料种类</small>
            <strong>
              {items.length}
              <span> 种</span>
            </strong>
          </div>
          <div>
            <Button type="button" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              type="submit"
              kind="primary"
              icon={Check} busy={busy}
              disabled={busy || templateAction.busy || !items.length}
            >
              {busy ? "正在提交…" : `确认${type === "in" ? "入库" : "出库"}`}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export { OrderForm };
